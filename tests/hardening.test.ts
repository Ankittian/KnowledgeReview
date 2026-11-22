import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/client-ip";
import { rateLimited } from "@/lib/rate-limit";
import { toCsv } from "@/lib/reports";
import { eventsSchema } from "@/lib/validation";

const hdr = (h: Record<string, string>) => (n: string) => h[n] ?? null;

describe("toCsv formula injection", () => {
  it("prefixes text that a spreadsheet would run as a formula", () => {
    const out = toCsv([{ a: "=HYPERLINK(\"http://x\")", b: "+1", c: "-2", d: "@SUM(A1)", e: "\tcmd", f: "plain" }]);
    const row = out.split("\r\n")[1];
    expect(row).toBe(`"'=HYPERLINK(""http://x"")",'+1,'-2,'@SUM(A1),'\tcmd,plain`);
  });
  it("leaves real numbers alone", () => {
    expect(toCsv([{ n: -5, ok: true }]).split("\r\n")[1]).toBe("-5,true");
  });
});

describe("clientIp", () => {
  const spoofed = hdr({ "x-forwarded-for": "6.6.6.6, 10.0.0.9", "x-real-ip": "" });
  it("is unknown unless a proxy is trusted", () => {
    expect(clientIp(spoofed, {})).toBeNull();
    expect(clientIp(spoofed, { TRUSTED_PROXY: "false" })).toBeNull();
  });
  it("uses X-Real-IP, else the last forwarded hop, behind a trusted proxy", () => {
    const env = { TRUSTED_PROXY: "true" };
    expect(clientIp(hdr({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "6.6.6.6, 203.0.113.5" }), env)).toBe("203.0.113.5");
    expect(clientIp(spoofed, env)).toBe("10.0.0.9");
  });
});

describe("rateLimited", () => {
  it("blocks after the limit and recovers when the window passes", () => {
    const k = `t:${Math.random()}`;
    expect([1, 2, 3].map(() => rateLimited(k, 3, 1000, 0))).toEqual([false, false, false]);
    expect(rateLimited(k, 3, 1000, 10)).toBe(true);
    expect(rateLimited(k, 3, 1000, 2000)).toBe(false);
  });
});

describe("eventsSchema payload cap", () => {
  const ev = (payload: Record<string, unknown>) => ({ events: [{ clientEventId: "abcdefgh", type: "card_shown", at: new Date().toISOString(), payload }] });
  it("accepts small payloads and rejects oversized ones", () => {
    expect(eventsSchema.safeParse(ev({ q: "hello" })).success).toBe(true);
    expect(eventsSchema.safeParse(ev({ blob: "x".repeat(5000) })).success).toBe(false);
  });
});
