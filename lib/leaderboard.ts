import { sql, type SQL } from "drizzle-orm";
import { query, type DB } from "@/db/client";
import { FLAG_POINTS_MULTIPLIER, LEVELS, LEVEL_ORDER } from "./cards/spec";

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
 * Points leaderboard for signed-in users. Each card scores once, from the user's FIRST scoring answer to it:
 * Known and correct / New to me earn the card's level points; reporting the card as incorrect or incomplete earns
 * FLAG_POINTS_MULTIPLIER (2) times that. "This week" counts only cards whose first scoring answer fell in the
 * current week. `module` (a module code) limits the board to that area's cards.
 * Admins are ranked like everyone else. Every active user is listed, those with no points (yet, this week, or in this
 * area) included, at 0 and sharing the last rank. Ties go to whoever reached their score first.
 */
export async function getLeaderboard(db: DB, period: LeaderboardPeriod, meId: string, module: string | null = null): Promise<LeaderRow[]> {
  const conds: SQL[] = [];
  if (period === "week") conds.push(sql`f.answered_at >= date_trunc('week', now())`);
  if (module) conds.push(sql`f.module = ${module}`);
  // the period / area limits sit in the JOIN, so people with no matching answers stay in the list with 0 points
  const joinOn = conds.length ? sql` AND ${sql.join(conds, sql` AND `)}` : sql``;
  const rows = await query<{ user_id: string; name: string; points: number; cards: number }>(
    db,
    sql`WITH first_correct AS (
          SELECT DISTINCT ON (r.user_id, c.id)
                 r.user_id, c.id AS card_id, c.level::text AS level, i.module AS module, r.verdict::text AS verdict,
                 coalesce(r.answered_at, r.created_at) AS answered_at
          FROM card_reviews r
          JOIN card_versions v ON v.id = r.card_version_id
          JOIN cards c ON c.id = v.card_id
          JOIN kb_items i ON i.id = c.kb_item_id
          WHERE r.verdict IN ('correct', 'needs_improvement') AND c.level IS NOT NULL
          ORDER BY r.user_id, c.id, coalesce(r.answered_at, r.created_at)
        )
        SELECT u.id AS user_id, u.display_name AS name,
               coalesce(sum((CASE f.level ${pointsCase} END) * (CASE WHEN f.verdict = 'needs_improvement' THEN ${FLAG_POINTS_MULTIPLIER}::int ELSE 1 END)), 0)::int AS points,
               count(f.card_id)::int AS cards
        FROM users u
        LEFT JOIN first_correct f ON f.user_id = u.id${joinOn}
        WHERE u.status = 'active'
        GROUP BY u.id, u.display_name
        ORDER BY points DESC, max(f.answered_at) ASC NULLS LAST, u.display_name`,
  );
  const firstZero = rows.findIndex((r) => Number(r.points) === 0);
  return rows.map((r, i) => ({
    // everyone on 0 points shares the rank right after the last scorer
    rank: Number(r.points) === 0 ? firstZero + 1 : i + 1,
    userId: r.user_id,
    name: r.name,
    points: Number(r.points),
    cards: Number(r.cards),
    isMe: r.user_id === meId,
  }));
}
