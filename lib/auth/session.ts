import crypto from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sessions, users } from "@/db/schema";

export const SESSION_COOKIE = "kr_session";
const SESSION_DAYS = 30;

export type Role = "employee" | "reviewer" | "admin";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  department: string | null;
  primaryModule: string | null;
  role: Role;
}

export interface Session {
  sessionId: string;
  user: SessionUser;
}

const tokenId = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string, userAgent: string | null): Promise<string> {
  const db = await getDb();
  const token = crypto.randomBytes(32).toString("base64url");
  const id = tokenId(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(sessions).values({ id, userId, expiresAt, userAgent: userAgent?.slice(0, 400) ?? null });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires: expiresAt,
  });
  return id;
}

/** Current session (active users only). Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({
      sessionId: sessions.id,
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      department: users.department,
      primaryModule: users.primaryModule,
      role: users.role,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, tokenId(token)), gt(sessions.expiresAt, new Date())));
  if (!row || row.status !== "active") return null;
  const { sessionId, status: _status, ...user } = row;
  return { sessionId, user };
});

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, tokenId(token)));
  }
  jar.delete(SESSION_COOKIE);
}

export async function revokeUserSessions(userId: string): Promise<void> {
  const db = await getDb();
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function requireUser(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function requireRole(roles: Role[]): Promise<Session> {
  const s = await requireUser();
  if (!roles.includes(s.user.role)) redirect("/today");
  return s;
}

export const canReview = (role: Role) => role === "reviewer" || role === "admin";
