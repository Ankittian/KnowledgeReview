/** Leaderboard scoring against the test database (needs TEST_DATABASE_URL; the database is wiped). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { applySchema, createDb, resetDatabase, type DbHandle } from "@/db/client";
import { cardReviews, cards, cardVersions, kbItems, roleIdOf, users } from "@/db/schema";
import { FLAG_POINTS_MULTIPLIER, LEVELS, pointsFor } from "@/lib/cards/spec";
import { getLeaderboard } from "@/lib/leaderboard";

let h: DbHandle;
let kbId: number;
const versions: Record<string, number> = {};

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set. Start Postgres (docker compose up -d) and set it in .env (see .env.example).");
  h = createDb({ url });
  await resetDatabase(h);
  await applySchema(h);
});
afterAll(async () => h?.close());

beforeEach(async () => {
  await h.db.execute(sql`TRUNCATE kb_items, cards, card_versions, card_reviews, users RESTART IDENTITY CASCADE`);
  [{ id: kbId }] = await h.db.insert(kbItems).values({ type: "form", key: "fGRN", name: "GRN", module: "MM", yamlFile: "forms/fGRN.yaml", contentHash: "a" }).returning({ id: kbItems.id });
  for (const level of ["easy", "medium", "hard"] as const) {
    await h.db.insert(cards).values({ id: `gen:fGRN:functional:${level}:a--b`, kbItemId: kbId, kind: "generated", sourceField: "card", audience: "functional", level, topicKey: "a--b" });
    const [v] = await h.db.insert(cardVersions).values({ cardId: `gen:fGRN:functional:${level}:a--b`, version: 1, context: "c", front: "Q?", back: "A", sourceText: "s", sourceHash: level }).returning({ id: cardVersions.id });
    versions[level] = v.id;
  }
});

let n = 0;
const mkUser = async (name: string) => (await h.db.insert(users).values({ username: name, passwordHash: "x", displayName: name, roleId: roleIdOf("functional"), status: "active" }).returning())[0];
const answer = (userId: string, level: string, verdict: "correct" | "needs_improvement" | "unsure", at = new Date()) =>
  h.db.insert(cardReviews).values({ userId, cardVersionId: versions[level], knewIt: verdict === "correct", verdict, answeredAt: at, clientEventId: `e${++n}`, source: "browse" });
const points = async (userId: string) => (await getLeaderboard(h.db, "all", userId)).find((r) => r.userId === userId)?.points ?? 0;

describe("leaderboard points", () => {
  it("a normal answer earns the card weight; reporting it incorrect or incomplete earns double", async () => {
    const a = await mkUser("knower");
    const b = await mkUser("flagger");
    await answer(a.id, "medium", "correct");
    await answer(b.id, "medium", "needs_improvement");
    expect(FLAG_POINTS_MULTIPLIER).toBe(2);
    expect(await points(a.id)).toBe(LEVELS.medium.weight);
    expect(await points(b.id)).toBe(LEVELS.medium.weight * 2);
    expect(pointsFor("hard", true)).toBe(LEVELS.hard.weight * 2);
    expect(pointsFor("hard")).toBe(LEVELS.hard.weight);
  });

  it("adds up across cards, and 'unsure' earns nothing", async () => {
    const u = await mkUser("mixed");
    await answer(u.id, "easy", "needs_improvement"); // 1 x 2
    await answer(u.id, "medium", "correct"); // 2
    await answer(u.id, "hard", "unsure"); // 0
    expect(await points(u.id)).toBe(LEVELS.easy.weight * 2 + LEVELS.medium.weight);
  });

  it("each card scores once, from the first scoring answer", async () => {
    const u = await mkUser("first");
    await answer(u.id, "hard", "needs_improvement", new Date(Date.now() - 3600_000));
    await answer(u.id, "hard", "correct", new Date()); // a later answer to the same card adds nothing
    expect(await points(u.id)).toBe(LEVELS.hard.weight * 2);
    const row = (await getLeaderboard(h.db, "all", u.id)).find((r) => r.userId === u.id)!;
    expect(row.cards).toBe(1);

    const v = await mkUser("flag-after-known");
    await answer(v.id, "hard", "correct", new Date(Date.now() - 3600_000));
    await answer(v.id, "hard", "needs_improvement", new Date());
    expect(await points(v.id)).toBe(LEVELS.hard.weight); // first answer wins; flagging later does not add more
  });
});
