import "./_env";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { createDb, query } from "@/db/client";

/**
 * Fills card_related_items.element_id for cards that are already in the database, from a map of node id -> element id.
 *
 *   npm run cards:backfill-element-ids -- <map.json> [--dry-run]
 *
 * <map.json> is { "form:fGRN": "4:<uuid>:61031", ... } (node-element-ids.json). It only touches rows whose element_id is
 * still NULL, and a node id that is not in the map is left NULL: nothing is guessed, and an id already stored is never
 * overwritten. Safe to run repeatedly, on any database. Needs no catalog file.
 */
const SHAPE = /^\d+:[0-9a-fA-F-]{36}:\d+$/;
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const mapFile = args.find((a) => !a.startsWith("--"));
if (!mapFile) {
  console.error("Usage: npm run cards:backfill-element-ids -- <map.json> [--dry-run]");
  process.exit(1);
}

const map = JSON.parse(fs.readFileSync(path.resolve(mapFile), "utf8")) as Record<string, string>;
for (const [id, el] of Object.entries(map)) if (!SHAPE.test(el)) throw new Error(`Element id for ${id} is not "4:<uuid>:<number>": ${el}`);

const h = createDb();
try {
  await h.db.transaction(async (tx) => {
    const before = await query<{ total: number; missing: number }>(
      tx as never,
      sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE element_id IS NULL)::int AS missing FROM card_related_items`,
    );
    let filled = 0;
    for (const [nodeId, elementId] of Object.entries(map)) {
      const r = await tx.execute(sql`UPDATE card_related_items SET element_id = ${elementId} WHERE node_id = ${nodeId} AND element_id IS NULL`);
      filled += (r as unknown as { rowCount?: number }).rowCount ?? 0;
    }
    const left = await query<{ node_id: string | null; n: number }>(
      tx as never,
      sql`SELECT node_id, count(*)::int AS n FROM card_related_items WHERE element_id IS NULL GROUP BY node_id ORDER BY n DESC`,
    );
    console.log(`${before[0].total} links, ${before[0].missing} without element id before. Filled ${filled}.`);
    if (left.length) {
      console.log(`${left.reduce((s, r) => s + r.n, 0)} link(s) still NULL (node id not in the map):`);
      for (const r of left.slice(0, 30)) console.log(`  ${r.node_id ?? "(no node id)"}: ${r.n}`);
    }
    if (dryRun) {
      console.log("Dry run: rolled back, nothing saved.");
      throw new Error("__dry_run__");
    }
  });
} catch (e) {
  if (!(e instanceof Error && e.message === "__dry_run__")) throw e;
} finally {
  await h.close();
}
