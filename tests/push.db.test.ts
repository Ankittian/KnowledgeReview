/** Card push + Browse topics, against the test database (needs TEST_DATABASE_URL; the database is wiped). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, applySchema, resetDatabase, type DbHandle } from "@/db/client";
import { cards, kbItems } from "@/db/schema";
import { loadBrowseForms, loadKindCounts, parseBrowseKind } from "@/lib/browse-topics";
import { pushCatalog, PushRefused, type Catalog } from "@/lib/cards/push";

let h: DbHandle;

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set. Start Postgres (docker compose up -d) and set it in .env (see .env.example).");
  h = createDb({ url });
  await resetDatabase(h);
  await applySchema(h);
});
afterAll(async () => h?.close());

beforeEach(async () => {
  await h.db.execute(sql`TRUNCATE kb_items, cards, card_versions, card_related_items RESTART IDENTITY CASCADE`);
  // the knowledge base items a real sync would have loaded
  await h.db.insert(kbItems).values([
    { type: "module", key: "MM", name: "Material Management", module: "MM", yamlFile: "modules.yaml", contentHash: "m" },
    { type: "form", key: "fGRN", name: "Material Receipt Note (GRN)", module: "MM", yamlFile: "forms/fGRN.yaml", contentHash: "a" },
    { type: "form", key: "fPurchaseOrder", name: "Purchase Order", module: "MM", yamlFile: "forms/fPurchaseOrder.yaml", contentHash: "b" },
  ]);
});

const body = (extra = "") => `A **Receipt** is frozen once **Authorized**.\n- one\n- two ${extra}`.trim();

const catalog = (items: Catalog["items"]): Catalog => ({ module: "MM", audience: "functional", items });

const formItem = (cardsOf: Catalog["items"][number]["cards"]): Catalog["items"][number] => ({
  scope: "form",
  key: "fGRN",
  title: "Material Receipt Note (GRN)",
  context: "Procure-to-Pay > Material Receipt Note (GRN)",
  cards: cardsOf,
});

const commonItem = (source_refs: string[]): Catalog["items"][number] => ({
  scope: "flow",
  key: "mm-transaction-forms-common",
  title: "Transaction Forms: Common Questions",
  context: "Common patterns > Transaction forms",
  cards: [
    {
      level: "medium",
      topic_key: "standard-checks--authorized-document-is-locked",
      title: "Why is an authorized document locked, and how is it changed?",
      body: body(),
      source_refs,
    },
  ],
});

const accepted = {
  level: "medium" as const,
  topic_key: "limits-tolerances--accepted-short-excess",
  title: "How are accepted, short and excess quantity worked out on a receipt?",
  body: body("accepted"),
  source_refs: ["forms/fGRN.yaml"],
};

describe("push: common (cross-form) items", () => {
  it("creates a flow item for a common card, with its own file name and the catalog's module", async () => {
    const r = await pushCatalog(h.db, catalog([commonItem(["forms/fGRN.yaml", "forms/fPurchaseOrder.yaml"])]));
    expect(r.cardsInserted).toBe(1);
    expect(r.kbItemsCreated).toBe(1);
    expect(r.linksInserted).toBe(2);
    const [item] = await h.db.select().from(kbItems).where(eq(kbItems.key, "mm-transaction-forms-common"));
    expect(item).toMatchObject({ type: "process", module: "MM", name: "Transaction Forms: Common Questions", yamlFile: "processes/mm-transaction-forms-common.yaml" });
    expect(item.meta).toMatchObject({ generated: true, scope: "flow" });
  });

  it("attaches a flow to the flow, not to a form, when both have the same key", async () => {
    await h.db.insert(kbItems).values([
      { type: "form", key: "clash", name: "A form", module: "MM", yamlFile: "forms/clash.yaml", contentHash: "c" },
      { type: "process", key: "clash", name: "A flow", module: "MM", yamlFile: "processes/clash.yaml", contentHash: "d" },
    ]);
    const item = commonItem([]);
    item.key = "clash";
    const r = await pushCatalog(h.db, catalog([item]));
    expect(r.kbItemsCreated).toBe(0);
    const [card] = await h.db.select().from(cards);
    const [flow] = await h.db.select().from(kbItems).where(eq(kbItems.name, "A flow"));
    expect(card.kbItemId).toBe(flow.id);
  });

  it("still accepts a key that belongs to exactly one item of another type (older catalogs)", async () => {
    const item = commonItem([]);
    item.key = "fGRN";
    const r = await pushCatalog(h.db, catalog([item]));
    expect(r.kbItemsCreated).toBe(0);
    const [grn] = await h.db.select().from(kbItems).where(eq(kbItems.key, "fGRN"));
    const [card] = await h.db.select().from(cards);
    expect(card.kbItemId).toBe(grn.id);
  });
});

describe("push: repeated topics", () => {
  const reworded = { ...accepted, topic_key: "limits-tolerances--excess-short-accepted-calculation", title: "How is the excess, short and accepted quantity calculated on a receipt?", body: body("reworded") };

  it("refuses a new card whose title repeats a stored card of the same item, and saves nothing", async () => {
    await pushCatalog(h.db, catalog([formItem([accepted])]));
    await expect(pushCatalog(h.db, catalog([formItem([reworded])]))).rejects.toBeInstanceOf(PushRefused);
    expect(await h.db.select().from(cards)).toHaveLength(1);
  });

  it("reports it on a dry run without refusing", async () => {
    await pushCatalog(h.db, catalog([formItem([accepted])]));
    const r = await pushCatalog(h.db, catalog([formItem([reworded])]), { dryRun: true });
    expect(r.similar).toHaveLength(1);
    expect(r.similar[0]).toMatchObject({ item: "fGRN", existing: true, otherTitle: accepted.title });
    expect(await h.db.select().from(cards)).toHaveLength(1);
  });

  it("lets it through when told to only warn", async () => {
    await pushCatalog(h.db, catalog([formItem([accepted])]));
    const r = await pushCatalog(h.db, catalog([formItem([reworded])]), { duplicates: "warn" });
    expect(r.similar).toHaveLength(1);
    expect(r.cardsInserted).toBe(1);
    expect(await h.db.select().from(cards)).toHaveLength(2);
  });

  it("refuses two similar cards inside one file", async () => {
    await expect(pushCatalog(h.db, catalog([formItem([accepted, reworded])]))).rejects.toBeInstanceOf(PushRefused);
  });

  it("does not compare the same card with itself on a plain re-push", async () => {
    await pushCatalog(h.db, catalog([formItem([accepted])]));
    const r = await pushCatalog(h.db, catalog([formItem([accepted])]));
    expect(r.cardsUnchanged).toBe(1);
    expect(r.similar).toHaveLength(0);
  });

  it("compares only within an item", async () => {
    await pushCatalog(h.db, catalog([formItem([accepted])]));
    const po: Catalog["items"][number] = { ...formItem([accepted]), key: "fPurchaseOrder", title: "Purchase Order", context: "Procure-to-Pay > Purchase Order", cards: [{ ...accepted, source_refs: ["forms/fPurchaseOrder.yaml"] }] };
    const r = await pushCatalog(h.db, catalog([po]));
    expect(r.cardsInserted).toBe(1);
    expect(r.similar).toHaveLength(0);
  });
});

describe("push: revisions", () => {
  it("reports a card whose text changed, and refuses it when revisions are not allowed", async () => {
    await pushCatalog(h.db, catalog([formItem([accepted])]));
    const changed = { ...accepted, body: body("a new sentence") };
    const dry = await pushCatalog(h.db, catalog([formItem([changed])]), { dryRun: true });
    expect(dry.revisions).toHaveLength(1);
    expect(dry.cardsNewVersion).toBe(1);
    await expect(pushCatalog(h.db, catalog([formItem([changed])]), { allowRevisions: false })).rejects.toBeInstanceOf(PushRefused);
    const done = await pushCatalog(h.db, catalog([formItem([changed])]));
    expect(done.cardsNewVersion).toBe(1);
  });
});

describe("push: unresolved source_refs", () => {
  it("lists a ref that matches no knowledge-base item and still saves the card", async () => {
    const r = await pushCatalog(h.db, catalog([formItem([{ ...accepted, source_refs: ["forms/fGRN.yaml", "forms/fNoSuchForm.yaml"] }])]));
    expect(r.cardsInserted).toBe(1);
    expect(r.linksInserted).toBe(1);
    expect(r.unresolvedRefs).toEqual([{ item: "fGRN", topicKey: accepted.topic_key, ref: "forms/fNoSuchForm.yaml" }]);
  });
});

describe("browse: form questions and common questions", () => {
  it("parses the kind from the URL", () => {
    expect(parseBrowseKind("form")).toBe("form");
    expect(parseBrowseKind("common")).toBe("common");
    expect(parseBrowseKind("other")).toBe("");
    expect(parseBrowseKind(undefined)).toBe("");
  });

  it("counts form cards and common cards separately", async () => {
    await pushCatalog(h.db, catalog([formItem([accepted]), commonItem(["forms/fGRN.yaml", "forms/fPurchaseOrder.yaml"])]));
    expect(await loadKindCounts(h.db, ["functional"])).toEqual({ form: 1, common: 1 });
    expect(await loadKindCounts(h.db, ["functional"], "MM")).toEqual({ form: 1, common: 1 });
    expect(await loadKindCounts(h.db, ["functional"], "PM")).toEqual({ form: 0, common: 0 });
    expect(await loadKindCounts(h.db, ["technical"])).toEqual({ form: 0, common: 0 });
  });

  it("lists only forms in the form dropdown, and counts only form cards (not common cards that cite the form)", async () => {
    await pushCatalog(h.db, catalog([formItem([accepted]), commonItem(["forms/fGRN.yaml", "forms/fPurchaseOrder.yaml"])]));
    const forms = await loadBrowseForms(h.db, ["functional"]);
    expect(forms.map((f) => f.name)).toEqual(["Material Receipt Note (GRN)"]); // Purchase Order has no form card; the flow is not a form
    expect(forms[0]).toMatchObject({ n: 1, module: "MM" });
  });

  it("shows no form for the other card set", async () => {
    await pushCatalog(h.db, catalog([formItem([accepted])]));
    expect(await loadBrowseForms(h.db, ["technical"])).toHaveLength(0);
  });
});
