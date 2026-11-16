import { sql } from "drizzle-orm";
import { query, type DB } from "@/db/client";
import { audienceIn } from "./cards/audience";
import type { Audience } from "./cards/spec";

/** The two kinds of card on the Browse screen: tied to one form, or common (a flow, a module, a pattern across forms). */
export type BrowseKind = "form" | "common";

export function parseBrowseKind(v: string | undefined): BrowseKind | "" {
  return v === "form" || v === "common" ? v : "";
}

/** One entry of the Browse form dropdown. */
export interface BrowseForm {
  id: number;
  name: string;
  /** form cards in the user's set that sit on the form or are linked to it */
  n: number;
  module: string | null;
}

/**
 * Forms that have at least one active FORM card in the given card sets. A card belongs to a form if it sits on it or is
 * related to it (its source_refs). Common cards are not counted here, even when they list the form as a source: they
 * are browsed under "Common questions".
 */
export async function loadBrowseForms(db: DB, audiences: Audience[]): Promise<BrowseForm[]> {
  return query<BrowseForm>(
    db,
    sql`SELECT i.id, i.name, i.module, count(DISTINCT x.card_id)::int AS n
        FROM kb_items i JOIN (
          SELECT c.id AS card_id, c.kb_item_id AS form_id FROM cards c JOIN kb_items o ON o.id = c.kb_item_id
            WHERE c.status = 'active' AND o.type = 'form' AND ${audienceIn(sql`c.audience`, audiences)}
          UNION ALL
          SELECT r.card_id, r.kb_item_id AS form_id FROM card_related_items r
            JOIN cards c ON c.id = r.card_id JOIN kb_items o ON o.id = c.kb_item_id
            WHERE c.status = 'active' AND o.type = 'form' AND ${audienceIn(sql`c.audience`, audiences)}
        ) x ON x.form_id = i.id
        WHERE i.type = 'form' AND i.active
        GROUP BY i.id, i.name, i.module ORDER BY i.name`,
  );
}

/** How many active cards of each kind the user's card sets hold (optionally within one area). */
export async function loadKindCounts(db: DB, audiences: Audience[], module = ""): Promise<Record<BrowseKind, number>> {
  const rows = await query<{ kind: BrowseKind; n: number }>(
    db,
    sql`SELECT CASE WHEN i.type = 'form' THEN 'form' ELSE 'common' END AS kind, count(*)::int AS n
        FROM cards c JOIN kb_items i ON i.id = c.kb_item_id
        WHERE c.status = 'active' AND ${audienceIn(sql`c.audience`, audiences)} ${module ? sql`AND i.module = ${module}` : sql``}
        GROUP BY 1`,
  );
  const out: Record<BrowseKind, number> = { form: 0, common: 0 };
  for (const r of rows) out[r.kind] = Number(r.n);
  return out;
}
