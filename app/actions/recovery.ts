"use server";

import { redirect } from "next/navigation";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { issueOtp, verifyOtp } from "@/lib/auth/otp";
import { hashPassword } from "@/lib/auth/password";
import { safeNext } from "@/lib/auth/safe-next";
import { createSession, requireUser, revokeOtherSessions, revokeUserSessions } from "@/lib/auth/session";
import { OTP_MAX_FAILS_PER_IP_15MIN, OTP_MAX_SENDS_PER_IP_HOUR, recentCount } from "@/lib/auth/throttle";
import { logEvent } from "@/lib/events";
import { sendOtpMail } from "@/lib/mail";
import { requestMeta } from "@/lib/request";
import { changePasswordWithOtpSchema, identifierSchema, otpCodeSchema, resetPasswordSchema } from "@/lib/validation";
import type { FormState } from "./auth";

const pick = (fd: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, String(fd.get(k) ?? "")]));

const fieldErrorsOf = (issues: { path: PropertyKey[]; message: string }[]) => {
  const fe: Record<string, string> = {};
  for (const i of issues) fe[String(i.path[0])] ??= i.message;
  return fe;
};

const COOLDOWN_MSG = (s: number) => `A code was sent a moment ago. Try again in ${s} seconds.`;
const HOURLY_MSG = "Too many codes requested. Try again in an hour.";
const BAD_CODE = "That code is not valid or has expired. Request a new one.";
const TOO_MANY = "Too many failed attempts. Try again in 15 minutes.";

/** The signed-in user's verified email, or null. */
async function verifiedEmailOf(userId: string) {
  const db = await getDb();
  const [u] = await db.select({ email: users.email, verifiedAt: users.emailVerifiedAt, status: users.status }).from(users).where(eq(users.id, userId));
  return u && u.status === "active" && u.email && u.verifiedAt ? u.email : null;
}

/** Signed in: email a code to the verified address, so the new password does not need the old one. */
export async function requestPasswordOtpAction(): Promise<FormState> {
  const { user: me, sessionId } = await requireUser();
  const email = await verifiedEmailOf(me.id);
  if (!email) return { error: "Add and verify an email address first." };
  const meta = await requestMeta();
  const db = await getDb();
  if (meta.ip && (await recentCount("email_otp_sent", 60, { ip: meta.ip })) >= OTP_MAX_SENDS_PER_IP_HOUR) return { error: HOURLY_MSG };
  const issued = await issueOtp(db, { userId: me.id, email, purpose: "change_password" });
  if (!issued.ok) return { error: issued.reason === "cooldown" ? COOLDOWN_MSG(issued.waitSeconds) : HOURLY_MSG, step: issued.reason === "cooldown" ? "verify" : undefined };
  try {
    await sendOtpMail(email, issued.code, "change_password");
  } catch (e) {
    console.error("[mail] change_password code not sent:", e instanceof Error ? e.message : e);
    return { error: "We could not send the email. Try again shortly." };
  }
  await logEvent(db, { userId: me.id, type: "email_otp_sent", payload: { purpose: "change_password" }, sessionId, ip: meta.ip });
  return { step: "verify", success: `We sent a 6-digit code to ${email}.` };
}

/** Signed in: new password authorised by the emailed code. Other devices are signed out. */
export async function changePasswordWithOtpAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user: me, sessionId } = await requireUser();
  const parsed = changePasswordWithOtpSchema.safeParse(pick(fd, ["code", "newPassword", "confirmPassword"]));
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues), step: "verify" };
  const email = await verifiedEmailOf(me.id);
  if (!email) return { error: "Add and verify an email address first." };
  const meta = await requestMeta();
  const db = await getDb();
  if (meta.ip && (await recentCount("otp_failed", 15, { ip: meta.ip })) >= OTP_MAX_FAILS_PER_IP_15MIN) return { error: TOO_MANY, step: "verify" };
  if (!(await verifyOtp(db, { userId: me.id, email, purpose: "change_password", code: parsed.data.code }))) {
    await logEvent(db, { userId: me.id, type: "otp_failed", payload: { purpose: "change_password" }, sessionId, ip: meta.ip });
    return { fieldErrors: { code: BAD_CODE }, step: "verify" };
  }
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.newPassword) }).where(eq(users.id, me.id));
  await revokeOtherSessions(me.id, sessionId);
  await logEvent(db, { userId: me.id, type: "password_changed_otp", sessionId, ip: meta.ip });
  return { success: "Password updated. You were signed out on your other devices." };
}

type CodeTarget = { kind: "none" } | { kind: "no_email" } | { kind: "ok"; id: string; email: string };

/** Finds the account by username or verified email and says whether it can receive a code. */
async function lookupForCode(identifier: string): Promise<CodeTarget> {
  const db = await getDb();
  const [u] = identifier.includes("@")
    ? await db.select().from(users).where(and(eq(sql`lower(${users.email})`, identifier), isNotNull(users.emailVerifiedAt)))
    : await db.select().from(users).where(eq(users.username, identifier));
  if (!u || u.status === "disabled") return { kind: "none" };
  if (u.status !== "active" || !u.email || !u.emailVerifiedAt) return { kind: "no_email" };
  return { kind: "ok", id: u.id, email: u.email };
}

/** A user who can receive a code: active, with a verified email. */
async function resettableUser(identifier: string) {
  const t = await lookupForCode(identifier);
  return t.kind === "ok" ? { id: t.id, email: t.email } : null;
}

const maskEmail = (e: string) => e.replace(/^(.)(.*)(@.*)$/, (_, a: string, b: string, c: string) => `${a}${"*".repeat(Math.min(b.length, 6))}${c}`);

