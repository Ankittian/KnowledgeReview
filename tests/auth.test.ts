import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { createDb, applySchema, resetDatabase, type DbHandle } from "@/db/client";
import { loginSessions, refreshTokens, roleIdOf, users } from "@/db/schema";
import { rotateRefreshToken } from "@/lib/auth/refresh";
import { newRefreshToken, signAccessToken, verifyAccessToken } from "@/lib/auth/tokens";
import type { SessionUser } from "@/lib/auth/types";

const SECRET = "test-secret-test-secret-test-secret-0123456789";
let h: DbHandle;

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example).");
  h = createDb({ url });
  await resetDatabase(h);
  await applySchema(h);
});
afterAll(async () => h?.close());

beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
  delete process.env.JWT_SECRET_PREVIOUS;
  process.env.REFRESH_GRACE_SECONDS = "10";
  process.env.REFRESH_IDLE_DAYS = "7";
  process.env.REFRESH_TOKEN_DAYS = "30";
});

const user: SessionUser = { id: "00000000-0000-0000-0000-000000000001", username: "u", displayName: "U", department: null, primaryModule: "MM", role: "functional" };

describe("access token", () => {
  it("round-trips the claims", async () => {
    const v = await verifyAccessToken(await signAccessToken(user, "sid-1"));
    expect(v).toEqual({ sid: "sid-1", user });
  });
  it("rejects a tampered token, a wrong key, garbage and nothing", async () => {
    const jwt = await signAccessToken(user, "sid-1");
    const [a, b, c] = jwt.split(".");
    expect(await verifyAccessToken(`${a}.${b}x.${c}`)).toBeNull();
    process.env.JWT_SECRET = "another-secret-another-secret-another-secret-12345";
    expect(await verifyAccessToken(jwt)).toBeNull();
    expect(await verifyAccessToken("not-a-jwt")).toBeNull();
    expect(await verifyAccessToken(undefined)).toBeNull();
  });
  it("rejects an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const jwt = await new SignJWT({ sid: "s", role: "functional", username: "u" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt(past - 900)
      .setExpirationTime(past)
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyAccessToken(jwt)).toBeNull();
  });
  it("rejects an unsigned (alg none) token", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const none = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: user.id, sid: "s", username: "u", role: "admin", exp: Math.floor(Date.now() / 1000) + 600 })}.`;
    expect(await verifyAccessToken(none)).toBeNull();
  });
  it("accepts tokens signed with the previous secret during rotation", async () => {
    const old = await signAccessToken(user, "sid-1");
    process.env.JWT_SECRET_PREVIOUS = SECRET;
    process.env.JWT_SECRET = "rotated-secret-rotated-secret-rotated-secret-123";
    expect((await verifyAccessToken(old))?.sid).toBe("sid-1");
  });
  it("refuses to run without a strong secret", async () => {
    process.env.JWT_SECRET = "short";
    await expect(signAccessToken(user, "s")).rejects.toThrow(/JWT_SECRET/);
  });
});

let n = 0;
async function login(status: "active" | "disabled" = "active") {
  n += 1;
  const [u] = await h.db.insert(users).values({ username: `rt-user-${n}`, passwordHash: "x", displayName: `RT ${n}`, status, roleId: roleIdOf("functional") }).returning();
  const sid = `sid-rt-${n}`;
  const expiresAt = new Date(Date.now() + 30 * 86400_000);
  await h.db.insert(loginSessions).values({ id: sid, userId: u.id, expiresAt });
  const t = newRefreshToken();
  await h.db.insert(refreshTokens).values({ id: t.id, sessionId: sid, idleExpiresAt: new Date(Date.now() + 7 * 86400_000) });
  return { u, sid, token: t.token, tokenId: t.id };
}
const sessionExists = async (sid: string) => (await h.db.select().from(loginSessions).where(eq(loginSessions.id, sid))).length === 1;

describe("refresh token rotation", () => {
  it("returns a new access token and a new refresh token, and marks the old one used", async () => {
    const l = await login();
    const r = await rotateRefreshToken(h.db, l.token);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.refresh).not.toBeNull();
    expect(r.refresh!.token).not.toBe(l.token);
    expect((await verifyAccessToken(r.access))?.sid).toBe(l.sid);
    const [old] = await h.db.select().from(refreshTokens).where(eq(refreshTokens.id, l.tokenId));
    expect(old.usedAt).not.toBeNull();
    expect(old.replacedById).not.toBeNull();
    // the new one works too (chain continues)
    expect((await rotateRefreshToken(h.db, r.refresh!.token)).ok).toBe(true);
  });

  it("inside the grace window a reused token only yields an access token (parallel tabs)", async () => {
    const l = await login();
    const first = await rotateRefreshToken(h.db, l.token);
    const second = await rotateRefreshToken(h.db, l.token);
    expect(first.ok && second.ok).toBe(true);
    if (second.ok) expect(second.refresh).toBeNull();
    expect(await sessionExists(l.sid)).toBe(true);
  });

  it("after the grace window a reused token kills the whole session", async () => {
    const l = await login();
    const first = await rotateRefreshToken(h.db, l.token);
    await h.db.update(refreshTokens).set({ usedAt: new Date(Date.now() - 60_000) }).where(eq(refreshTokens.id, l.tokenId));
    const replay = await rotateRefreshToken(h.db, l.token);
    expect(replay).toEqual({ ok: false, reason: "reuse" });
    expect(await sessionExists(l.sid)).toBe(false);
    // the legitimate holder's newer token is gone as well
    if (first.ok) expect((await rotateRefreshToken(h.db, first.refresh!.token)).ok).toBe(false);
  });

  it("refuses a disabled user and deletes the session", async () => {
    const l = await login();
    await h.db.update(users).set({ status: "disabled" }).where(eq(users.id, l.u.id));
    expect(await rotateRefreshToken(h.db, l.token)).toEqual({ ok: false, reason: "disabled" });
    expect(await sessionExists(l.sid)).toBe(false);
  });

  it("picks up a role change at refresh", async () => {
    const l = await login();
    await h.db.update(users).set({ roleId: roleIdOf("admin") }).where(eq(users.id, l.u.id));
    const r = await rotateRefreshToken(h.db, l.token);
    expect(r.ok && r.user.role).toBe("admin");
  });

  it("expires after the idle period", async () => {
    const l = await login();
    await h.db.update(refreshTokens).set({ idleExpiresAt: new Date(Date.now() - 1000) }).where(eq(refreshTokens.id, l.tokenId));
    expect(await rotateRefreshToken(h.db, l.token)).toEqual({ ok: false, reason: "expired" });
    expect(await sessionExists(l.sid)).toBe(false);
  });

  it("never extends a login past its absolute expiry", async () => {
    const l = await login();
    const soon = new Date(Date.now() + 3600_000);
    await h.db.update(loginSessions).set({ expiresAt: soon }).where(eq(loginSessions.id, l.sid));
    const r = await rotateRefreshToken(h.db, l.token);
    expect(r.ok && r.refresh!.expires.getTime()).toBeLessThanOrEqual(soon.getTime());
  });

  it("rejects an unknown token", async () => {
    expect(await rotateRefreshToken(h.db, "nope")).toEqual({ ok: false, reason: "unknown" });
  });

  it("deleting a user's sessions invalidates their refresh tokens", async () => {
    const l = await login();
    await h.db.delete(loginSessions).where(eq(loginSessions.userId, l.u.id));
    expect(await rotateRefreshToken(h.db, l.token)).toEqual({ ok: false, reason: "unknown" });
  });
});
