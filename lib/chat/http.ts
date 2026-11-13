import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { loginSessions, roles, users } from "@/db/schema";
import { getSession, type Role, type Session } from "@/lib/auth/session";
import { isSameOrigin, json, requestMeta } from "@/lib/request";

export interface ChatCaller {
  session: Session;
  isAdmin: boolean;
  meta: { sessionId: string; ip: string | null; userAgent: string | null };
}

/**
 * Auth for chat API routes. Unlike `getSession()` alone (which trusts the access token for a few minutes), this
 * re-checks that the login session still exists and the user is active, so deactivation cuts chat access at once.
 * Returns a Response to send back when the caller is not allowed.
 */
export async function chatCaller(req: Request, opts: { mutating: boolean }): Promise<ChatCaller | Response> {
  if (opts.mutating && !isSameOrigin(req)) return json({ error: "Bad origin" }, 403);
  const session = await getSession();
  if (!session) return json({ error: "Not signed in" }, 401);
  const db = await getDb();
  const [live] = await db
    .select({ role: roles.name, status: users.status })
    .from(loginSessions)
    .innerJoin(users, eq(users.id, loginSessions.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(loginSessions.id, session.sessionId), eq(users.id, session.user.id)));
  if (!live || live.status !== "active") return json({ error: "Not signed in" }, 401);
  const meta = await requestMeta();
  return {
    session: { ...session, user: { ...session.user, role: live.role as Role } },
    isAdmin: live.role === "admin",
    meta: { sessionId: session.sessionId, ip: meta.ip, userAgent: meta.userAgent },
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export const parseId = (s: string) => (/^\d{1,15}$/.test(s) ? Number(s) : null);
