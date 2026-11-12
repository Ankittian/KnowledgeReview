import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { settings } from "@/db/schema";

export const DEFAULT_DAILY_CARD_LIMIT = 10;
export const DAILY_LIMIT_MIN = 1;
export const DAILY_LIMIT_MAX = 100;
const DAILY_LIMIT_KEY = "daily_card_limit";

export async function getSetting<T>(db: DB, key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row ? (row.value as T) : fallback;
}

export async function setSetting(db: DB, key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value`, updatedAt: new Date() } });
}

/** Max cards an employee is shown per day, across all sign-ins. Configured by admins. */
export async function getDailyCardLimit(db: DB): Promise<number> {
  const n = Number(await getSetting(db, DAILY_LIMIT_KEY, await getSetting(db, "deck_size", DEFAULT_DAILY_CARD_LIMIT)));
  return Number.isFinite(n) && n >= DAILY_LIMIT_MIN && n <= DAILY_LIMIT_MAX ? Math.round(n) : DEFAULT_DAILY_CARD_LIMIT;
}

export const setDailyCardLimit = (db: DB, n: number) => setSetting(db, DAILY_LIMIT_KEY, n);
