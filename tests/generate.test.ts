/** Card generation: validator, prompt builder, batching, catalog build, request schema. No database needed. */
import { describe, expect, it } from "vitest";
import { estimateJob, jobParamsSchema, LIMITS } from "@/lib/cards/generate/config";
import { availableAudiences, buildPrompt, loadTemplate, templateExists } from "@/lib/cards/generate/prompt";
import { buildCatalogs } from "@/lib/cards/generate/push";
import { makeBatches } from "@/lib/cards/generate/run";
import { checkCard, extractJson, findDuplicates, parseGroups, WORD_LIMITS, type RawCard } from "@/lib/cards/generate/validate";

const REF = "Material Receipt Note [4:478dbad0-cd96-4aa4-bac7-6d61036ab7b0:61031] (form:fGRN)";
const filler = (n: number) => Array.from({ length: n }, () => "word").join(" ");
const card = (over: Partial<RawCard> = {}): RawCard => ({
  level: "easy",
  topic_key: "trigger--receipt-prepared",
  title: "When do stores staff prepare a receipt after a consignment arrives?",
  body: "Stores staff prepare a receipt when a consignment arrives at the company and they confirm what came against the order placed with the supplier.",
  source_refs: [REF],
  ...over,
});

describe("checkCard", () => {
  it("accepts a well-formed card", () => expect(checkCard(card())).toEqual([]));
  it("flags a body that is too short or too long for its level", () => {
    expect(checkCard(card({ body: "Too short." })).some((p) => p.kind === "length")).toBe(true);
    expect(checkCard(card({ body: filler(WORD_LIMITS.easy[1] + 30) })).some((p) => p.kind === "length")).toBe(true);
  });
  it("allows technical wording on a technical card", () => {
    const c = card({ title: "Which table does the receipt save its rows to, and which button posts it?" });
    expect(checkCard(c, "functional").some((p) => p.kind === "leak")).toBe(true);
    expect(checkCard(c, "technical").some((p) => p.kind === "leak")).toBe(false);
  });
  it("flags technical wording and malformed sources", () => {
    expect(checkCard(card({ title: "Which button saves the receipt in the table?" })).some((p) => p.kind === "leak")).toBe(true);
    expect(checkCard(card({ source_refs: ["Material Receipt Note"] })).some((p) => p.kind === "source")).toBe(true);
    expect(checkCard(card({ source_refs: [] })).some((p) => p.kind === "source")).toBe(true);
    expect(checkCard(card({ topic_key: "NoDoubleDash" })).some((p) => p.kind === "source")).toBe(true);
  });
});

describe("findDuplicates", () => {
  const group = (cards: RawCard[]) => [{ scope: "form" as const, key: "fGRN", title: "GRN", cards }];
  it("finds a title close to a stored card and to another new card", () => {
    const ledger = [{ item: "fGRN", level: "easy", topicKey: "old--one", title: "When do stores staff prepare a receipt after a consignment arrives?" }];
    const a = card({ topic_key: "new--one", title: "When do stores staff prepare a goods receipt once a consignment arrives?" });
    const b = card({ topic_key: "new--two", title: "When do stores staff prepare a goods receipt once the consignment arrives?" });
    const found = findDuplicates(group([a, b]), ledger, 0.6);
    expect([...found.keys()]).toContain("fGRN:easy:new--one");
    expect(found.get("fGRN:easy:new--two")?.some((p) => p.kind === "similar")).toBe(true);
  });
  it("ignores the same title on a different item", () => {
    const ledger = [{ item: "fPurchaseOrder", level: "easy", topicKey: "old--one", title: card().title }];
    expect(findDuplicates(group([card({ topic_key: "new--one" })]), ledger, 0.6).size).toBe(0);
  });
});

describe("parsing the model answer", () => {
  const answer = { module: "MM", audience: "functional", items: [{ scope: "form", key: "fGRN", title: "GRN", cards: [{ level: "easy", topic_key: "a--b", title: "T", body: "B", source_refs: [REF] }] }] };
  it("accepts plain JSON, a fenced block and JSON with chatter around it", () => {
    const json = JSON.stringify(answer);
    expect(extractJson(json)).toEqual(answer);
    expect(extractJson("```json\n" + json + "\n```")).toEqual(answer);
    expect(extractJson("Here are the cards:\n" + json + "\nDone.")).toEqual(answer);
    expect(() => extractJson("no json here")).toThrow();
  });
  it("rejects the wrong module and a wrong shape", () => {
    expect(parseGroups(answer, "MM")).toHaveLength(1);
    expect(() => parseGroups(answer, "PM")).toThrow(/expected PM/);
    expect(() => parseGroups(answer, "MM", "technical")).toThrow(/expected technical/);
    expect(() => parseGroups({ module: "MM" }, "MM")).toThrow(/card format/);
  });
});

