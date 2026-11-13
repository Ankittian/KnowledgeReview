import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, migrateDb, query, resetDatabase, type DbHandle } from "@/db/client";
import { activityLog, cardFeedback, cardReviews, cards, cardVersions, dailyDecks, deckCards, kbItems, roleIdOf, users } from "@/db/schema";
import { buildCatalog } from "@/lib/cards/build";
import { loadKnowledgeBase } from "@/lib/cards/load";
import { getOrCreateDeck } from "@/lib/deck";
import { recordClientEvents, recordReview } from "@/lib/review-service";
import { loadFeedbackExport, loadNeedsChange } from "@/lib/reports";
import { setDailyCardLimit } from "@/lib/settings";
import { syncCatalog } from "@/lib/sync";

const TODAY = "2026-11-06";
// the old tests answer without client timings, so they skip the read-time lock; the lock has its own describe at the end
const rr = (db: DbHandle["db"], userId: string, input: Parameters<typeof recordReview>[2], meta: Parameters<typeof recordReview>[3], today: string) =>
  recordReview(db, userId, input, meta, today, { enforceReadTime: false });
let h: DbHandle;
const kb = loadKnowledgeBase("kb");

async function mkUser(username: string, primaryModule = "MM", role: "admin" | "functional" | "technical" = "functional") {
  const [u] = await h.db
    .insert(users)
    .values({ username, passwordHash: "x", displayName: username, primaryModule, roleId: roleIdOf(role), status: "active" })
    .returning();
  return u;
}
const flaggedFeedback = () =>
  h.db.select({ id: cardFeedback.id, cardId: cardVersions.cardId }).from(cardFeedback).innerJoin(cardVersions, eq(cardVersions.id, cardFeedback.cardVersionId));
const userByName = async (username: string) => (await h.db.select().from(users).where(eq(users.username, username)))[0];

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set. Start Postgres (docker compose up -d) and set it in .env (see .env.example).");
  h = createDb({ url });
  await resetDatabase(h); // refuses unless the database name contains 'test' or 'e2e'
  await migrateDb(h);
});
afterAll(async () => h?.close());

describe("sync", () => {
  it("loads the whole catalog, then is idempotent", async () => {
    const first = await syncCatalog(h.db, buildCatalog(kb));
    expect(first.cards.inserted).toBe(first.totalCards);
    expect(first.links.inserted).toBeGreaterThan(1000);
    const second = await syncCatalog(h.db, buildCatalog(kb));
    expect(second.changed).toBe(false);
    expect(second.cards).toEqual({ inserted: 0, newVersions: 0, metaUpdated: 0, retired: 0, reactivated: 0 });
    const [{ n }] = await query<{ n: number }>(h.db, sql`SELECT count(*)::int AS n FROM cards WHERE current_version_id IS NULL`);
    expect(n).toBe(0);
  });

  it("creates exactly one new version when one rule summary changes", async () => {
    const edited = structuredClone(kb);
    edited.rules[0] = { ...edited.rules[0], summary: edited.rules[0].summary + " (edited)" };
    const r = await syncCatalog(h.db, buildCatalog(edited));
    expect(r.cards.newVersions).toBe(1);
    expect(r.entities.updated).toBe(1);
    const back = await syncCatalog(h.db, buildCatalog(kb)); // revert
    expect(back.cards.newVersions).toBe(1);
    const vs = await h.db.select().from(cardVersions).where(eq(cardVersions.cardId, `rule.summary:${kb.rules[0].key}`));
    expect(vs.map((v) => v.version).sort()).toEqual([1, 2, 3]);
  });
});

