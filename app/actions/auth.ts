"use server";

import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { getDb, query } from "@/db/client";
import { roleIdOf, users } from "@/db/schema";
import { dummyHash, hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, getSession } from "@/lib/auth/session";
import { logEvent } from "@/lib/events";
import { requestMeta } from "@/lib/request";
import { loginSchema, signupSchema } from "@/lib/validation";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}

const MAX_FAILS_PER_USER = 8;
const MAX_FAILS_PER_IP = 40;
const MAX_SIGNUPS_PER_IP_HOUR = 10;

async function recentCount(type: string, minutes: number, by: { username?: string; ip?: string | null }) {
  const db = await getDb();
  const filter = by.username ? sql`details->>'username' = ${by.username}` : sql`ip = ${by.ip ?? ""}`;
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

  if ((await recentCount("login_failed", 15, { username })) >= MAX_FAILS_PER_USER || (meta.ip && (await recentCount("login_failed", 15, { ip: meta.ip })) >= MAX_FAILS_PER_IP)) {
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
  const next = String(fd.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/today");
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

export async function logoutAction(): Promise<void> {
  const s = await getSession();
  if (s) {
    const meta = await requestMeta();
    await logEvent(await getDb(), { userId: s.user.id, type: "logout", sessionId: s.sessionId, ip: meta.ip });
  }
  await destroySession();
  redirect("/login");
}
