import path from "node:path";
import nodemailer from "nodemailer";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { applySchema, createDb, resetDatabase, type DbHandle } from "@/db/client";
import { emailOtps, roleIdOf, users } from "@/db/schema";
import { OTP_MAX_ATTEMPTS, OTP_MAX_PER_HOUR, OTP_RESEND_SECONDS, OTP_TTL_MS, issueOtp, verifyOtp } from "@/lib/auth/otp";
import { outbox, renderOtpMail, sendOtpMail } from "@/lib/mail";
import { emailSchema, loginSchema, otpCodeSchema, resetPasswordSchema } from "@/lib/validation";

let h: DbHandle;
let uid: string;
let other: string;

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example).");
  h = createDb({ url });
  await resetDatabase(h);
  await applySchema(h);
  const mk = async (username: string) => {
    const [u] = await h.db.insert(users).values({ username, passwordHash: "x", displayName: username, roleId: roleIdOf("functional"), status: "active" }).returning({ id: users.id });
    return u.id;
  };
  uid = await mk("alice");
  other = await mk("bob");
});
afterAll(async () => h?.close());

beforeEach(async () => {
  process.env.OTP_SECRET = "test-otp-secret-test-otp-secret-0123456789";
  await h.db.delete(emailOtps);
  outbox.length = 0;
});

const EMAIL = "alice@example.com";
const issue = (now?: Date, purpose: "verify_email" | "change_password" | "reset_password" = "verify_email") => issueOtp(h.db, { userId: uid, email: EMAIL, purpose }, now);
const code = (r: Awaited<ReturnType<typeof issue>>) => {
  if (!r.ok) throw new Error("not issued");
  return r.code;
};

describe("email one-time codes", () => {
  it("issues a 6-digit code, stores only a hash, and accepts it exactly once", async () => {
    const c = code(await issue());
    expect(c).toMatch(/^\d{6}$/);
    const [row] = await h.db.select().from(emailOtps);
    expect(row.codeHash).not.toContain(c);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyOtp(h.db, { userId: uid, email: EMAIL, purpose: "verify_email", code: c })).toBe(true);
    expect(await verifyOtp(h.db, { userId: uid, email: EMAIL, purpose: "verify_email", code: c })).toBe(false); // single use
  });

  it("rejects a wrong code, the right code for another purpose, another address and another user", async () => {
    const c = code(await issue());
    const wrong = c === "000000" ? "000001" : "000000";
    expect(await verifyOtp(h.db, { userId: uid, email: EMAIL, purpose: "verify_email", code: wrong })).toBe(false);
    expect(await verifyOtp(h.db, { userId: uid, email: EMAIL, purpose: "reset_password", code: c })).toBe(false);
    expect(await verifyOtp(h.db, { userId: uid, email: "mallory@example.com", purpose: "verify_email", code: c })).toBe(false);
    expect(await verifyOtp(h.db, { userId: other, email: EMAIL, purpose: "verify_email", code: c })).toBe(false);
    expect(await verifyOtp(h.db, { userId: uid, email: EMAIL, purpose: "verify_email", code: c })).toBe(true); // still valid after the misses
  });

  it("expires after 10 minutes", async () => {
    const t0 = new Date();
    const c = code(await issue(t0));
    const late = new Date(t0.getTime() + OTP_TTL_MS + 1000);
    expect(await verifyOtp(h.db, { userId: uid, email: EMAIL, purpose: "verify_email", code: c }, late)).toBe(false);
  });

  it("locks the code after too many wrong guesses, even for the right code", async () => {
    const c = code(await issue());
    const wrong = c === "000000" ? "000001" : "000000";
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) expect(await verifyOtp(h.db, { userId: uid, email: EMAIL, purpose: "verify_email", code: wrong })).toBe(false);
    expect(await verifyOtp(h.db, { userId: uid, email: EMAIL, purpose: "verify_email", code: c })).toBe(false);
  });

  it("makes you wait between sends, then a new code replaces the old one", async () => {
    const t0 = new Date();
    const first = code(await issue(t0));
    const early = await issue(new Date(t0.getTime() + 10_000));
    expect(early).toMatchObject({ ok: false, reason: "cooldown" });
    const t1 = new Date(t0.getTime() + (OTP_RESEND_SECONDS + 1) * 1000);
    const second = code(await issue(t1));
    if (first !== second) expect(await verifyOtp(h.db, { userId: uid, email: EMAIL, purpose: "verify_email", code: first }, t1)).toBe(false);
    expect(await verifyOtp(h.db, { userId: uid, email: EMAIL, purpose: "verify_email", code: second }, t1)).toBe(true);
  });

  it("caps how many codes can be requested per hour", async () => {
    const t0 = new Date();
    for (let i = 0; i < OTP_MAX_PER_HOUR; i++) code(await issue(new Date(t0.getTime() + i * (OTP_RESEND_SECONDS + 1) * 1000)));
    const next = await issue(new Date(t0.getTime() + OTP_MAX_PER_HOUR * (OTP_RESEND_SECONDS + 1) * 1000 - 1));
    expect(next).toMatchObject({ ok: false });
  });

  it("is deleted together with its user", async () => {
    code(await issueOtp(h.db, { userId: other, email: "bob@example.com", purpose: "reset_password" }));
    await h.db.delete(users).where(eq(users.id, other));
    expect(await h.db.select().from(emailOtps).where(eq(emailOtps.userId, other))).toHaveLength(0);
  });
});

