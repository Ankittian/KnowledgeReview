import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { query, type DB } from "@/db/client";
import { cardGenerationJobs } from "@/db/schema";
import { catalogSchema, countCards, DEFAULT_CATALOG_DIR, pushCatalog, PushRefused, type Catalog, type PushResult, type SimilarPair } from "@/lib/cards/push";
import type { Audience } from "@/lib/cards/spec";
import { audienceOf } from "./config";
import { addCardWarnings, getJob, loadDraftCards, notify, type GeneratedCardRow } from "./jobs";

/**
 * Pushing a reviewed job. It calls pushCatalog (lib/cards/push), the same code `npm run cards:push` runs, in append
 * mode: new cards are added, a changed card gets a new version, nothing is deleted and review history stays.
 */

/** The draft cards of a job as one catalog per module (a job over several modules pushes several catalogs). */
export function buildCatalogs(rows: GeneratedCardRow[], audience: Audience = "functional"): Catalog[] {
  const byModule = new Map<string, Map<string, Catalog["items"][number]>>();
  for (const r of rows) {
    const groups = byModule.get(r.module) ?? new Map<string, Catalog["items"][number]>();
    byModule.set(r.module, groups);
    const g = groups.get(r.groupKey) ?? { scope: r.scope as "module" | "flow" | "form", key: r.groupKey, title: r.groupTitle, context: r.context ?? undefined, cards: [] };
    groups.set(r.groupKey, g);
    g.cards.push({ level: r.level, topic_key: r.topicKey, title: r.title, body: r.body, source_refs: r.sourceRefs });
  }
  return [...byModule.entries()].map(([module, groups]) => {
    const items = [...groups.values()];
    const breakdown: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
    for (const g of items) for (const c of g.cards) breakdown[c.level]++;
    return catalogSchema.parse({ module, audience, total_cards: items.reduce((n, g) => n + g.cards.length, 0), breakdown, items });
  });
}

export interface PushPreview {
  module: string;
  cards: number;
  inserted: number;
  newVersion: number;
  unchanged: number;
  links: number;
  similar: SimilarPair[];
  revisions: { id: string; title: string }[];
  unresolvedRefs: { item: string; topicKey: string; ref: string }[];
}

const toPreview = (r: PushResult, cards: number): PushPreview => ({
  module: r.module,
  cards,
  inserted: r.cardsInserted,
  newVersion: r.cardsNewVersion,
  unchanged: r.cardsUnchanged,
  links: r.linksInserted,
  similar: r.similar,
  revisions: r.revisions,
  unresolvedRefs: r.unresolvedRefs,
});

/** Runs the push without saving anything (rolled back) and reports what it would do. */
export async function previewPush(db: DB, rows: GeneratedCardRow[], audience: Audience = "functional", similarity = 0.6): Promise<PushPreview[]> {
  const out: PushPreview[] = [];
  for (const cat of buildCatalogs(rows, audience)) {
    const r = await pushCatalog(db, cat, { mode: "append", dryRun: true, duplicates: "warn", similarity });
    out.push(toPreview(r, countCards(cat)));
  }
  return out;
}

export type PushOutcome =
  | { ok: true; previews: PushPreview[]; files: string[] }
  | { ok: false; error: string; similar?: SimilarPair[]; revisions?: { id: string; title: string }[] };

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");

/** Writes the catalog next to the other generated catalogs (temp file, then rename, so a reader never sees half a file). */
function writeCatalogFile(cat: Catalog, jobId: number, dir = DEFAULT_CATALOG_DIR): string {
  const abs = path.resolve(dir);
  fs.mkdirSync(abs, { recursive: true });
  const file = path.join(dir, `${cat.module}.job${jobId}.${stamp()}.${cat.audience}.json`);
  const tmp = `${path.resolve(file)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cat, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, path.resolve(file));
  return file.replaceAll("\\", "/");
}

/**
 * Pushes a job that is 'ready'. All modules go in one transaction: a refusal (a title too close to a stored card, for
 * example) leaves the database untouched and the job 'ready', with the offending cards marked so they can be edited or
 * deleted. After the commit the catalog files are saved for the record.
 */
export async function pushJob(db: DB, jobId: number, actorId: string, opts: { similarity?: number; dir?: string } = {}): Promise<PushOutcome> {
  const similarity = opts.similarity ?? 0.6;
  const claimed = await query<{ id: number; requested_by: string }>(
    db,
    sql`UPDATE card_generation_jobs SET status = 'pushing' WHERE id = ${jobId} AND status = 'ready' RETURNING id, requested_by`,
  );
  if (!claimed.length) return { ok: false, error: "This job is not waiting for review (it may already have been pushed)." };

  const restore = () => db.execute(sql`UPDATE card_generation_jobs SET status = 'ready' WHERE id = ${jobId} AND status = 'pushing'`);
  try {
    const rows = await loadDraftCards(db, jobId);
    if (!rows.length) {
      await restore();
      return { ok: false, error: "There are no cards to push: every card was deleted." };
    }
    const audience = audienceOf((await getJob(db, jobId))?.params);
    const catalogs = buildCatalogs(rows, audience);
    const results: PushResult[] = [];
    await db.transaction(async (tx) => {
      for (const cat of catalogs) results.push(await pushCatalog(tx as unknown as DB, cat, { mode: "append", dryRun: false, duplicates: "error", similarity }));
    });

    let files: string[] = [];
    let fileError: string | null = null;
    try {
      files = catalogs.map((c) => writeCatalogFile(c, jobId, opts.dir ?? process.env.CARDS_OUTPUT_DIR ?? DEFAULT_CATALOG_DIR));
    } catch (e) {
      fileError = e instanceof Error ? e.message : String(e); // the cards are live; only the saved copy failed
    }
    const previews = results.map((r, i) => toPreview(r, countCards(catalogs[i])));
    const job = await getJob(db, jobId);
    await db
      .update(cardGenerationJobs)
      .set({ status: "pushed", finishedAt: new Date(), filePaths: files, report: { ...(job?.report ?? {}), push: { previews, fileError, by: actorId, at: new Date().toISOString() } } })
      .where(eq(cardGenerationJobs.id, jobId));
    const inserted = previews.reduce((n, p) => n + p.inserted, 0);
    const updated = previews.reduce((n, p) => n + p.newVersion, 0);
    await notify(db, claimed[0].requested_by, "cards_pushed", jobId, `Pushed ${inserted + updated} cards: ${inserted} new, ${updated} updated.`);
    return { ok: true, previews, files };
  } catch (e) {
    await restore();
    if (e instanceof PushRefused) {
      const rows = await loadDraftCards(db, jobId);
      const audience = audienceOf((await getJob(db, jobId))?.params);
      const hit = new Set(e.similar.map((s) => s.newId));
      const ids = rows.filter((r) => hit.has(`gen:${r.groupKey}:${audience}:${r.level}:${r.topicKey}`)).map((r) => r.id);
      await addCardWarnings(db, ids, "Too close to a card that is already stored: edit or delete it before pushing");
      return { ok: false, error: e.message, similar: e.similar, revisions: e.revisions };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
