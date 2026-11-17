import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { kbItems, users } from "@/db/schema";
import { DEFAULT_SIMILARITY_THRESHOLD } from "@/lib/cards/push";
import { createGenClient, type GenClient, type GenerateResult } from "./claude";
import { jobParamsSchema, LIMITS, type Audience, type JobItem, type JobParams } from "./config";
import { finishJob, insertCards, isCancelRequested, notify, setProgress, type JobRow, type NewGeneratedCard } from "./jobs";
import { loadLedger } from "./ledger";
import { previewPush } from "./push";
import { buildPrompt, buildRepairPrompt } from "./prompt";
import { cardKey, checkCard, extractJson, findDuplicates, parseGroups, topicKeyTaken, type CardProblem, type ExistingTitle, type RawGroup } from "./validate";

/**
 * Runs one queued job: for each batch of forms (or each module) it builds the prompt with the ledger, calls Claude,
 * validates the answer, asks once for a rewrite of the cards that failed a check, and finally stores the cards for
 * review. Nothing reaches the card tables here: that only happens when an admin pushes.
 */

interface Batch {
  module: string;
  items: JobItem[];
}

/** Forms go four at a time within their module; a module-level item is a batch of its own. */
export function makeBatches(params: JobParams): Batch[] {
  const byModule = new Map<string, JobItem[]>();
  for (const it of params.items) byModule.set(it.module, [...(byModule.get(it.module) ?? []), it]);
  const out: Batch[] = [];
  for (const [module, items] of byModule) {
    const size = params.level === "module" ? 1 : LIMITS.batchSize;
    for (let i = 0; i < items.length; i += size) out.push({ module, items: items.slice(i, i + size) });
  }
  return out;
}

interface Report {
  warnings: number;
  dropped: { group: string; title: string; reason: string }[];
  shortfalls: { item: string; level: string; wanted: number; got: number }[];
  failedBatches: { items: string[]; error: string }[];
  preview?: unknown;
  previewError?: string;
}

const SILENT = () => {};

