import { describe, expect, it } from "vitest";
import { findSimilarTitles, titleSimilarity, titleTokens, type TitledCard } from "@/lib/cards/push/dedupe";
import { KbIndex } from "@/lib/cards/push/kb-items";

const card = (item: string, id: string, title: string, level = "medium"): TitledCard => ({ item, id, level, title });

describe("title similarity", () => {
  it("ignores filler words, plurals and British spelling", () => {
    expect([...titleTokens("authorised receipts")].sort()).toEqual([...titleTokens("authorized receipt")].sort());
    expect(titleSimilarity("Why can an authorized receipt not be saved again?", "Why can an authorised receipt not be saved again?")).toBe(1);
  });

  it("scores a reworded repeat high and a different question low", () => {
    const a = "How are accepted, short and excess quantity worked out on a receipt?";
    expect(titleSimilarity(a, "How is the excess, short and accepted quantity calculated on a receipt?")).toBeGreaterThanOrEqual(0.6);
    expect(titleSimilarity(a, "What does a free-of-cost quantity mean on a receipt?")).toBeLessThan(0.4);
    expect(titleSimilarity(a, "Why did stock not rise when stores saved the receipt?")).toBeLessThan(0.4);
  });

  it("is 0 for an empty title", () => {
    expect(titleSimilarity("", "Why is an authorized document locked?")).toBe(0);
  });
});

describe("findSimilarTitles", () => {
  const stored = [card("fGRN", "gen:fGRN:functional:medium:a", "How are accepted, short and excess quantity worked out on a receipt?")];

  it("flags a new card that repeats a stored one for the same item", () => {
    const fresh = [card("fGRN", "gen:fGRN:functional:medium:b", "How is excess, short and accepted quantity calculated on a receipt?")];
    const found = findSimilarTitles(fresh, stored);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ item: "fGRN", existing: true, newId: "gen:fGRN:functional:medium:b", otherId: "gen:fGRN:functional:medium:a" });
  });

  it("compares across levels of the same item", () => {
    const fresh = [card("fGRN", "gen:fGRN:functional:easy:x", "How are accepted, short and excess quantity worked out?", "easy")];
    expect(findSimilarTitles(fresh, stored)).toHaveLength(1);
  });

  it("does not compare cards of different items", () => {
    const fresh = [card("fPurchaseOrder", "gen:fPurchaseOrder:functional:medium:b", "How are accepted, short and excess quantity worked out on a receipt?")];
    expect(findSimilarTitles(fresh, stored)).toHaveLength(0);
  });

  it("flags two similar new cards in the same file once", () => {
    const fresh = [
      card("fGRN", "gen:fGRN:functional:medium:c", "Why can an authorized receipt not be saved again?"),
      card("fGRN", "gen:fGRN:functional:hard:d", "Why can an authorised receipt not be saved a second time?", "hard"),
    ];
    const found = findSimilarTitles(fresh, []);
    expect(found).toHaveLength(1);
    expect(found[0].existing).toBe(false);
  });

  it("never compares a card with the stored card of the same id", () => {
    const fresh = [card("fGRN", "gen:fGRN:functional:medium:a", "How are accepted, short and excess quantity worked out on a receipt?")];
    expect(findSimilarTitles(fresh, stored)).toHaveLength(0);
  });

  it("leaves distinct cards of one item alone", () => {
    const fresh = [
      card("fGRN", "gen:fGRN:functional:easy:e", "What does a free-of-cost quantity mean on a receipt?", "easy"),
      card("fGRN", "gen:fGRN:functional:hard:f", "Third delivery against one order: allowed, and what is the excess?", "hard"),
    ];
    expect(findSimilarTitles(fresh, stored)).toHaveLength(0);
  });

  it("honours the threshold", () => {
    const fresh = [card("fGRN", "gen:fGRN:functional:medium:g", "How are accepted and short quantity worked out?")];
    expect(findSimilarTitles(fresh, stored, 0.6).length).toBe(1);
    expect(findSimilarTitles(fresh, stored, 0.95)).toHaveLength(0);
  });
});

describe("KbIndex lookup by group scope", () => {
  const idx = new KbIndex();
  idx.add({ id: 1, type: "form", key: "fGRN", yamlFile: "forms/fGRN.yaml" });
  idx.add({ id: 2, type: "process", key: "procure-to-pay", yamlFile: "processes/procure-to-pay.yaml" });
  idx.add({ id: 3, type: "module", key: "MM", yamlFile: "modules.yaml" });
  // the same key used by a form and a flow
  idx.add({ id: 4, type: "form", key: "clash", yamlFile: "forms/clash.yaml" });
  idx.add({ id: 5, type: "process", key: "clash", yamlFile: "processes/clash.yaml" });

  it("finds an item of the type the scope names", () => {
    expect(idx.findForGroup("form", "fGRN")).toBe(1);
    expect(idx.findForGroup("flow", "procure-to-pay")).toBe(2);
    expect(idx.findForGroup("module", "MM")).toBe(3);
  });

  it("does not attach a flow to a form that has the same key", () => {
    expect(idx.findForGroup("flow", "clash")).toBe(5);
    expect(idx.findForGroup("form", "clash")).toBe(4);
    expect(idx.findForGroup("module", "clash")).toBeUndefined();
  });

  it("accepts a key held by exactly one item when its type differs", () => {
    expect(idx.findForGroup("flow", "fGRN")).toBe(1);
  });

  it("returns nothing for an unknown key", () => {
    expect(idx.findForGroup("flow", "mm-transaction-forms-common")).toBeUndefined();
  });
});
