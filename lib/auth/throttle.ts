import { sql } from "drizzle-orm";
import { getDb, query } from "@/db/client";

/** Counts activity_log rows of one action in the last `minutes`, optionally for one username/identifier and/or one IP. */
export async function recentCount(type: string, minutes: number, by: { username?: string; ip?: string | null }) {
  const db = await getDb();
  const parts = [];
  if (by.username) parts.push(sql`details->>'username' = ${by.username}`);
  if (by.ip) parts.push(sql`ip = ${by.ip}`);
  const filter = parts.length ? sql.join(parts, sql` AND `) : sql`false`;
  const [{ n }] = await query<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM activity_log
        WHERE action = ${type} AND created_at > now() - make_interval(mins => ${minutes}) AND ${filter}`,
  );
  return n;
}

export const OTP_MAX_SENDS_PER_IP_HOUR = 20; // emailed codes requested from one address (when the IP is trusted)
export const OTP_MAX_FAILS_PER_IP_15MIN = 30; // wrong codes / failed resets from one address
