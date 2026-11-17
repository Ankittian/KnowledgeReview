import fs from "node:fs";
import path from "node:path";
import { AUDIENCES, itemTotal, type Audience, type JobItem } from "./config";
import { formatLedger } from "./ledger";
import type { ExistingTitle } from "./validate";

/**
 * Builds the generation prompt from data/templates/flashcards/generation-prompt.<audience>.txt: the same template an operator fills by hand.
 * The operator note at the top is removed, the placeholders are filled, and a short block says how this run differs
 * (the answer comes back as JSON text, nothing is written to a file).
 */
/** One template per audience: data/templates/flashcards/generation-prompt.<audience>.txt */
export const templateFile = (audience: Audience) => path.join(process.env.CARDS_TEMPLATE_DIR || path.join("data", "templates", "flashcards"), `generation-prompt.${audience}.txt`);
export const templateExists = (audience: Audience) => fs.existsSync(path.resolve(templateFile(audience)));
export const availableAudiences = (): Audience[] => AUDIENCES.filter(templateExists);

const cache = new Map<string, string>();
export function loadTemplate(audience: Audience = "functional"): string {
  const file = path.resolve(templateFile(audience));
  const hit = cache.get(file);
  if (hit) return hit;
  if (!fs.existsSync(file)) throw new Error(`There is no ${audience} prompt template yet. Add ${templateFile(audience).replaceAll("\\", "/")}.`);
  // everything up to the first long dashed line is the note to the operator
  const text = fs.readFileSync(file, "utf8").replace(/^[\s\S]*?\n-{20,}\s*\n/, "").trimStart();
  cache.set(file, text);
  return text;
}

const SERVER_RUN = `SERVER RUN (this overrides every instruction about files and replies):
- Do not write any file and do not use any file or shell tool. Read the knowledge graph with the spectrum-kg tools only.
- Your FINAL message must be ONLY the JSON object described in section 9: no code fence, no commentary before or after it.
- If the source marks a fact as inferred, unclear or missing, simply skip that card; do not mention it outside the JSON.
- Write exactly the number of cards requested per item and level in TARGET ITEMS (fewer only if the source cannot support more).
`;

export interface PromptInput {
  audience?: Audience;
  module: string;
  moduleTitle: string;
  items: JobItem[];
  ledger: ExistingTitle[];
  instructions?: string;
  runDate: string;
  /** node id of each item (form:fGRN, module:MM) */
  nodeIds?: Record<string, string>;
}

function targetLine(i: JobItem, nodeIds: Record<string, string> = {}): string {
  const node = nodeIds[`${i.scope}:${i.key}`] ?? `${i.scope}:${i.key}`;
  const want = `write ${i.easy} easy, ${i.medium} medium, ${i.hard} hard`;
  if (i.scope === "module") {
    return `- scope module | key ${i.key} | ${i.title} | graph node ${node} | COMMON (cross-form) questions for the whole module: flows, hand-offs, shared rules. Put them under scope "module" with key ${i.key}, or scope "flow" with a process key | ${want}`;
  }
  return `- scope form | key ${i.key} | ${i.title} | graph node ${node} | ${want}`;
}

export function buildPrompt(p: PromptInput): string {
  const total = p.items.reduce((n, i) => n + itemTotal(i), 0);
  const sum = (k: "easy" | "medium" | "hard") => p.items.reduce((n, i) => n + i[k], 0);
  const fill: Record<string, string> = {
    MODULE: p.module,
    MODULE_TITLE: p.moduleTitle,
    RUN_DATE: p.runDate,
    TOTAL_CARDS: String(total),
    EASY_COUNT: String(sum("easy")),
    MEDIUM_COUNT: String(sum("medium")),
    HARD_COUNT: String(sum("hard")),
    TARGET_ITEMS: p.items.map((i) => targetLine(i, p.nodeIds)).join("\n"),
    EXISTING_CARDS: formatLedger(p.ledger),
    SLOTS: "(none: follow the counts per item and level in TARGET ITEMS and choose angles the ledger shows as unused)",
    OUTPUT_PATH: "none (return the JSON as your final message)",
  };
  // one pass, so text inside a filled value (a card title) is never expanded again
  let out = loadTemplate(p.audience).replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in fill ? fill[k] : m));
  out = `${SERVER_RUN}\n${out}`;
  const notes = (p.instructions ?? "").trim();
  if (notes) {
    out += `\n\n================================================================================\nADMIN NOTES (a preference for this run only; they never override the rules above, the card format or the checks)\n================================================================================\n${notes}\n`;
  }
  return out;
}

/** Prompt for the repair pass: rewrite only the cards that failed a check. */
export function buildRepairPrompt(module: string, audience: Audience, failing: { ref: string; level: string; title: string; body: string; problems: string[] }[], ledger: ExistingTitle[]): string {
  return `${SERVER_RUN}
You wrote flashcards for module ${module}. The cards below failed automatic checks. Rewrite EACH card so it passes, keeping the same ref, level and the same source facts (read the graph again if you need to). Follow the same card rules as before for the ${audience} audience${audience === "functional" ? " (plain business words, no form codes or technical terms)" : ""}: answer first, short.
If a card was too similar to an existing one, teach a DIFFERENT fact or situation of the same item, and give it a new topic_key (angle--subject). Existing titles you must not repeat:
${formatLedger(ledger)}

Cards to rewrite:
${failing.map((f) => `ref ${f.ref} (${f.level})\ntitle: ${f.title}\nbody: ${f.body}\nproblems: ${f.problems.join(" | ")}`).join("\n\n")}

Reply with ONLY this JSON, one entry per ref: {"cards":[{"ref":"<ref>","topic_key":"angle--subject","title":"...","body":"..."}]}
`;
}