describe("email on the account", () => {
  it("is unique ignoring case, but many accounts may have none", async () => {
    const [carol] = await h.db.insert(users).values({ username: "carol", passwordHash: "x", displayName: "carol", roleId: roleIdOf("functional"), status: "active" }).returning({ id: users.id });
    await h.db.update(users).set({ email: "shared@example.com" }).where(eq(users.id, uid));
    await expect(h.db.update(users).set({ email: "SHARED@example.com" }).where(eq(users.id, carol.id))).rejects.toThrow();
    await h.db.update(users).set({ email: null }).where(eq(users.id, uid)); // two accounts with no email do not collide
    await h.db.update(users).set({ email: null }).where(eq(users.id, carol.id));
  });
});

describe("mail", () => {
  it("captures the code in the dev outbox when SMTP is not configured", async () => {
    await sendOtpMail("a@example.com", "123456", "reset_password");
    expect(outbox).toHaveLength(1);
    expect(outbox[0].text).toContain("123456");
    expect(outbox[0].to).toBe("a@example.com");
  });
});

describe("email design", () => {
  it("renders the code once, as plain digits, with the right headline for each purpose", () => {
    for (const [purpose, title] of [["verify_email", "Verify your email"], ["change_password", "Change your password"], ["reset_password", "Reset your password"], ["login", "Sign in"]] as const) {
      const m = renderOtpMail("482916", purpose, true);
      expect(m.subject).toBe("482916 is your Knowledge Review code");
      expect(m.html).toContain(title);
      expect(m.html).toContain(">482916</div>"); // no spaces or separators inside the code: it must paste into a 6-digit field
      expect(m.html).toContain("cid:force-logo");
      expect(m.text).toContain("Your code: 482916");
    }
  });
  it("falls back to a text brand when the logo is missing", () => {
    const m = renderOtpMail("123456", "login", false);
    expect(m.html).not.toContain("cid:");
    expect(m.html).toContain("ForceIntellect");
  });
  it("ships the logo inside the message as an inline attachment", async () => {
    const t = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const { html, text, subject } = renderOtpMail("482916", "login", true);
    const info = await t.sendMail({ from: "a@b.c", to: "x@y.z", subject, text, html, attachments: [{ filename: "force-logo.png", path: path.join(process.cwd(), "public", "force-logo.png"), cid: "force-logo" }] });
    const raw = (info as unknown as { message: Buffer }).message.toString();
    expect(raw).toContain("Content-ID: <force-logo>");
    expect(raw).toContain("image/png");
  });
});

describe("validation", () => {
  it("normalises and checks emails and codes", () => {
    expect(emailSchema.parse("  Alice@Example.COM ")).toBe("alice@example.com");
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
    expect(emailSchema.safeParse(`${"a".repeat(250)}@example.com`).success).toBe(false);
    expect(otpCodeSchema.safeParse("12345").success).toBe(false);
    expect(otpCodeSchema.safeParse("12345a").success).toBe(false);
    expect(otpCodeSchema.parse(" 123456 ")).toBe("123456");
  });
  it("login accepts a username or an email", () => {
    expect(loginSchema.parse({ username: " Bob@Example.com ", password: "x" }).username).toBe("bob@example.com");
    expect(loginSchema.parse({ username: "Bob", password: "x" }).username).toBe("bob");
  });
  it("reset needs matching passwords and a 6-digit code", () => {
    const ok = { identifier: "Bob", code: "123456", newPassword: "longenough1", confirmPassword: "longenough1" };
    expect(resetPasswordSchema.parse(ok).identifier).toBe("bob");
    expect(resetPasswordSchema.safeParse({ ...ok, confirmPassword: "different1" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ ...ok, code: "abc" }).success).toBe(false);
  });
});
