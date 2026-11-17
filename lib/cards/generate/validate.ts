import { countWords, functionalLeaks, type Audience, type Level } from "@/lib/cards/spec";
import { findSimilarTitles, titleSimilarity, type SimilarPair, type TitledCard } from "@/lib/cards/push/dedupe";
import { catalogSchema, type Catalog } from "@/lib/cards/push/catalog";

/**
 * Checks on a generated card, run in code after the model answers (the model cannot skip them).
 *
 * WORD LIMITS. lib/cards/spec.ts (easy 20-70, medium 90-200, hard 180-380) and prompt5 (easy 20-50, medium 50-130,
 * hard 120-220) disagree. Until they are reconciled the generator accepts anything that fits EITHER range, so a card
 * that obeys the prompt is never rejected by the code. Change WORD_LIMITS here once the two are aligned.
 */
export const WORD_LIMITS: Record<Level, [number, number]> = { easy: [20, 70], medium: [50, 200], hard: [120, 380] };

export interface RawCard {
  level: Level;
  topic_key: string;
  title: string;
  body: string;
  source_refs: string[];
}

export interface RawGroup {
  scope: "module" | "flow" | "form";
  key: string;
  title: string;
  context?: string;
  cards: RawCard[];
}

export type CardProblemKind = "length" | "leak" | "similar" | "source";
export interface CardProblem {
  kind: CardProblemKind;
  message: string;
}

/** `Node name [4:<uuid>:<number>] (type:key)`: the shape prompt5 requires for every source_refs entry. */
const SOURCE_REF = /\[\d+:[0-9a-fA-F-]{36}:\d+\]\s*\([a-z]+:[^()\s]+\)\s*$/;
const TOPIC_KEY = /^[a-z0-9-]+--[a-z0-9-]+$/;

/** Problems with one card on its own (length, leaked technical words, malformed source refs). */
export function checkCard(card: RawCard, audience: Audience = "functional"): CardProblem[] {
  const out: CardProblem[] = [];
  const words = countWords(card.body);
  const [lo, hi] = WORD_LIMITS[card.level];
  if (words < lo || words > hi) out.push({ kind: "length", message: `Body has ${words} words; a ${card.level} card should have ${lo} to ${hi}` });
  // technical wording is only a problem on cards for business users
  const leaks = audience !== "functional" ? [] : functionalLeaks(`${card.title}\n${card.body}`);
  if (leaks.length) out.push({ kind: "leak", message: `Technical wording a business user should not see: ${leaks.slice(0, 3).join("; ")}` });
  if (card.source_refs.length === 0) out.push({ kind: "source", message: "No source references" });
  else if (card.source_refs.some((r) => !SOURCE_REF.test(r))) out.push({ kind: "source", message: "A source reference is not in the form: Name [element id] (type:key)" });
  if (!TOPIC_KEY.test(card.topic_key)) out.push({ kind: "source", message: "The topic key should look like angle--subject" });
  return out;
}

/** Identifies a card inside one job: the group, the level and the topic key (what the push turns into the card id). */
export const cardKey = (group: string, level: string, topicKey: string) => `${group}:${level}:${topicKey}`;

export interface ExistingTitle {
  item: string;
  level: string;
  topicKey: string;
  title: string;
}

/**
 * Near-duplicates of each new card: against the titles already stored (the ledger) and against the other new cards of
 * the same item. Returns problems keyed by cardKey().
 */
export function findDuplicates(groups: RawGroup[], ledger: ExistingTitle[], threshold: number): Map<string, CardProblem[]> {
  const fresh: TitledCard[] = groups.flatMap((g) => g.cards.map((c) => ({ item: g.key, id: cardKey(g.key, c.level, c.topic_key), level: c.level, title: c.title })));
  const existing: TitledCard[] = ledger.map((l) => ({ item: l.item, id: `existing:${l.item}:${l.level}:${l.topicKey}`, level: l.level, title: l.title }));
  const pairs: SimilarPair[] = findSimilarTitles(fresh, existing, threshold);
  const out = new Map<string, CardProblem[]>();
  for (const p of pairs) {
    const list = out.get(p.newId) ?? [];
    list.push({ kind: "similar", message: `Similar (${p.score}) to ${p.existing ? "a stored card" : "another new card"}: "${p.otherTitle}"` });
    out.set(p.newId, list);
  }
  return out;
}

/** True when a topic key (same item, level) is already stored: pushing it would silently overwrite that card. */
export const topicKeyTaken = (ledger: ExistingTitle[], item: string, level: string, topicKey: string) =>
  ledger.some((l) => l.item === item && l.level === level && l.topicKey === topicKey);

export { titleSimilarity };

// ---------------------------------------------------------------- parsing the answer of the model

/** Pulls the JSON object out of the final message (tolerates a code fence or a stray sentence around it). */
export function extractJson(text: string): unknown {
  const t = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t)?.[1]?.trim();
  const candidates = [t, fenced].filter((x): x is string => !!x);
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(t.slice(first, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("The answer of the model is not valid JSON");
}

/** Validates the parsed answer with the same schema the push uses, and returns its groups. */
export function parseGroups(raw: unknown, module: string, audience: Audience = "functional"): RawGroup[] {
  const parsed = catalogSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`The answer does not match the card format (${issue?.path.join(".") || "root"}: ${issue?.message})`);
  }
  const cat: Catalog = parsed.data;
  if (cat.audience !== audience) throw new Error(`The answer is for the ${cat.audience} audience, expected ${audience}`);
  if (cat.module !== module) throw new Error(`The answer is for module ${cat.module}, expected ${module}`);
  return cat.items.map((g) => ({
    scope: g.scope,
    key: g.key,
    title: g.title,
    context: g.context,
    cards: g.cards.map((c) => ({ level: c.level, topic_key: c.topic_key.trim(), title: c.title.trim(), body: c.body.trim(), source_refs: c.source_refs ?? [] })),
  }));
}
