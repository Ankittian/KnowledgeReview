"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { issueOtp, verifyOtp } from "@/lib/auth/otp";
import { verifyPassword } from "@/lib/auth/password";
import { requireUser } from "@/lib/auth/session";
import { OTP_MAX_FAILS_PER_IP_15MIN, OTP_MAX_SENDS_PER_IP_HOUR, recentCount } from "@/lib/auth/throttle";
import { logEvent } from "@/lib/events";
import { sendOtpMail } from "@/lib/mail";
import { requestMeta } from "@/lib/request";
import { requestEmailSchema, verifyEmailSchema } from "@/lib/validation";
import type { FormState } from "./auth";

const pick = (fd: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, String(fd.get(k) ?? "")]));
const BAD_CODE = "That code is not valid or has expired. Request a new one.";
const HOURLY_MSG = "Too many codes requested. Try again in an hour.";

/**
 * Step 1 of adding or changing the email: send a code to the NEW address. Changing an existing email also needs the
 * current password, so a stolen session cannot silently redirect the account's recovery email.
 */
export async function requestEmailOtpAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user: me, sessionId } = await requireUser();
  const raw = pick(fd, ["email", "currentPassword"]);
  const parsed = requestEmailSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: { email: parsed.error.issues[0].message }, values: { email: raw.email } };
  const { email, currentPassword } = parsed.data;
  const values = { email };
  const meta = await requestMeta();
  const db = await getDb();

  const [u] = await db.select().from(users).where(eq(users.id, me.id));
  if (!u || u.status !== "active") return { error: "Your account is not active.", values };
  if (u.emailVerifiedAt && u.email) {
    if (u.email === email) return { fieldErrors: { email: "That is already your email address." }, values };
    if ((await recentCount("password_change_failed", 15, { username: me.username })) >= 8) return { error: "Too many failed attempts. Try again in 15 minutes.", values };
    if (!currentPassword || !(await verifyPassword(u.passwordHash, currentPassword))) {
      await logEvent(db, { userId: me.id, type: "password_change_failed", payload: { username: me.username }, sessionId, ip: meta.ip });
      return { fieldErrors: { currentPassword: "Enter your current password to change your email." }, values };
    }
  }
  if (meta.ip && (await recentCount("email_otp_sent", 60, { ip: meta.ip })) >= OTP_MAX_SENDS_PER_IP_HOUR) return { error: HOURLY_MSG, values };

  // Another account already has this address. Say so without saying whose.
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (taken && taken.id !== me.id) return { fieldErrors: { email: "That email address can't be used for this account." }, values };

  const issued = await issueOtp(db, { userId: me.id, email, purpose: "verify_email" });
  if (!issued.ok) {
    return issued.reason === "cooldown"
      ? { step: "verify", values, error: `A code was sent a moment ago. Try again in ${issued.waitSeconds} seconds.` }
      : { error: HOURLY_MSG, values };
  }
  try {
    await sendOtpMail(email, issued.code, "verify_email");
  } catch (e) {
    console.error("[mail] verify_email code not sent:", e instanceof Error ? e.message : e);
    return { error: "We could not send the email. Check the address and try again shortly.", values };
  }
  await logEvent(db, { userId: me.id, type: "email_otp_sent", payload: { purpose: "verify_email" }, sessionId, ip: meta.ip });
  return { step: "verify", values, success: `We sent a 6-digit code to ${email}. It expires in 10 minutes.` };
}

/** Step 2: the right code proves the owner reads this inbox; only now is the email saved on the account. */
export async function verifyEmailOtpAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user: me, sessionId } = await requireUser();
  const raw = pick(fd, ["email", "code"]);
  const parsed = verifyEmailSchema.safeParse(raw);
  if (!parsed.success) return { step: "verify", values: { email: raw.email }, fieldErrors: { code: parsed.error.issues[0].message } };
  const { email, code } = parsed.data;
  const values = { email };
  const meta = await requestMeta();
  const db = await getDb();
  if (meta.ip && (await recentCount("otp_failed", 15, { ip: meta.ip })) >= OTP_MAX_FAILS_PER_IP_15MIN) {
    return { step: "verify", values, error: "Too many failed attempts. Try again in 15 minutes." };
  }
  if (!(await verifyOtp(db, { userId: me.id, email, purpose: "verify_email", code }))) {
    await logEvent(db, { userId: me.id, type: "otp_failed", payload: { purpose: "verify_email" }, sessionId, ip: meta.ip });
    return { step: "verify", values, fieldErrors: { code: BAD_CODE } };
  }
  try {
    await db.update(users).set({ email, emailVerifiedAt: new Date() }).where(eq(users.id, me.id));
  } catch {
    // unique index: someone verified this address first
    return { values, fieldErrors: { email: "That email address can't be used for this account." } };
  }
  await logEvent(db, { userId: me.id, type: "email_verified", sessionId, ip: meta.ip });
  revalidatePath("/profile");
  return { success: "Email verified. You can now sign in with it and recover your password by email." };
}
