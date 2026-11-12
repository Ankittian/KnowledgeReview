import crypto from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { Role, SessionUser } from "./types";

export const ACCESS_COOKIE = "kr_access";
export const REFRESH_COOKIE = "kr_refresh";

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Token lifetimes, read from the environment on every call (so tests can change them). */
export function authConfig() {
  return {
    accessSeconds: Math.round(num(process.env.ACCESS_TOKEN_MINUTES, 15) * 60),
    refreshDays: num(process.env.REFRESH_TOKEN_DAYS, 30), // absolute life of a login
    idleDays: num(process.env.REFRESH_IDLE_DAYS, 7), // a login unused this long is gone
    graceSeconds: num(process.env.REFRESH_GRACE_SECONDS, 10), // parallel tabs may refresh with the same token
    secure: process.env.COOKIE_SECURE === "true",
  };
}

const enc = (s: string) => new TextEncoder().encode(s);

function secrets(): Uint8Array[] {
  const cur = process.env.JWT_SECRET;
  if (!cur || cur.length < 32) throw new Error("JWT_SECRET must be set to a random string of at least 32 characters (see .env.example).");
  const prev = process.env.JWT_SECRET_PREVIOUS;
  return [enc(cur), ...(prev && prev.length >= 32 ? [enc(prev)] : [])];
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function newRefreshToken(): { token: string; id: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, id: sha256(token) };
}

export async function signAccessToken(user: SessionUser, sid: string): Promise<string> {
  const { accessSeconds } = authConfig();
  return new SignJWT({
    sid,
    role: user.role,
    username: user.username,
    name: user.displayName,
    dept: user.department,
    mod: user.primaryModule,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${accessSeconds}s`)
    .sign(secrets()[0]);
}

/** Verified access-token claims, or null when missing, expired, tampered or signed with an unknown key. */
export async function verifyAccessToken(jwt: string | undefined): Promise<{ sid: string; user: SessionUser } | null> {
  if (!jwt) return null;
  for (const key of secrets()) {
    try {
      const { payload } = await jwtVerify(jwt, key, { algorithms: ["HS256"] });
      if (typeof payload.sub !== "string" || typeof payload.sid !== "string" || typeof payload.username !== "string") return null;
      return {
        sid: payload.sid,
        user: {
          id: payload.sub,
          username: payload.username,
          displayName: String(payload.name ?? payload.username),
          department: (payload.dept as string | null) ?? null,
          primaryModule: (payload.mod as string | null) ?? null,
          role: payload.role as Role,
        },
      };
    } catch {
      /* try the previous key */
    }
  }
  return null;
}

// ---------------------------------------------------------------- cookie options (used by the proxy and by server code)

export function accessCookie(jwt: string) {
  const c = authConfig();
  return { name: ACCESS_COOKIE, value: jwt, httpOnly: true, sameSite: "lax" as const, secure: c.secure, path: "/", maxAge: c.accessSeconds };
}

export function refreshCookie(token: string, expires: Date) {
  const c = authConfig();
  return { name: REFRESH_COOKIE, value: token, httpOnly: true, sameSite: "lax" as const, secure: c.secure, path: "/", expires };
}

export const clearedCookie = (name: string) => ({ name, value: "", httpOnly: true, sameSite: "lax" as const, secure: authConfig().secure, path: "/", maxAge: 0 });
