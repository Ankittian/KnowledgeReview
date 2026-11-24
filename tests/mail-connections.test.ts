import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { applySchema, createDb, resetDatabase, type DbHandle } from "@/db/client";
import { mailConnections, roleIdOf, users } from "@/db/schema";
import { describeMailError } from "@/lib/mail";
import {
  activateMailConnection,
  deleteMailConnection,
  getMailConnection,
  listMailConnections,
  mailConnectionSchema,
  resolveMailConfig,
  saveMailConnection,
  type MailConnectionInput,
} from "@/lib/mail-settings";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";

let h: DbHandle;
let admin: string;

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example).");
  h = createDb({ url });
  await resetDatabase(h);
  await applySchema(h);
  const [u] = await h.db.insert(users).values({ username: "boss", passwordHash: "x", displayName: "Boss", roleId: roleIdOf("admin"), status: "active" }).returning({ id: users.id });
  admin = u.id;
});
afterAll(async () => h?.close());

beforeEach(async () => {
  process.env.OTP_SECRET = "test-settings-secret-test-settings-0123456789";
  await h.db.delete(mailConnections);
});

const gmail: MailConnectionInput = { name: "Gmail", host: "smtp.gmail.com", port: 587, security: "starttls", user: "me@gmail.com", password: "app-password-1234", fromName: "Knowledge Review", fromEmail: "me@gmail.com" };
const outlook: MailConnectionInput = { name: "Outlook", host: "smtp.office365.com", port: 587, security: "starttls", user: "no-reply@force.com", password: "outlook-pass", fromName: "", fromEmail: "no-reply@force.com" };
const save = (i: MailConnectionInput, o: { id?: string; activate?: boolean } = {}) => saveMailConnection(h.db, i, { actorId: admin, activate: false, ...o });

describe("secret box", () => {
  it("round-trips, never repeats, and refuses tampering or another key", () => {
    const a = encryptSecret("hunter2");
    const b = encryptSecret("hunter2");
    expect(a).not.toContain("hunter2");
    expect(a).not.toBe(b); // fresh IV each time
    expect(decryptSecret(a)).toBe("hunter2");
    expect(decryptSecret(a.slice(0, -2) + "xx")).toBeNull();
    expect(decryptSecret("garbage")).toBeNull();
    process.env.OTP_SECRET = "a-completely-different-secret-0123456789abcdef";
    expect(decryptSecret(a)).toBeNull(); // a changed server secret makes saved passwords unreadable
  });
});

