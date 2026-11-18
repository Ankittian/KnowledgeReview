import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { appSettings } from "@/db/schema";

export const DEFAULT_DAILY_CARD_LIMIT = 10;
export const DAILY_LIMIT_MIN = 1;
export const DAILY_LIMIT_MAX = 100;
const DAILY_LIMIT_KEY = "daily_card_limit";

export async function getSetting<T>(db: DB, key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return row ? (row.value as T) : fallback;
}

export async function setSetting(db: DB, key: string, value: unknown): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`excluded.value`, updatedAt: new Date() } });
}

/** Max cards an employee is shown per day, across all sign-ins. Configured by admins. */
export async function getDailyCardLimit(db: DB): Promise<number> {
  const n = Number(await getSetting(db, DAILY_LIMIT_KEY, await getSetting(db, "deck_size", DEFAULT_DAILY_CARD_LIMIT)));
  return Number.isFinite(n) && n >= DAILY_LIMIT_MIN && n <= DAILY_LIMIT_MAX ? Math.round(n) : DEFAULT_DAILY_CARD_LIMIT;
}

export const setDailyCardLimit = (db: DB, n: number) => setSetting(db, DAILY_LIMIT_KEY, n);

// ---- Announcement banner (shown at the top of every signed-in page) ----

export const ANNOUNCEMENT_TONES = ["info", "success", "warning"] as const;
export type AnnouncementTone = (typeof ANNOUNCEMENT_TONES)[number];
export const ANNOUNCEMENT_MAX_LENGTH = 300;

export interface Announcement {
  /** Changes on every save, so a user who dismissed an older announcement sees the new one. */
  id: string;
  message: string;
  tone: AnnouncementTone;
  active: boolean;
}

const ANNOUNCEMENT_KEY = "announcement";

/** The saved announcement (active or not), for the admin form. */
export async function getAnnouncement(db: DB): Promise<Announcement | null> {
  const v = await getSetting<Partial<Announcement> | null>(db, ANNOUNCEMENT_KEY, null);
  if (!v || typeof v.message !== "string" || typeof v.id !== "string") return null;
  const tone = ANNOUNCEMENT_TONES.includes(v.tone as AnnouncementTone) ? (v.tone as AnnouncementTone) : "info";
  return { id: v.id, message: v.message, tone, active: v.active === true };
}

/** The announcement to show employees, or null when there is none or it is switched off. */
export async function getActiveAnnouncement(db: DB): Promise<Announcement | null> {
  const a = await getAnnouncement(db);
  return a && a.active && a.message.trim() ? a : null;
}

export const setAnnouncement = (db: DB, a: Announcement) => setSetting(db, ANNOUNCEMENT_KEY, a);
