import { sql } from "drizzle-orm";
import { query, type DB } from "@/db/client";
import type { Audience } from "@/lib/cards/spec";
import type { ExistingTitle } from "./validate";

/**
 * The coverage ledger: the titles of the cards that already exist, sent to the model so it does not write them again.
 * One source for `npm run cards:ledger` (scripts/export-ledger.ts) and the generation worker.
 *
 *   form level   -> the cards of the chosen forms (`itemKeys`)
 *   module level -> every card under a non-form item of the module (the module itself, its flows, common patterns)
 *
 * Cards waiting for review in other jobs (generated, not pushed yet) are included, so two pending jobs cannot repeat
 * each other. Only titles and keys are returned, never bodies.
 */
export interface LedgerScope {
  module: string;
  audience?: Audience;
  /** form keys; omit for the module-level (common) ledger */
  itemKeys?: string[];
  /** a job whose own pending cards must not count */
  excludeJobId?: number;
}

const inList = (col: ReturnType<typeof sql.raw>, keys: string[]) => sql`${col} IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`;

export async function loadLedger(db: DB, s: LedgerScope): Promise<ExistingTitle[]> {
  const audience = s.audience ?? "functional";
  const keys = s.itemKeys ?? [];
  const itemFilter = keys.length ? inList(sql.raw("i.key"), keys) : sql`i.module = ${s.module} AND i.type <> 'form'`;
  const rows = await query<{ item: string; level: string; topic_key: string; front: string }>(
    db,
    sql`SELECT i.key AS item, c.level, c.topic_key, cv.front
        FROM cards c
        JOIN kb_items i ON i.id = c.kb_item_id
        JOIN card_versions cv ON cv.id = c.current_version_id
        WHERE c.status = 'active' AND c.audience = ${audience} AND ${itemFilter}
        ORDER BY i.key, CASE c.level WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, c.topic_key`,
  );
  const stored: ExistingTitle[] = rows.map((r) => ({ item: r.item, level: r.level, topicKey: r.topic_key, title: r.front.split("\n")[0].trim() }));

  const keyFilter = keys.length ? inList(sql.raw("g.group_key"), keys) : sql`g.module = ${s.module} AND g.scope <> 'form'`;
  const pending = await query<{ group_key: string; level: string; topic_key: string; title: string }>(
    db,
    sql`SELECT g.group_key, g.level, g.topic_key, g.title
        FROM generated_cards g JOIN card_generation_jobs j ON j.id = g.job_id
        WHERE g.status = 'draft' AND j.status IN ('ready', 'pushing') AND coalesce(j.params->>'audience', 'functional') = ${audience} AND ${keyFilter}
          ${s.excludeJobId ? sql`AND g.job_id <> ${s.excludeJobId}` : sql``}`,
  );
  return [...stored, ...pending.map((p) => ({ item: p.group_key, level: p.level, topicKey: p.topic_key, title: p.title.split("\n")[0].trim() }))];
}

/** The ledger as prompt5 expects it: `<item key> | <level> | <topic_key> | <title>`, one card per line. */
export const formatLedger = (lines: ExistingTitle[]) =>
  lines.length ? lines.map((l) => [l.item, l.level, l.topicKey, l.title].join(" | ")).join("\n") : "(none yet: no cards exist for these items)";
