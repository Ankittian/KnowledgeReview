import { sql, type SQL } from "drizzle-orm";
import { query, type DB } from "@/db/client";
import { LEVELS, LEVEL_ORDER } from "./cards/spec";

export type LeaderboardPeriod = "week" | "all";

export interface LeaderRow {
  rank: number;
  userId: string;
  name: string;
  points: number;
  cards: number;
  isMe: boolean;
}

/** SQL CASE that turns a card level into its points, taken from LEVELS (easy 1, medium 2, hard 3). */
const pointsCase = sql.join(
  LEVEL_ORDER.map((l) => sql`WHEN ${l}::text THEN ${LEVELS[l].weight}::int`),
  sql` `,
);

/**
 * Points leaderboard for signed-in users. Each card scores once: the user's first correct answer to it
 * (Known and correct, or New to me), worth the card's level points. "This week" counts only cards whose first
 * correct answer fell in the current week. `module` (a module code) limits the board to that area's cards.
 * Admins are ranked like everyone else; only active users are listed. Ties go to whoever reached their score first.
 */
export async function getLeaderboard(db: DB, period: LeaderboardPeriod, meId: string, module: string | null = null): Promise<LeaderRow[]> {
  const conds: SQL[] = [];
  if (period === "week") conds.push(sql`f.answered_at >= date_trunc('week', now())`);
  if (module) conds.push(sql`f.module = ${module}`);
  const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  const rows = await query<{ user_id: string; name: string; points: number; cards: number }>(
    db,
    sql`WITH first_correct AS (
          SELECT DISTINCT ON (r.user_id, c.id)
                 r.user_id, c.id AS card_id, c.level::text AS level, i.module AS module,
                 coalesce(r.answered_at, r.created_at) AS answered_at
          FROM card_reviews r
          JOIN card_versions v ON v.id = r.card_version_id
          JOIN cards c ON c.id = v.card_id
          JOIN kb_items i ON i.id = c.kb_item_id
          WHERE r.verdict = 'correct' AND c.level IS NOT NULL
          ORDER BY r.user_id, c.id, coalesce(r.answered_at, r.created_at)
        )
        SELECT f.user_id, u.display_name AS name,
               coalesce(sum(CASE f.level ${pointsCase} END), 0)::int AS points,
               count(*)::int AS cards
        FROM first_correct f
        JOIN users u ON u.id = f.user_id AND u.status = 'active'
        ${where}
        GROUP BY f.user_id, u.display_name
        ORDER BY points DESC, max(f.answered_at) ASC`,
  );
  return rows.map((r, i) => ({
    rank: i + 1,
    userId: r.user_id,
    name: r.name,
    points: Number(r.points),
    cards: Number(r.cards),
    isMe: r.user_id === meId,
  }));
}
