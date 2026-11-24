import crypto from "node:crypto";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { emailOtps } from "@/db/schema";
import type { OtpPurpose } from "@/lib/mail";

/**
 * Email one-time codes: 6 digits, stored only as a keyed hash (so a database leak does not reveal live codes), valid for
 * 10 minutes, single use, at most 5 wrong guesses per code, and a new code replaces the previous one.
 */
export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 60;
export const OTP_MAX_PER_HOUR = 5;

function secret(): string {
  const s = process.env.OTP_SECRET || process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error("OTP_SECRET (or JWT_SECRET) must be set to a random string of 32+ characters.");
  return s;
}

export const generateCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

/** Bound to user, address and purpose, so a code for one use cannot be replayed for another. */
export const hashCode = (userId: string, email: string, purpose: OtpPurpose, code: string) =>
  crypto.createHmac("sha256", secret()).update(`${userId}\n${email}\n${purpose}\n${code}`).digest("hex");

export type IssueResult = { ok: true; code: string } | { ok: false; reason: "cooldown" | "hourly"; waitSeconds: number };

export async function issueOtp(db: DB, o: { userId: string; email: string; purpose: OtpPurpose }, now = new Date()): Promise<IssueResult> {
  const own = and(eq(emailOtps.userId, o.userId), eq(emailOtps.purpose, o.purpose));
  const [last] = await db.select({ createdAt: emailOtps.createdAt }).from(emailOtps).where(own).orderBy(desc(emailOtps.createdAt)).limit(1);
  if (last) {
    const wait = OTP_RESEND_SECONDS - Math.floor((now.getTime() - last.createdAt.getTime()) / 1000);
    if (wait > 0) return { ok: false, reason: "cooldown", waitSeconds: wait };
  }
  const hourAgo = new Date(now.getTime() - 3600_000);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(emailOtps).where(and(own, gt(emailOtps.createdAt, hourAgo)));
  if (n >= OTP_MAX_PER_HOUR) return { ok: false, reason: "hourly", waitSeconds: 3600 };

  // housekeeping: expired or used codes older than a day
  await db.delete(emailOtps).where(and(lt(emailOtps.createdAt, new Date(now.getTime() - 86400_000)), or(lt(emailOtps.expiresAt, now), sql`${emailOtps.consumedAt} is not null`)));
  // a new code replaces any live one for this user and purpose
  await db.update(emailOtps).set({ consumedAt: now }).where(and(own, isNull(emailOtps.consumedAt)));

  const code = generateCode();
  await db.insert(emailOtps).values({
    userId: o.userId,
    email: o.email,
    purpose: o.purpose,
    codeHash: hashCode(o.userId, o.email, o.purpose, code),
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
  });
  return { ok: true, code };
}

/** True once, for the right code; every wrong guess is counted and the code dies after OTP_MAX_ATTEMPTS. */
export async function verifyOtp(db: DB, o: { userId: string; email: string; purpose: OtpPurpose; code: string }, now = new Date()): Promise<boolean> {
  const [row] = await db
    .select()
    .from(emailOtps)
    .where(and(eq(emailOtps.userId, o.userId), eq(emailOtps.purpose, o.purpose), eq(emailOtps.email, o.email), isNull(emailOtps.consumedAt), gt(emailOtps.expiresAt, now)))
    .orderBy(desc(emailOtps.createdAt))
    .limit(1);
  if (!row || row.attempts >= OTP_MAX_ATTEMPTS) return false;
  // count the attempt first (atomically, bounded), so parallel guesses cannot exceed the limit
  const counted = await db
    .update(emailOtps)
    .set({ attempts: sql`${emailOtps.attempts} + 1` })
    .where(and(eq(emailOtps.id, row.id), lt(emailOtps.attempts, OTP_MAX_ATTEMPTS), isNull(emailOtps.consumedAt)))
    .returning({ id: emailOtps.id });
  if (!counted.length) return false;

  const a = Buffer.from(hashCode(o.userId, o.email, o.purpose, o.code));
  const b = Buffer.from(row.codeHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const used = await db.update(emailOtps).set({ consumedAt: now }).where(and(eq(emailOtps.id, row.id), isNull(emailOtps.consumedAt))).returning({ id: emailOtps.id });
  return used.length === 1;
}