describe("deck -> review -> feedback -> needs-change", () => {
  beforeAll(async () => {
    // the template cards have no audience (never served); give them one so the deck flow can be exercised
    await h.db.execute(sql`UPDATE kb.cards SET audience = 'functional', level = 'easy', topic_key = id`);
  });

  it("builds a deck for the sign-in, stable on reload, without leaking traceability", async () => {
    const u = await mkUser("alice");
    const deck = await getOrCreateDeck(h.db, u, TODAY, "sess-alice");
    expect(deck.cards).toHaveLength(10);
    for (const c of deck.cards) expect(Object.keys(c).sort()).toEqual(["back", "context", "front", "level", "minRead", "module", "statement", "v", "weight"]);
    const again = await getOrCreateDeck(h.db, u, TODAY, "sess-alice");
    expect(again.cards.map((c) => c.v)).toEqual(deck.cards.map((c) => c.v));
    const [d] = await h.db.select().from(dailyDecks).where(eq(dailyDecks.userId, u.id));
    const mods = await h.db
      .select({ module: kbItems.module })
      .from(deckCards)
      .innerJoin(cards, eq(cards.id, deckCards.cardId))
      .innerJoin(kbItems, eq(kbItems.id, cards.kbItemId))
      .where(eq(deckCards.deckId, d.id));
    expect(mods.every((m) => m.module === "MM")).toBe(true); // prefers the user's module
  });

  it("reaches entity and field through the card version and surfaces flagged cards in needs_change", async () => {
    const alice = await userByName("alice");
    const deck = await getOrCreateDeck(h.db, alice, TODAY, "sess-alice");
    const target = deck.cards[0];
    const meta = { sessionId: "s1", ip: "127.0.0.1", userAgent: "vitest" };

    const r1 = await rr(
      h.db,
      alice.id,
      {
        clientEventId: "evt-0001-aaaa",
        versionId: target.v,
        deckDate: TODAY,
        knewIt: false,
        verdict: "needs_improvement",
        feedback: { category: "incorrect", suggestedText: "Better text", comment: "Wrong field name" },
      },
      meta,
      TODAY,
    );
    expect(r1).toMatchObject({ ok: true, duplicate: false });
    // a retry with the same client id is a no-op; a second answer to the same card in the same deck is ignored
    const retry = await rr(h.db, alice.id, { clientEventId: "evt-0001-aaaa", versionId: target.v, deckDate: TODAY, knewIt: true, verdict: "correct" }, meta, TODAY);
    expect(retry).toMatchObject({ ok: true, duplicate: true });
    const again = await rr(h.db, alice.id, { clientEventId: "evt-0002-bbbb", versionId: target.v, deckDate: TODAY, knewIt: true, verdict: "correct" }, meta, TODAY);
    expect(again).toMatchObject({ ok: true, duplicate: true });

    const [fb] = await h.db.select().from(cardFeedback);
    const [row] = await h.db.select().from(cardVersions).innerJoin(cards, eq(cards.id, cardVersions.cardId)).where(eq(cardVersions.id, target.v));
    expect(fb.cardVersionId).toBe(target.v); // card, KB item, field and reviewed text are all reached from this one id

    const flagged = await loadNeedsChange(h.db);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].card_id).toBe(row.cards.id);
    expect(flagged[0].yaml_file).toMatch(/\.yaml$/);
    expect(flagged[0].suggestions[0]).toMatchObject({ category: "incorrect", suggested_text: "Better text", username: "alice" });
    if (row.cards.kind === "rule.summary") expect(flagged[0].linked_forms.length + flagged[0].linked_processes.length).toBeGreaterThan(0);

    const exp = await loadFeedbackExport(h.db);
    expect(exp[0]).toMatchObject({ field: row.cards.sourceField, entity_key: flagged[0].entity_key });
  });

  it("completes the deck and logs every interaction", async () => {
    const alice = await userByName("alice");
    const deck = await getOrCreateDeck(h.db, alice, TODAY, "sess-alice");
    let completed = false;
    for (const [i, c] of deck.cards.slice(1).entries()) {
      const r = await rr(h.db, alice.id, { clientEventId: `evt-1${i}-cccc`, versionId: c.v, deckDate: TODAY, knewIt: i % 2 === 0, verdict: "correct" }, {}, TODAY);
      if (r.ok && r.deckCompleted) completed = true;
    }
    expect(completed).toBe(true);
    await recordClientEvents(h.db, alice.id, { events: [{ clientEventId: "ce-0001-dddd", type: "card_flipped", versionId: deck.cards[0].v }] }, {});
    const types = await query<{ event_type: string; n: number }>(h.db, sql`SELECT action AS event_type, count(*)::int AS n FROM activity_log GROUP BY 1`);
    const m = Object.fromEntries(types.map((t) => [t.event_type, t.n]));
    expect(m).toMatchObject({ review_submitted: 10, feedback_submitted: 1, deck_completed: 1, card_flipped: 1 });
    const [ev] = await h.db.select().from(activityLog).where(eq(activityLog.action, "card_flipped"));
    expect(ev.targetType).toBe("card");
    expect(ev.targetId).toBeTruthy();
    const know = await query<{ scope_key: string; reviews: string | number }>(h.db, sql`SELECT * FROM user_knowledge WHERE scope = 'module'`);
    expect(know[0].scope_key).toBe("MM");
    expect(Number(know[0].reviews)).toBe(10);
  });

  it("rejects answers for cards outside the user's deck", async () => {
    const bob = await mkUser("bob", "FI");
    const alice = await userByName("alice");
    const aliceDeck = await getOrCreateDeck(h.db, alice, TODAY, "sess-alice");
    await getOrCreateDeck(h.db, bob, TODAY, "sess-bob");
    const r = await rr(h.db, bob.id, { clientEventId: "evt-9999-zzzz", versionId: aliceDeck.cards[0].v, deckDate: TODAY, knewIt: true, verdict: "correct" }, {}, TODAY);
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  it("rolls flagged cards up to their forms and processes", async () => {
    const [fb] = await flaggedFeedback();
    const linked = await query<{ type: string; improve_votes: string | number }>(
      h.db,
      sql`SELECT rh.type, rh.improve_votes FROM kb_item_health rh
          WHERE rh.kb_item_id IN (SELECT kb_item_id FROM card_related_items WHERE card_id = ${fb.cardId}) AND rh.improve_votes > 0`,
    );
    const [{ n }] = await query<{ n: number }>(h.db, sql`SELECT count(*)::int AS n FROM card_related_items WHERE card_id = ${fb.cardId}`);
    expect(linked.length).toBe(n);
  });

  it("marks open feedback stale when the source text changes", async () => {
    const [fb] = await flaggedFeedback();
    const cat = buildCatalog(kb);
    const target = cat.cards.find((x) => x.id === fb.cardId)!;
    target.back += " (changed)";
    target.sourceHash = "changed-" + target.sourceHash;
    const r = await syncCatalog(h.db, cat);
    expect(r.staleFeedback).toBe(1);
    expect(r.cards.newVersions).toBe(1);
    const [after] = await h.db.select().from(cardFeedback).where(eq(cardFeedback.id, fb.id));
    expect(after.status).toBe("stale");
    expect(await h.db.select().from(cardReviews)).toHaveLength(10);
    // old verdicts were on the old version: the card no longer shows as flagged
    expect((await loadNeedsChange(h.db)).length).toBe(0);
  });
});