export async function processJob(db: DB, job: JobRow, client: GenClient = createGenClient(), log: (m: string) => void = SILENT): Promise<void> {
  const parsed = jobParamsSchema.safeParse(job.params);
  if (!parsed.success) return finishJob(db, job.id, "failed", { error: `The saved request is invalid: ${parsed.error.issues[0]?.message}` });
  const params = parsed.data;
  const audience = params.audience;
  const [actor] = await db.select({ id: users.id, username: users.username }).from(users).where(eq(users.id, job.requestedBy));
  const user = actor ?? { id: job.requestedBy, username: "admin" };

  const modules = [...new Set(params.items.map((i) => i.module))];
  const names = new Map<string, string>();
  for (const m of await db.select({ key: kbItems.key, name: kbItems.name }).from(kbItems).where(and(eq(kbItems.type, "module"), inArray(kbItems.key, modules)))) names.set(m.key, m.name);

  const batches = makeBatches(params);
  const abort = new AbortController();
  const report: Report = { warnings: 0, dropped: [], shortfalls: [], failedBatches: [] };
  const cards: NewGeneratedCard[] = [];
  /** titles accepted so far in this job, so a later batch does not repeat an earlier one */
  const accepted: ExistingTitle[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let modelUsed: string | null = null;
  const addUsage = (r: GenerateResult) => {
    tokensIn += r.tokensIn;
    tokensOut += r.tokensOut;
    modelUsed = r.model ?? modelUsed;
  };

  await setProgress(db, job.id, 0, batches.length);
  for (const [n, batch] of batches.entries()) {
    if (await isCancelRequested(db, job.id)) {
      abort.abort("cancelled");
      return finishJob(db, job.id, "cancelled", { tokensIn, tokensOut, model: modelUsed });
    }
    const label = batch.items.map((i) => i.title);
    log(`batch ${n + 1}/${batches.length}: ${label.join(", ")}`);
    try {
      const ledger = [
        ...(await loadLedger(db, { audience, module: batch.module, itemKeys: params.level === "form" ? batch.items.map((i) => i.key) : undefined, excludeJobId: job.id })),
        ...accepted.filter((a) => (params.level === "form" ? batch.items.some((i) => i.key === a.item) : true)),
      ];
      const nodeIds: Record<string, string> = {};
      for (const i of batch.items) nodeIds[`${i.scope}:${i.key}`] = `${i.scope}:${i.key}`;
      const prompt = buildPrompt({
        audience,
        module: batch.module,
        moduleTitle: names.get(batch.module) ?? batch.module,
        items: batch.items,
        ledger,
        instructions: params.instructions,
        runDate: new Date().toISOString().slice(0, 10),
        nodeIds,
      });

      let groups: RawGroup[] | null = null;
      let lastError = "";
      for (let attempt = 0; attempt < 2 && !groups; attempt++) {
        const res = await client.generate({ kind: "cards", prompt, model: params.model, user, signal: abort.signal, module: batch.module, items: batch.items, audience });
        addUsage(res);
        if (!res.ok) {
          lastError = res.error ?? "Claude failed";
          continue;
        }
        try {
          groups = parseGroups(extractJson(res.text), batch.module, audience);
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      if (!groups) {
        report.failedBatches.push({ items: label, error: lastError });
        await setProgress(db, job.id, n + 1, batches.length);
        continue;
      }

      const checked = await checkBatch({ db, client, params, batch, groups, ledger, user, signal: abort.signal, report, addUsage });
      for (const c of checked) {
        cards.push(c);
        accepted.push({ item: c.groupKey, level: c.level, topicKey: c.topicKey, title: c.title });
      }
    } catch (e) {
      report.failedBatches.push({ items: label, error: e instanceof Error ? e.message : String(e) });
    }
    await setProgress(db, job.id, n + 1, batches.length);
  }

  report.warnings = cards.filter((c) => c.warnings.length).length;
  if (cards.length === 0) {
    const why = report.failedBatches[0]?.error ?? "No usable cards were produced";
    await finishJob(db, job.id, "failed", { error: why, report: { ...report }, tokensIn, tokensOut, model: modelUsed });
    await notify(db, job.requestedBy, "cards_failed", job.id, `Generation failed: ${why.slice(0, 160)}`);
    return;
  }

  await insertCards(db, job.id, cards);
  try {
    const rows = cards.map((c, i) => ({ ...c, id: i, jobId: job.id, status: "draft", edited: false, createdAt: new Date(), context: c.context ?? null }));
    report.preview = await previewPush(db, rows as never, audience, DEFAULT_SIMILARITY_THRESHOLD);
  } catch (e) {
    report.previewError = e instanceof Error ? e.message : String(e);
  }
  await finishJob(db, job.id, "ready", { report: { ...report }, tokensIn, tokensOut, model: modelUsed });
  const forms = new Set(cards.map((c) => c.groupKey)).size;
  await notify(db, job.requestedBy, "cards_ready", job.id, `Cards ready for review: ${cards.length} cards for ${forms} ${params.level === "form" ? "form" : "item"}${forms === 1 ? "" : "s"}${report.warnings ? `, ${report.warnings} with warnings` : ""}.`);
}

// ---------------------------------------------------------------- checks and repair

interface CheckArgs {
  db: DB;
  client: GenClient;
  params: JobParams;
  batch: Batch;
  groups: RawGroup[];
  ledger: ExistingTitle[];
  user: { id: string; username: string };
  signal: AbortSignal;
  report: Report;
  addUsage: (r: GenerateResult) => void;
}

/** Keeps only requested groups, trims extras, drops unusable cards, checks the rest and tries one repair call. */
async function checkBatch(a: CheckArgs): Promise<NewGeneratedCard[]> {
  const { params, batch, ledger, report } = a;
  const wanted = new Map(batch.items.map((i) => [i.key, i]));

  // 1. keep what was asked for
  const groups: RawGroup[] = [];
  for (const g of a.groups) {
    const ok = params.level === "form" ? g.scope === "form" && wanted.has(g.key) : g.scope !== "form";
    if (!ok) {
      for (const c of g.cards) report.dropped.push({ group: g.key, title: c.title, reason: "Not one of the requested items" });
      continue;
    }
    groups.push({ ...g, cards: [] });
  }
  const seen = new Set<string>();
  const perLevel = new Map<string, number>(); // `${itemKey}:${level}` -> cards kept
  for (const src of a.groups) {
    const g = groups.find((x) => x.key === src.key && x.scope === src.scope);
    if (!g) continue;
    // module level: the counts are for the whole module, however many groups the model used
    const bucket = params.level === "module" ? batch.items[0].key : g.key;
    const limit = (level: "easy" | "medium" | "hard") => (wanted.get(bucket) ?? batch.items[0])[level];
    for (const c of src.cards) {
      const id = cardKey(g.key, c.level, c.topic_key);
      const used = perLevel.get(`${bucket}:${c.level}`) ?? 0;
      if (seen.has(id)) report.dropped.push({ group: g.key, title: c.title, reason: "Same topic key used twice" });
      else if (topicKeyTaken(ledger, g.key, c.level, c.topic_key)) report.dropped.push({ group: g.key, title: c.title, reason: "Topic key already used by a stored card" });
      else if (used >= limit(c.level)) report.dropped.push({ group: g.key, title: c.title, reason: "More cards than requested" });
      else {
        seen.add(id);
        perLevel.set(`${bucket}:${c.level}`, used + 1);
        g.cards.push(c);
      }
    }
  }

  // 2. checks, then one repair call for the cards that failed one
  let problems = collectProblems(groups, ledger, params.audience);
  const failing = [...problems.entries()].filter(([, p]) => p.some((x) => x.kind !== "source"));
  if (failing.length && !a.signal.aborted) {
    const byRef = new Map<string, { g: RawGroup; i: number }>();
    for (const g of groups) g.cards.forEach((c, i) => byRef.set(cardKey(g.key, c.level, c.topic_key), { g, i }));
    const items = failing.map(([ref, p]) => ({ ref, c: byRef.get(ref)!.g.cards[byRef.get(ref)!.i], problems: p.map((x) => x.message) }));
    const res = await a.client.generate({
      kind: "repair",
      prompt: buildRepairPrompt(batch.module, params.audience, items.map((x) => ({ ref: x.ref, level: x.c.level, title: x.c.title, body: x.c.body, problems: x.problems })), ledger),
      model: params.model,
      user: a.user,
      signal: a.signal,
      module: batch.module,
      audience: params.audience,
    });
    a.addUsage(res);
    if (res.ok) {
      try {
        const out = extractJson(res.text) as { cards?: { ref: string; topic_key?: string; title?: string; body?: string }[] };
        for (const r of out.cards ?? []) {
          const at = byRef.get(r.ref);
          if (!at || !r.title || !r.body) continue;
          const old = at.g.cards[at.i];
          const next = { ...old, title: r.title.trim(), body: r.body.trim(), topic_key: (r.topic_key ?? old.topic_key).trim() };
          const nextId = cardKey(at.g.key, next.level, next.topic_key);
          if (nextId !== r.ref && (seen.has(nextId) || topicKeyTaken(ledger, at.g.key, next.level, next.topic_key))) continue;
          seen.delete(r.ref);
          seen.add(nextId);
          at.g.cards[at.i] = next;
        }
      } catch {
        /* keep the original cards with their warnings */
      }
      problems = collectProblems(groups, ledger, params.audience);
    }
  }

  // 3. what is left keeps its warnings for the reviewer
  const out: NewGeneratedCard[] = [];
  for (const g of groups) {
    for (const c of g.cards) {
      const warnings = (problems.get(cardKey(g.key, c.level, c.topic_key)) ?? []).map((p) => p.message);
      out.push({
        module: batch.module,
        scope: g.scope,
        groupKey: g.key,
        groupTitle: g.title,
        context: g.context ?? null,
        level: c.level,
        topicKey: c.topic_key,
        title: c.title,
        body: c.body,
        sourceRefs: c.source_refs,
        warnings,
      });
    }
  }

  // 4. report what is missing
  for (const it of batch.items) {
    for (const level of ["easy", "medium", "hard"] as const) {
      const got = params.level === "module" ? out.filter((c) => c.level === level).length : out.filter((c) => c.groupKey === it.key && c.level === level).length;
      if (got < it[level]) report.shortfalls.push({ item: it.title, level, wanted: it[level], got });
    }
  }
  return out;
}

function collectProblems(groups: RawGroup[], ledger: ExistingTitle[], audience: Audience): Map<string, CardProblem[]> {
  const dup = findDuplicates(groups, ledger, DEFAULT_SIMILARITY_THRESHOLD);
  const out = new Map<string, CardProblem[]>();
  for (const g of groups) {
    for (const c of g.cards) {
      const id = cardKey(g.key, c.level, c.topic_key);
      const all = [...checkCard(c, audience), ...(dup.get(id) ?? [])];
      if (all.length) out.set(id, all);
    }
  }
  return out;
}

