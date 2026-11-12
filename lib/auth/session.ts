import crypto from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { refreshTokens, sessions, users } from "@/db/schema";
import { accessCookie, ACCESS_COOKIE, authConfig, clearedCookie, newRefreshToken, REFRESH_COOKIE, refreshCookie, sha256, signAccessToken, verifyAccessToken } from "./tokens";
import type { Role, Session, SessionUser } from "./types";

export type { Role, Session, SessionUser } from "./types";

/**
 * Login = a `sessions` row (the login session, id = JWT `sid`) + a short-lived access JWT (cookie `kr_access`)
 * + a rotating opaque refresh token (cookie `kr_refresh`, stored hashed in `refresh_tokens`).
 * The proxy (proxy.ts) renews the access token from the refresh token; server components only read cookies.
 */
export async function createSession(userId: string, userAgent: string | null, ip: string | null = null): Promise<string> {
  const db = await getDb();
  const cfg = authConfig();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new Error("createSession: unknown user");

  // Housekeeping: drop sessions past their absolute expiry, or idle past the refresh window (cascades to refresh_tokens).
  const now = new Date();
  await db.delete(sessions).where(
    or(
      lt(sessions.expiresAt, now),
      sql`not exists (select 1 from ${refreshTokens} where ${refreshTokens.sessionId} = ${sessions.id} and ${refreshTokens.idleExpiresAt} > ${now})`,
    ),
  );

  const sid = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + cfg.refreshDays * 86400_000);
  const idleExpiresAt = new Date(Math.min(expiresAt.getTime(), Date.now() + cfg.idleDays * 86400_000));
  await db.insert(sessions).values({ id: sid, userId, expiresAt, userAgent: userAgent?.slice(0, 400) ?? null });
  const rt = newRefreshToken();
  await db.insert(refreshTokens).values({ id: rt.id, sessionId: sid, userId, expiresAt, idleExpiresAt, ip, userAgent: userAgent?.slice(0, 400) ?? null });

  const user: SessionUser = { id: u.id, username: u.username, displayName: u.displayName, department: u.department, primaryModule: u.primaryModule, role: u.role };
  const jar = await cookies();
  jar.set(accessCookie(await signAccessToken(user, sid)));
  jar.set(refreshCookie(rt.token, idleExpiresAt));
  return sid;
}

/** Current login, from the verified access token (no database call). Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  const v = await verifyAccessToken(jar.get(ACCESS_COOKIE)?.value);
  return v ? { sessionId: v.sid, user: v.user } : null;
});

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const db = await getDb();
  const fromAccess = (await verifyAccessToken(jar.get(ACCESS_COOKIE)?.value))?.sid;
  const refresh = jar.get(REFRESH_COOKIE)?.value;
  const fromRefresh = !fromAccess && refresh ? (await db.select({ sid: refreshTokens.sessionId }).from(refreshTokens).where(eq(refreshTokens.id, sha256(refresh))))[0]?.sid : undefined;
  const sid = fromAccess ?? fromRefresh;
  if (sid) await db.delete(sessions).where(eq(sessions.id, sid)); // cascades to refresh_tokens
  jar.set(clearedCookie(ACCESS_COOKIE));
  jar.set(clearedCookie(REFRESH_COOKIE));
}

export async function revokeUserSessions(userId: string): Promise<void> {
  const db = await getDb();
  await db.delete(sessions).where(eq(sessions.userId, userId)); // cascades to refresh_tokens
}

export async function requireUser(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/**
 * Role gate. Unlike requireUser (which trusts the access token for up to ACCESS_TOKEN_MINUTES), this re-checks the
 * database, so disabling a user, changing a role or revoking a session locks them out of admin screens at once.
 */
export async function requireRole(roles: Role[]): Promise<Session> {
  const s = await requireUser();
  const db = await getDb();
  const [live] = await db
    .select({ role: users.role, status: users.status })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, s.sessionId), eq(users.id, s.user.id)));
  if (!live || live.status !== "active") redirect("/login");
  if (!roles.includes(live.role)) redirect("/today");
  return { sessionId: s.sessionId, user: { ...s.user, role: live.role } };
}

export const canReview = (role: Role) => role === "reviewer" || role === "admin";
