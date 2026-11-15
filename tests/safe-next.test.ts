import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/safe-next";

const REJECTED: unknown[] = ["//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "evil.com", "", "/\t/evil.com", "/\n/evil.com", "/a\\b", null, undefined];

describe("safeNext", () => {
  it("allows same-origin paths", () => {
    expect(safeNext("/today")).toBe("/today");
    expect(safeNext("/chat?x=1#a")).toBe("/chat?x=1#a");
  });
  it("falls back for open-redirect payloads", () => {
    for (const v of REJECTED) expect(safeNext(v)).toBe("/chat");
  });
});
