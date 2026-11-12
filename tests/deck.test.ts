import { describe, expect, it } from "vitest";
import { composeDeck, seededShuffle } from "@/lib/deck";
import { nextSrs } from "@/lib/srs";
import { addDays, streakFrom } from "@/lib/dates";

const ids = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`);

describe("composeDeck", () => {
  it("mixes due, priority and fresh cards within quotas", () => {
    const deck = composeDeck({ due: ids("d", 20), priority: ids("p", 20), fresh: ids("f", 20), fallback: [] }, 10);
    expect(deck).toHaveLength(10);
    expect(deck.filter((x) => x.startsWith("d"))).toHaveLength(5);
    expect(deck.filter((x) => x.startsWith("p"))).toHaveLength(3);
    expect(deck.filter((x) => x.startsWith("f"))).toHaveLength(2);
  });
  it("fills shortfalls from other pools without duplicates", () => {
    const deck = composeDeck({ due: [], priority: ["a"], fresh: ["a", "b"], fallback: ["b", "c", "d"] }, 5);
    expect(deck.sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("shuffles deterministically per seed", () => {
    expect(seededShuffle(ids("x", 10), "u:2026-11-06")).toEqual(seededShuffle(ids("x", 10), "u:2026-11-06"));
    expect(seededShuffle(ids("x", 10), "a")).not.toEqual(seededShuffle(ids("x", 10), "b"));
  });
});

describe("Leitner SRS", () => {
  it("promotes on knew-it and resets on miss", () => {
    const a = nextSrs(null, true, "2026-11-06");
    expect(a).toMatchObject({ box: 2, dueDate: "2026-11-09", reps: 1 });
    const b = nextSrs(a, true, "2026-11-09");
    expect(b).toMatchObject({ box: 3, dueDate: "2026-11-16" });
    const c = nextSrs(b, false, "2026-11-16");
    expect(c).toMatchObject({ box: 1, dueDate: "2026-11-17", lapses: 1 });
  });
});

describe("dates", () => {
  it("adds days across month ends and computes streaks", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(streakFrom(["2026-11-06", "2026-11-05", "2026-11-03"], "2026-11-06")).toBe(2);
    expect(streakFrom(["2026-11-05", "2026-11-04"], "2026-11-06")).toBe(2);
    expect(streakFrom(["2026-11-03"], "2026-11-06")).toBe(0);
  });
});
