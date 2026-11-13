import { sql } from "drizzle-orm";
import { query, type DB } from "@/db/client";
import { streakFrom } from "./dates";

const dstr = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export async function getActivityDays(db: DB, userId: string): Promise<string[]> {
  const rows = await query<{ d: unknown }>(
    db,
    sql`SELECT DISTINCT d.deck_date AS d FROM card_reviews r JOIN daily_decks d ON d.id = r.deck_id WHERE r.user_id = ${userId} ORDER BY 1 DESC LIMIT 400`,
  );
  return rows.map((r) => dstr(r.d));
}

export async function getStreak(db: DB, userId: string, today: string) {
  const days = await getActivityDays(db, userId);
  return { streak: streakFrom(days, today), answeredToday: days.includes(today) };
}

export async function getUserSummary(db: DB, userId: string) {
  const [r] = await query<Record<string, unknown>>(
    db,
    sql`SELECT count(*)::int AS reviews,
               count(*) FILTER (WHERE r.knew_it)::int AS knew,
               count(DISTINCT cv.card_id)::int AS cards_seen,
               count(*) FILTER (WHERE r.verdict = 'needs_improvement')::int AS flagged
        FROM card_reviews r JOIN card_versions cv ON cv.id = r.card_version_id WHERE r.user_id = ${userId}`,
  );
  const [f] = await query<Record<string, unknown>>(
    db,
    sql`SELECT count(*) FILTER (WHERE status = 'open')::int AS open,
               count(*) FILTER (WHERE status = 'accepted')::int AS accepted,
               count(*) FILTER (WHERE status = 'applied')::int AS applied,
               count(*)::int AS total
        FROM card_feedback WHERE user_id = ${userId}`,
  );
  return {
    reviews: Number(r.reviews),
    knew: Number(r.knew),
    cardsSeen: Number(r.cards_seen),
    flagged: Number(r.flagged),
    feedback: { open: Number(f.open), accepted: Number(f.accepted), applied: Number(f.applied), total: Number(f.total) },
  };
}

export async function getDailyCounts(db: DB, userId: string, from: string) {
  const rows = await query<{ d: unknown; n: number; knew: number }>(
    db,
    sql`SELECT d.deck_date AS d, count(*)::int AS n, count(*) FILTER (WHERE r.knew_it)::int AS knew
        FROM card_reviews r JOIN daily_decks d ON d.id = r.deck_id WHERE r.user_id = ${userId} AND d.deck_date >= ${from}::date GROUP BY 1`,
  );
  return new Map(rows.map((r) => [dstr(r.d), { n: Number(r.n), knew: Number(r.knew) }]));
}