describe("random set per sign-in, capped by the admin's daily limit", () => {
  const answer = (userId: string, v: number, deckId: number | null, n: string) =>
    rr(h.db, userId, { clientEventId: `lim-${n}-xxxx`, versionId: v, deckDate: TODAY, deckId, knewIt: true, verdict: "correct" }, {}, TODAY);

  it("gives each sign-in a new random set and never exceeds the daily limit", async () => {
    await setDailyCardLimit(h.db, 10);
    const carol = await mkUser("carol");

    const first = await getOrCreateDeck(h.db, carol, TODAY, "carol-1");
    expect(first.cards).toHaveLength(10);
    expect(first.dailyLimit).toBe(10);
    // reload within the same sign-in keeps the same set
    expect((await getOrCreateDeck(h.db, carol, TODAY, "carol-1")).cards.map((c) => c.v)).toEqual(first.cards.map((c) => c.v));

    // answer 4, then sign in again: a different random set of the remaining 6
    for (const [i, c] of first.cards.slice(0, 4).entries()) expect(await answer(carol.id, c.v, first.deckId, `a${i}`)).toMatchObject({ ok: true, duplicate: false });
    const second = await getOrCreateDeck(h.db, carol, TODAY, "carol-2");
    expect(second.deckId).not.toBe(first.deckId);
    expect(second.answeredToday).toBe(4);
    expect(second.cards).toHaveLength(6);
    const answeredV = new Set(first.cards.slice(0, 4).map((c) => c.v));
    expect(second.cards.some((c) => answeredV.has(c.v))).toBe(false);
    expect(second.cards.map((c) => c.v)).not.toEqual(first.cards.slice(4).map((c) => c.v)); // random, not a replay

    // an answer from the abandoned first set still counts (and is still accepted)
    expect(await answer(carol.id, first.cards[4].v, first.deckId, "a4")).toMatchObject({ ok: true });
    const leftover = second.cards.filter((c) => c.v !== first.cards[4].v);
    for (const [i, c] of leftover.slice(0, 5).entries()) await answer(carol.id, c.v, second.deckId, `b${i}`);

    // limit reached: a third sign-in gets nothing new, and extra answers are refused
    const third = await getOrCreateDeck(h.db, carol, TODAY, "carol-3");
    expect(third.answeredToday).toBe(10);
    expect(third.cards).toHaveLength(0);
    const extra = leftover[5] ?? second.cards[5];
    expect(await answer(carol.id, extra.v, second.deckId, "c0")).toMatchObject({ ok: false, status: 409 });

    const evs = await query<{ event_type: string; n: number }>(
      h.db,
      sql`SELECT action AS event_type, count(*)::int AS n FROM activity_log WHERE user_id = ${carol.id} GROUP BY 1`,
    );
    const m = Object.fromEntries(evs.map((e) => [e.event_type, e.n]));
    expect(m).toMatchObject({ deck_created: 2, review_submitted: 10, daily_limit_reached: 1 });
  });

  it("applies a raised limit immediately by topping up the current sign-in", async () => {
    const carol = await userByName("carol");
    await setDailyCardLimit(h.db, 13);
    const more = await getOrCreateDeck(h.db, carol, TODAY, "carol-3");
    expect(more.cards.length).toBe(3);
    expect(more.dailyLimit).toBe(13);
    // lowering it hides open cards beyond the limit
    await setDailyCardLimit(h.db, 11);
    const fewer = await getOrCreateDeck(h.db, carol, TODAY, "carol-3");
    expect(fewer.cards.length).toBe(1);
    await setDailyCardLimit(h.db, 10);
  });
});