describe("job request", () => {
  const item = { key: "fGRN", scope: "form", module: "MM", title: "GRN", easy: 3, medium: 3, hard: 2 };
  it("accepts a valid request and fills in defaults", () => {
    const p = jobParamsSchema.parse({ level: "form", items: [item] });
    expect(p.audience).toBe("functional");
    expect(jobParamsSchema.safeParse({ level: "form", audience: "technical", items: [item] }).success).toBe(true);
    expect(jobParamsSchema.safeParse({ level: "form", audience: "managers", items: [item] }).success).toBe(false);
    expect(p.model).toBe("sonnet");
    expect(p.instructions).toBe("");
  });
  it("rejects an empty selection, a scope that does not match the level, zero cards and duplicates", () => {
    expect(jobParamsSchema.safeParse({ level: "form", items: [] }).success).toBe(false);
    expect(jobParamsSchema.safeParse({ level: "module", items: [item] }).success).toBe(false);
    expect(jobParamsSchema.safeParse({ level: "form", items: [{ ...item, easy: 0, medium: 0, hard: 0 }] }).success).toBe(false);
    expect(jobParamsSchema.safeParse({ level: "form", items: [item, item] }).success).toBe(false);
    expect(jobParamsSchema.safeParse({ level: "form", items: [{ ...item, easy: LIMITS.maxPerLevel + 1 }] }).success).toBe(false);
  });
  it("estimates cards, steps and cost", () => {
    const e = estimateJob([item, { ...item, key: "b" }], "sonnet");
    expect(e.cards).toBe(16);
    expect(e.batches).toBe(1);
    expect(e.usd).toBeGreaterThan(0);
    expect(estimateJob([item], "opus").usd).toBeGreaterThan(estimateJob([item], "sonnet").usd);
  });
});

describe("batches", () => {
  const mk = (key: string, module: string, scope: "form" | "module" = "form") => ({ key, scope, module, title: key, easy: 1, medium: 1, hard: 0 });
  it("groups forms by module, four at a time", () => {
    const items = ["a", "b", "c", "d", "e"].map((k) => mk(k, "MM")).concat(mk("x", "PM"));
    const b = makeBatches({ level: "form", audience: "functional", model: "sonnet", instructions: "", items });
    expect(b.map((x) => [x.module, x.items.length])).toEqual([["MM", 4], ["MM", 1], ["PM", 1]]);
  });
  it("gives each module its own batch at module level", () => {
    const b = makeBatches({ level: "module", audience: "functional", model: "sonnet", instructions: "", items: [mk("MM", "MM", "module"), mk("PM", "PM", "module")] });
    expect(b).toHaveLength(2);
  });
});

describe("prompt", () => {
  const input = {
    module: "MM",
    moduleTitle: "Material Management",
    items: [{ key: "fGRN", scope: "form" as const, module: "MM", title: "Material Receipt Note (GRN)", easy: 3, medium: 2, hard: 1 }],
    ledger: [{ item: "fGRN", level: "easy", topicKey: "old--one", title: "An old title {{MODULE}}" }],
    runDate: "2026-11-17",
  };
  it("fills every placeholder, includes the ledger and drops the operator note", () => {
    const p = buildPrompt(input);
    expect(p).not.toMatch(/\{\{(MODULE_TITLE|TARGET_ITEMS|EXISTING_CARDS|OUTPUT_PATH|SLOTS|TOTAL_CARDS|EASY_COUNT|RUN_DATE)\}\}/);
    expect(p).toContain("fGRN | easy | old--one | An old title {{MODULE}}"); // a title is never expanded again
    expect(p).toContain("write 3 easy, 2 medium, 1 hard");
    expect(p).toContain("6 new cards = 3 easy, 2 medium, 1 hard");
    expect(p).not.toContain("NOTE TO OPERATOR");
    expect(loadTemplate()).not.toContain("NOTE TO OPERATOR");
  });
  it("uses the template of the audience and says clearly when there is none", () => {
    expect(templateExists("functional")).toBe(true);
    expect(availableAudiences()).toContain("functional");
    if (!templateExists("technical")) expect(() => buildPrompt({ ...input, audience: "technical" })).toThrow(/no technical prompt template/);
  });
  it("adds admin notes in a separate block that cannot override the rules", () => {
    const p = buildPrompt({ ...input, instructions: "Focus on approvals." });
    expect(p).toContain("Focus on approvals.");
    expect(p).toMatch(/never override the rules/);
  });
});

describe("buildCatalogs", () => {
  const row = (over: Record<string, unknown>) =>
    ({ id: 1, jobId: 1, module: "MM", scope: "form", groupKey: "fGRN", groupTitle: "GRN", context: null, level: "easy", topicKey: "a--b", title: "T1", body: "B", sourceRefs: [REF], status: "draft", edited: false, warnings: [], createdAt: new Date(), ...over }) as never;
  it("makes one catalog per module with items grouped by key", () => {
    const cats = buildCatalogs([row({}), row({ topicKey: "c--d", level: "hard" }), row({ groupKey: "fPO", groupTitle: "PO", topicKey: "e--f" }), row({ module: "PM", groupKey: "fJob", groupTitle: "Job", topicKey: "g--h" })]);
    expect(cats.map((c) => c.module)).toEqual(["MM", "PM"]);
    expect(cats[0].items.map((i) => [i.key, i.cards.length])).toEqual([["fGRN", 2], ["fPO", 1]]);
    expect(cats[0].breakdown).toEqual({ easy: 2, medium: 0, hard: 1 });
    expect(cats[0].audience).toBe("functional");
    expect(buildCatalogs([row({})], "technical")[0].audience).toBe("technical");
  });
});