/**
 * Step 1 of "forgot password" and of "sign in with a code": email a code to the account's verified address.
 * Says plainly when no account matches (this does reveal whether a username or email exists; the per-IP and
 * per-account limits are what keep that from being used to scan).
 */
async function requestCode(identifier: string, purpose: "reset_password" | "login", step: "reset" | "verify"): Promise<FormState> {
  const meta = await requestMeta();
  const db = await getDb();
  const values = { identifier };
  const eventType = purpose === "login" ? "login_code_requested" : "password_reset_requested";
  if (meta.ip && (await recentCount("email_otp_sent", 60, { ip: meta.ip })) >= OTP_MAX_SENDS_PER_IP_HOUR) return { error: HOURLY_MSG, values };

  const found = await lookupForCode(identifier);
  if (found.kind !== "ok") {
    await logEvent(db, { type: eventType, payload: { username: identifier, matched: false, reason: found.kind }, ip: meta.ip });
    return found.kind === "none"
      ? { fieldErrors: { identifier: "No account found with that username or email." }, values }
      : { error: "This account has no verified email, so we cannot send a code. Sign in with your password, or ask an administrator to reset it.", values };
  }
  const issued = await issueOtp(db, { userId: found.id, email: found.email, purpose });
  if (!issued.ok) return { error: issued.reason === "cooldown" ? COOLDOWN_MSG(issued.waitSeconds) : HOURLY_MSG, values, step: issued.reason === "cooldown" ? step : undefined };
  try {
    await sendOtpMail(found.email, issued.code, purpose);
  } catch (e) {
    console.error(`[mail] ${purpose} code not sent:`, e instanceof Error ? e.message : e);
    return { error: "We could not send the email. Try again shortly.", values };
  }
  await logEvent(db, { userId: found.id, type: eventType, payload: { username: identifier, matched: true }, ip: meta.ip });
  await logEvent(db, { userId: found.id, type: "email_otp_sent", payload: { purpose }, ip: meta.ip });
  return { step, values, success: `We sent a 6-digit code to ${maskEmail(found.email)}. It expires in 10 minutes.` };
}

/** Signed out, step 1 of "forgot password". */
export async function requestPasswordResetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = identifierSchema.safeParse(String(fd.get("identifier") ?? ""));
  if (!parsed.success) return { fieldErrors: { identifier: parsed.error.issues[0].message } };
  return requestCode(parsed.data, "reset_password", "reset");
}

/** Signed out, step 2. The right code plus a new password sets the password and signs the user out everywhere. */
export async function resetPasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = pick(fd, ["identifier", "code", "newPassword", "confirmPassword"]);
  const values = { identifier: raw.identifier };
  const parsed = resetPasswordSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues), values, step: "reset" };
  const { identifier, code, newPassword } = parsed.data;
  const meta = await requestMeta();
  const db = await getDb();
  if (meta.ip && (await recentCount("otp_failed", 15, { ip: meta.ip })) >= OTP_MAX_FAILS_PER_IP_15MIN) return { error: TOO_MANY, values, step: "reset" };

  const target = await resettableUser(identifier);
  let ok = false;
  if (target) ok = await verifyOtp(db, { userId: target.id, email: target.email, purpose: "reset_password", code });
  else await hashPassword("padding-so-timing-matches"); // keep the unknown-account path as slow as the real one
  if (!target || !ok) {
    await logEvent(db, { userId: target?.id, type: "otp_failed", payload: { purpose: "reset_password", username: identifier }, ip: meta.ip });
    return { fieldErrors: { code: BAD_CODE }, values, step: "reset" };
  }
  await db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, target.id));
  await revokeUserSessions(target.id);
  await logEvent(db, { userId: target.id, type: "password_reset", ip: meta.ip });
  redirect("/login?reset=1");
}

/** Sign in without a password: step 1 emails a code to the verified address of the account (username or email). */
export async function requestLoginCodeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = identifierSchema.safeParse(String(fd.get("identifier") ?? ""));
  if (!parsed.success) return { fieldErrors: { identifier: parsed.error.issues[0].message } };
  return requestCode(parsed.data, "login", "verify");
}

/** Sign in without a password: step 2. The right code opens a normal login session. */
export async function loginWithCodeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = pick(fd, ["identifier", "code"]);
  const values = { identifier: raw.identifier };
  const id = identifierSchema.safeParse(raw.identifier);
  const code = otpCodeSchema.safeParse(raw.code);
  if (!id.success || !code.success) return { step: "verify", values, fieldErrors: { code: code.success ? "Enter your username or email." : code.error.issues[0].message } };
  const meta = await requestMeta();
  const db = await getDb();
  if (meta.ip && (await recentCount("otp_failed", 15, { ip: meta.ip })) >= OTP_MAX_FAILS_PER_IP_15MIN) return { step: "verify", values, error: TOO_MANY };

  const target = await resettableUser(id.data);
  let ok = false;
  if (target) ok = await verifyOtp(db, { userId: target.id, email: target.email, purpose: "login", code: code.data });
  else await hashPassword("padding-so-timing-matches");
  if (!target || !ok) {
    await logEvent(db, { userId: target?.id, type: "otp_failed", payload: { purpose: "login", username: id.data }, ip: meta.ip });
    return { step: "verify", values, fieldErrors: { code: BAD_CODE } };
  }
  const sessionId = await createSession(target.id);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, target.id));
  await logEvent(db, { userId: target.id, type: "login", payload: { method: "email_code" }, sessionId, ip: meta.ip });
  redirect(safeNext(fd.get("next")));
}