describe("card sets and the read-time lock", () => {
  let seeded: { fn: number; tech: number; legacy: number };
  // three generated cards in one form: one functional, one technical, and a legacy card without an audience
  async function seedCards() {
    const [item] = await query<{ id: number }>(h.db, sql`SELECT id FROM kb_items WHERE type = 'form' LIMIT 1`);
    const mk = async (id: string, audience: "functional" | "technical" | null, level: "easy" | "hard", body: string) => {
      await h.db.insert(cards).values({ id, kbItemId: item.id, kind: "generated", sourceField: "generated", audience, level, topicKey: audience ? id : null });
      const [v] = await h.db.insert(cardVersions).values({ cardId: id, version: 1, context: "Test form", front: `Title ${id}`, back: body, sourceText: body, sourceHash: id }).returning();
      await h.db.update(cards).set({ currentVersionId: v.id }).where(eq(cards.id, id));
      return v.id;
    };
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
    return { fn: await mk("t:fn", "functional", "easy", words(50)), tech: await mk("t:tech", "technical", "hard", words(200)), legacy: await mk("t:legacy", null, "easy", words(20)) };
  }

  it("serves each user only their own set and never legacy cards", async () => {
    await h.db.execute(sql`UPDATE kb.cards SET status = 'retired'`);
    const ids = (seeded = await seedCards());
    const fnUser = await mkUser("fn-user", "MM", "functional");
    const techUser = await mkUser("tech-user", "MM", "technical");
    const fnDeck = await getOrCreateDeck(h.db, fnUser, TODAY, "s-fn", ["functional"]);
    const techDeck = await getOrCreateDeck(h.db, techUser, TODAY, "s-tech", ["technical"]);
    expect(fnDeck.cards.map((c) => c.v)).toEqual([ids.fn]);
    expect(techDeck.cards.map((c) => c.v)).toEqual([ids.tech]);
    expect(fnDeck.cards[0]).toMatchObject({ statement: true, level: "easy", weight: 1, minRead: 10 });
    expect(techDeck.cards[0]).toMatchObject({ level: "hard", weight: 3, minRead: 40 });
  });

  it("refuses an answer for a card outside the user's set or without an audience", async () => {
    const fnUser = await userByName("fn-user");
    const tech = { id: seeded.tech };
    const legacy = { id: seeded.legacy };
    const ask = (versionId: number, n: string) =>
      rr(h.db, fnUser.id, { clientEventId: `aud-${n}-xxxxxx`, versionId, deckDate: TODAY, knewIt: true, verdict: "correct" }, {}, TODAY);
    expect(await ask(tech.id, "t")).toMatchObject({ ok: false, status: 404 });
    expect(await ask(legacy.id, "l")).toMatchObject({ ok: false, status: 404 });
  });

  it("locks the answer until the designated read time, on the server", async () => {
    const fnUser = await userByName("fn-user");
    const deck = await getOrCreateDeck(h.db, fnUser, TODAY, "s-fn", ["functional"]);
    const v = deck.cards[0].v; // 50 words -> 10 s
    const now = Date.now();
    const at = (msAgo: number) => new Date(now - msAgo).toISOString();
    const base = { versionId: v, deckDate: TODAY, deckId: deck.deckId, knewIt: true, verdict: "correct" as const };
    const send = (n: string, extra: Record<string, unknown>) =>
      recordReview(h.db, fnUser.id, { clientEventId: `lock-${n}-xxxxx`, ...base, ...extra } as Parameters<typeof recordReview>[2], {}, TODAY, { enforceReadTime: true }); // the lock itself is switched off globally (READ_LOCK_ENABLED); tested here explicitly

    // answered 2 s after it was shown: too early
    expect(await send("a", { shownAt: at(2_000), answeredAt: at(0) })).toMatchObject({ ok: false, status: 409 });
    // no timings at all: refused
    expect(await send("b", {})).toMatchObject({ ok: false, status: 409 });
    // 60 s on the wall clock but only 3 s of attended time reported: refused
    expect(await send("c", { shownAt: at(60_000), answeredAt: at(0), activeMs: 3_000 })).toMatchObject({ ok: false, status: 409 });
    // claiming more attended time than actually passed does not help (capped by the wall clock)
    expect(await send("d", { shownAt: at(2_000), answeredAt: at(0), activeMs: 600_000 })).toMatchObject({ ok: false, status: 409 });
    // an answer time in the future is refused
    expect(await send("e", { shownAt: at(60_000), answeredAt: new Date(now + 10 * 60_000).toISOString() })).toMatchObject({ ok: false, status: 400 });
    // after the read time it is accepted
    expect(await send("f", { shownAt: at(12_000), answeredAt: at(0), activeMs: 11_500 })).toMatchObject({ ok: true, duplicate: false });
  });
});
