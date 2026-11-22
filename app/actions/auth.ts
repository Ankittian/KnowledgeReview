"use server";

import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { getDb, query } from "@/db/client";
import { roleIdOf, users } from "@/db/schema";
import { safeNext } from "@/lib/auth/safe-next";
import { dummyHash, hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, getSession, requireUser, revokeOtherSessions } from "@/lib/auth/session";
import { logEvent } from "@/lib/events";
import { requestMeta } from "@/lib/request";
import { changePasswordSchema, loginSchema, signupSchema } from "@/lib/validation";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  success?: string;
}

// Failures are counted per (username, IP) pair, so a stranger guessing wrong passwords for "admin" from their own
// address cannot lock the real admin out from theirs. The username-only ceiling is a high backstop against guessing
// spread over many addresses; the IP ceiling stops one address spraying many usernames. Without a trusted IP
// (see lib/client-ip.ts) the username alone is limited at the lower figure.
const MAX_FAILS_PER_USER_AND_IP = 8;
const MAX_FAILS_PER_USER = 50;
const MAX_FAILS_PER_USER_NO_IP = 8;
const MAX_FAILS_PER_IP = 40;
const MAX_SIGNUPS_PER_IP_HOUR = 10;
const MAX_PENDING_USERS = 200; // sign-ups waiting for approval; stops a flood of fake accounts

async function recentCount(type: string, minutes: number, by: { username?: string; ip?: string | null }) {
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

const pick = (fd: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, String(fd.get(k) ?? "")]));

export async function loginAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = pick(fd, ["username", "password"]);
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message, values: { username: raw.username } };
  const { username, password } = parsed.data;
  const meta = await requestMeta();
  const db = await getDb();

  const blocked = meta.ip
    ? (await recentCount("login_failed", 15, { username, ip: meta.ip })) >= MAX_FAILS_PER_USER_AND_IP ||
      (await recentCount("login_failed", 15, { ip: meta.ip })) >= MAX_FAILS_PER_IP ||
      (await recentCount("login_failed", 15, { username })) >= MAX_FAILS_PER_USER
    : (await recentCount("login_failed", 15, { username })) >= MAX_FAILS_PER_USER_NO_IP;
  if (blocked) {
    return { error: "Too many failed attempts. Try again in 15 minutes.", values: { username } };
  }

  const [user] = await db.select().from(users).where(eq(users.username, username));
  const ok = user ? await verifyPassword(user.passwordHash, password) : (await verifyPassword(await dummyHash(), password), false);
  if (!user || !ok) {
    await logEvent(db, { type: "login_failed", payload: { username }, ip: meta.ip });
    return { error: "Incorrect username or password.", values: { username } };
  }
  if (user.status === "pending") {
    await logEvent(db, { userId: user.id, type: "login_pending", ip: meta.ip });
    redirect("/pending");
  }
  if (user.status === "disabled") {
    await logEvent(db, { userId: user.id, type: "login_disabled", ip: meta.ip });
    return { error: "Your account is disabled. Contact an administrator.", values: { username } };
  }

  const sessionId = await createSession(user.id);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await logEvent(db, { userId: user.id, type: "login", sessionId, ip: meta.ip });
  redirect(safeNext(fd.get("next")));
}

export async function signupAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = pick(fd, ["username", "displayName", "department", "primaryModule", "password", "confirmPassword"]);
  const values = { username: raw.username, displayName: raw.displayName, department: raw.department, primaryModule: raw.primaryModule };
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors, values };
  }
  const meta = await requestMeta();
  if (meta.ip && (await recentCount("signup", 60, { ip: meta.ip })) >= MAX_SIGNUPS_PER_IP_HOUR) {
    return { error: "Too many sign-ups from this network. Try again later.", values };
  }
  const db = await getDb();
  const [{ pending }] = await query<{ pending: number }>(db, sql`SELECT count(*)::int AS pending FROM users WHERE status = 'pending'`);
  if (pending >= MAX_PENDING_USERS) return { error: "Sign-ups are paused until an administrator reviews pending accounts.", values };
  const d = parsed.data;
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.username, d.username));
  if (exists) return { fieldErrors: { username: "That username is taken." }, values };

  const [u] = await db
    .insert(users)
    .values({
      username: d.username,
      passwordHash: await hashPassword(d.password),
      displayName: d.displayName,
      department: d.department,
      primaryModule: d.primaryModule,
      roleId: roleIdOf("functional"),
      status: "pending",
    })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (!u) return { fieldErrors: { username: "That username is taken." }, values };
  await logEvent(db, { userId: u.id, type: "signup", payload: { username: d.username }, ip: meta.ip });
  redirect("/pending?new=1");
}

/** A signed-in user changes their own password. Other devices are signed out; this one stays signed in. */
export async function changePasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user: me, sessionId } = await requireUser();
  const parsed = changePasswordSchema.safeParse(pick(fd, ["currentPassword", "newPassword", "confirmPassword"]));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors };
  }
  const { currentPassword, newPassword } = parsed.data;
  const meta = await requestMeta();
  const db = await getDb();

  // Same throttle idea as sign-in: a stolen session must not be able to guess the current password.
  if ((await recentCount("password_change_failed", 15, { username: me.username })) >= MAX_FAILS_PER_USER_AND_IP) {
    return { error: "Too many failed attempts. Try again in 15 minutes." };
  }
  const [user] = await db.select().from(users).where(eq(users.id, me.id));
  if (!user || user.status !== "active") return { error: "Your account is not active." };
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    await logEvent(db, { userId: me.id, type: "password_change_failed", payload: { username: me.username }, sessionId, ip: meta.ip });
    return { fieldErrors: { currentPassword: "That is not your current password." } };
  }

  await db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, me.id));
  await revokeOtherSessions(me.id, sessionId);
  await logEvent(db, { userId: me.id, type: "password_changed", sessionId, ip: meta.ip });
  return { success: "Password updated. You were signed out on your other devices." };
}

export async function logoutAction(): Promise<void> {
  const s = await getSession();
  if (s) {
    const meta = await requestMeta();
    await logEvent(await getDb(), { userId: s.user.id, type: "logout", sessionId: s.sessionId, ip: meta.ip });
  }
  await destroySession();
  redirect("/login");
}
