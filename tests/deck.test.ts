import { describe, expect, it } from "vitest";
import { composeDeck, groupDeck, seededShuffle } from "@/lib/deck";
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

describe("groupDeck", () => {
  const mk = (mod: string, n: number, item = 1) => Array.from({ length: n }, (_, i) => ({ id: `${mod}${i}`, module: mod, item }));
  const run = (cardsIn: { id: string; module: string; item: number }[], size: number, primary: string | null) =>
    groupDeck(cardsIn.map((c) => c.id), new Map(cardsIn.map((c) => [c.id, { module: c.module, item: c.item }])), size, primary, "seed");
  const mods = (ids: string[]) => ids.map((id) => id[0]);

  it("10 from the main module, then blocks of 5 from others, contiguous", () => {
    const deck = run([...mk("A", 30), ...mk("B", 30), ...mk("C", 30), ...mk("D", 30)], 20, "A");
    expect(deck).toHaveLength(20);
    const m = mods(deck);
    expect(m.slice(0, 10).every((x) => x === "A")).toBe(true);
    expect(new Set(m.slice(10, 15)).size).toBe(1);
    expect(new Set(m.slice(15, 20)).size).toBe(1);
    expect(m[10]).not.toBe(m[15]);
  });
  it("tops up from available modules when others are short, with no duplicates", () => {
    const deck = run([...mk("A", 30), ...mk("B", 2)], 20, "A");
    expect(deck).toHaveLength(20);
    expect(new Set(deck).size).toBe(20);
    expect(mods(deck).filter((x) => x === "B")).toHaveLength(2);
  });
  it("falls back to the largest module when the user's module has no cards, and clusters by item", () => {
    const deck = run([...mk("A", 4, 1), ...mk("B", 10, 7), ...mk("B", 1, 8)].sort((x, y) => (x.id < y.id ? 1 : -1)), 8, "Z");
    expect(mods(deck)[0]).toBe("B");
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