describe("saved mail connections", () => {
  it("makes the first connection active, keeps later ones saved, and switches with one active at a time", async () => {
    const g = await save(gmail);
    const o = await save(outlook);
    expect(g.ok && o.ok).toBe(true);
    let list = await listMailConnections(h.db);
    expect(list.map((c) => [c.name, c.isActive])).toEqual([["Gmail", true], ["Outlook", false]]);

    if (!o.ok) throw new Error();
    expect(await activateMailConnection(h.db, o.id)).toBe(true);
    list = await listMailConnections(h.db);
    expect(list.filter((c) => c.isActive).map((c) => c.name)).toEqual(["Outlook"]);
    expect(await activateMailConnection(h.db, "00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("the database itself refuses two active connections and duplicate names", async () => {
    await save(gmail);
    await save(outlook);
    await expect(h.db.update(mailConnections).set({ isActive: true })).rejects.toThrow(); // both rows at once
    const dup = await save({ ...gmail, name: "GMAIL" });
    expect(dup).toMatchObject({ ok: false, field: "name" });
  });

  it("stores the password encrypted and never returns it in the list", async () => {
    const r = await save(gmail);
    if (!r.ok) throw new Error();
    const [row] = await h.db.select().from(mailConnections).where(eq(mailConnections.id, r.id));
    expect(row.passwordEnc).toBeTruthy();
    expect(row.passwordEnc).not.toContain("app-password-1234");
    expect(decryptSecret(row.passwordEnc!)).toBe("app-password-1234");
    const [view] = await listMailConnections(h.db);
    expect(JSON.stringify(view)).not.toContain("app-password-1234");
    expect(JSON.stringify(view)).not.toContain(row.passwordEnc!);
    expect(view).toMatchObject({ hasPassword: true });
    expect("passwordEnc" in view).toBe(false);
  });

  it("keeps the saved password when the field is left blank, replaces it when given", async () => {
    const r = await save(gmail);
    if (!r.ok) throw new Error();
    await save({ ...gmail, name: "Gmail renamed", password: undefined }, { id: r.id });
    expect(decryptSecret((await getMailConnection(h.db, r.id))!.passwordEnc!)).toBe("app-password-1234");
    await save({ ...gmail, name: "Gmail renamed", password: "new-one" }, { id: r.id });
    expect(decryptSecret((await getMailConnection(h.db, r.id))!.passwordEnc!)).toBe("new-one");
    expect((await getMailConnection(h.db, r.id))!.name).toBe("Gmail renamed");
  });

  it("sends with the active connection, else nothing (no environment fallback)", async () => {
    process.env.SMTP_HOST = "smtp.env.example"; // environment variables are ignored completely
    process.env.SMTP_USER = "env-user";
    process.env.SMTP_PASS = "env-pass";
    expect((await resolveMailConfig(h.db)).source).toBe("none");

    const g = await save(gmail); // first connection becomes active
    expect(await resolveMailConfig(h.db)).toMatchObject({ source: "admin", name: "Gmail", host: "smtp.gmail.com", port: 587, secure: false, requireTLS: true, user: "me@gmail.com", pass: "app-password-1234", from: '"Knowledge Review" <me@gmail.com>' });

    const o = await save({ ...outlook, port: 465, security: "ssl" });
    if (!o.ok) throw new Error();
    await activateMailConnection(h.db, o.id);
    expect(await resolveMailConfig(h.db)).toMatchObject({ name: "Outlook", secure: true, requireTLS: false, from: "no-reply@force.com" });
    expect(g.ok).toBe(true);
    for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) delete process.env[k];
  });

  it("flags a password that can no longer be decrypted", async () => {
    await save(gmail);
    process.env.OTP_SECRET = "rotated-secret-rotated-secret-0123456789abcd";
    expect(await resolveMailConfig(h.db)).toMatchObject({ source: "admin", passwordUnreadable: true, pass: undefined });
  });

  it("deleting the active connection leaves email unconfigured", async () => {
    const g = await save(gmail);
    if (!g.ok) throw new Error();
    expect(await deleteMailConnection(h.db, g.id)).toEqual({ existed: true, wasActive: true });
    expect(await deleteMailConnection(h.db, g.id)).toEqual({ existed: false, wasActive: false });
    expect((await resolveMailConfig(h.db)).source).toBe("none");
  });
});

describe("connection form validation", () => {
  it("accepts a host name and rejects URLs, ports and bad senders", () => {
    const ok = { name: "A", host: " SMTP.Gmail.com ", port: "587", security: "starttls", user: "", fromName: "KR", fromEmail: "A@B.com" };
    expect(mailConnectionSchema.parse(ok)).toMatchObject({ host: "smtp.gmail.com", port: 587, fromEmail: "a@b.com" });
    expect(mailConnectionSchema.safeParse({ ...ok, host: "https://smtp.gmail.com" }).success).toBe(false);
    expect(mailConnectionSchema.safeParse({ ...ok, host: "smtp.gmail.com:587" }).success).toBe(false);
    expect(mailConnectionSchema.safeParse({ ...ok, port: "0" }).success).toBe(false);
    expect(mailConnectionSchema.safeParse({ ...ok, port: "70000" }).success).toBe(false);
    expect(mailConnectionSchema.safeParse({ ...ok, security: "none" }).success).toBe(false);
    expect(mailConnectionSchema.safeParse({ ...ok, fromEmail: "nope" }).success).toBe(false);
    expect(mailConnectionSchema.safeParse({ ...ok, fromName: 'Evil" <x@y.z>' }).success).toBe(false); // no header injection through the name
    expect(mailConnectionSchema.safeParse({ ...ok, name: "  " }).success).toBe(false);
  });
});

describe("mail error messages", () => {
  it("explains common SMTP failures in plain words", () => {
    expect(describeMailError({ code: "EAUTH", responseCode: 534, message: "Invalid login" })).toMatch(/app password/);
    expect(describeMailError({ code: "EAUTH", responseCode: 535, message: "Invalid login: 535 5.7.139 Authentication unsuccessful, basic authentication is disabled." })).toMatch(/enable Authenticated SMTP.*Personal Outlook\.com/);
    expect(describeMailError({ code: "EAUTH", responseCode: 535, message: "535 5.7.57 Client not authenticated to send mail" })).toMatch(/Authenticated SMTP is switched off/);
    expect(describeMailError({ code: "ECONNREFUSED", message: "connect ECONNREFUSED" })).toMatch(/Could not connect/);
    expect(describeMailError({ code: "EDNS", message: "getaddrinfo ENOTFOUND x" })).toMatch(/host name was not found/);
    expect(describeMailError({ code: "ESOCKET", message: "wrong version number" })).toMatch(/Could not connect|secure connection/);
    expect(describeMailError(new Error("boom"))).toMatch(/Sending failed/);
  });
});
