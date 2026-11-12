import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import type { DB } from "@/db/client";
import { refreshTokens, sessions, users } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { authConfig, newRefreshToken, sha256, signAccessToken } from "./tokens";
import type { SessionUser } from "./types";

export type RotateResult =
  | { ok: true; sid: string; user: SessionUser; access: string; refresh: { token: string; expires: Date } | null }
  | { ok: false; reason: "unknown" | "expired" | "disabled" | "reuse" };

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Exchange a refresh token for a new access token (and, normally, a new refresh token).
 *
 *  - the token must exist, not be past its absolute or idle expiry, and its user must still be active;
 *  - a token is single-use: it is marked used and replaced;
 *  - presenting a used token again within the grace window (two tabs, parallel requests) only gets a new access
 *    token, with no new refresh token, so the first caller's rotation stays valid;
 *  - presenting a used token after the grace window means it leaked: the whole session is deleted.
 */
export async function rotateRefreshToken(db: DB, token: string, meta: Meta = {}): Promise<RotateResult> {
  const cfg = authConfig();
  const now = new Date();
  const id = sha256(token);

  const [row] = await db
    .select({
      tokenId: refreshTokens.id,
      sid: refreshTokens.sessionId,
      usedAt: refreshTokens.usedAt,
      expiresAt: refreshTokens.expiresAt,
      idleExpiresAt: refreshTokens.idleExpiresAt,
      uid: users.id,
      username: users.username,
      displayName: users.displayName,
      department: users.department,
      primaryModule: users.primaryModule,
      role: users.role,
      status: users.status,
    })
    .from(refreshTokens)
    .innerJoin(sessions, eq(sessions.id, refreshTokens.sessionId))
    .innerJoin(users, eq(users.id, refreshTokens.userId))
    .where(eq(refreshTokens.id, id));
  if (!row) return { ok: false, reason: "unknown" };

  const killSession = () => db.delete(sessions).where(eq(sessions.id, row.sid)); // cascades to its refresh tokens
  const event = (type: string) => logEvent(db, { userId: row.uid, type, sessionId: row.sid, ip: meta.ip, userAgent: meta.userAgent });

  if (now >= row.expiresAt || now >= row.idleExpiresAt) {
    await killSession();
    return { ok: false, reason: "expired" };
  }
  if (row.status !== "active") {
    await killSession();
    await event("token_refresh_denied");
    return { ok: false, reason: "disabled" };
  }

  const user: SessionUser = {
    id: row.uid,
    username: row.username,
    displayName: row.displayName,
    department: row.department,
    primaryModule: row.primaryModule,
    role: row.role,
  };
  const withinGrace = (usedAt: Date) => now.getTime() - usedAt.getTime() <= cfg.graceSeconds * 1000;
  const accessOnly = async (): Promise<RotateResult> => ({ ok: true, sid: row.sid, user, access: await signAccessToken(user, row.sid), refresh: null });

  if (row.usedAt) {
    if (withinGrace(row.usedAt)) return accessOnly();
    await killSession();
    await event("token_reuse_detected");
    return { ok: false, reason: "reuse" };
  }

  // Claim it atomically: if a parallel request got there first, treat this one as the grace case.
  const claimed = await db
    .update(refreshTokens)
    .set({ usedAt: now })
    .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.usedAt)))
    .returning({ id: refreshTokens.id });
  if (!claimed.length) {
    const [cur] = await db.select({ usedAt: refreshTokens.usedAt }).from(refreshTokens).where(eq(refreshTokens.id, id));
    if (cur?.usedAt && withinGrace(cur.usedAt)) return accessOnly();
    if (!cur) return { ok: false, reason: "unknown" };
    await killSession();
    await event("token_reuse_detected");
    return { ok: false, reason: "reuse" };
  }

  const next = newRefreshToken();
  const idleExpiresAt = new Date(Math.min(row.expiresAt.getTime(), now.getTime() + cfg.idleDays * 86400_000));
  await db.insert(refreshTokens).values({
    id: next.id,
    sessionId: row.sid,
    userId: row.uid,
    expiresAt: row.expiresAt,
    idleExpiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 400) ?? null,
  });
  await db.update(refreshTokens).set({ replacedById: next.id }).where(eq(refreshTokens.id, id));
  // Housekeeping: drop this session's used tokens once they are well past the grace window.
  await db
    .delete(refreshTokens)
    .where(and(eq(refreshTokens.sessionId, row.sid), isNotNull(refreshTokens.usedAt), lt(refreshTokens.usedAt, new Date(now.getTime() - 86400_000))));

  return { ok: true, sid: row.sid, user, access: await signAccessToken(user, row.sid), refresh: { token: next.token, expires: idleExpiresAt } };
}
