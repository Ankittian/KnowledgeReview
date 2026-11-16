import { describe, expect, it } from "vitest";
import { LEVELS, minReadSeconds } from "@/lib/cards/spec";

describe("read time by level", () => {
  it("easy waits 10 s, medium 15-18 s, hard 20-22 s", () => {
    for (const w of [1, 20, 50, 70, 500]) expect(minReadSeconds(w, "easy")).toBe(10);
    for (const w of [1, ...LEVELS.medium.words, 500]) {
      expect(minReadSeconds(w, "medium")).toBeGreaterThanOrEqual(15);
      expect(minReadSeconds(w, "medium")).toBeLessThanOrEqual(18);
    }
    for (const w of [1, ...LEVELS.hard.words, 900]) {
      expect(minReadSeconds(w, "hard")).toBeGreaterThanOrEqual(20);
      expect(minReadSeconds(w, "hard")).toBeLessThanOrEqual(22);
    }
  });
  it("longer cards wait longer within a range", () => {
    expect(minReadSeconds(LEVELS.medium.words[0], "medium")).toBe(15);
    expect(minReadSeconds(LEVELS.medium.words[1], "medium")).toBe(18);
    expect(minReadSeconds(LEVELS.hard.words[1], "hard")).toBe(22);
  });
});
