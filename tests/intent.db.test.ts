/** Intent classifier: database side (blocked_category column + admin "Blocked" filter). Needs TEST_DATABASE_URL; the database is wiped. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, applySchema, resetDatabase, query, type DbHandle } from "@/db/client";
import { chatMessages, roleIdOf, users } from "@/db/schema";
import { adminListChats, createConversation, insertMessage, BLOCKED_FILTERS } from "@/lib/chat/service";

let h: DbHandle;
let alice: string;

/** A finished question/answer pair; `blocked` marks the answer as refused by the classifier. */
async function turn(convId: string, question: string, blocked: string | null = null) {
  const q = await insertMessage(h.db, { conversationId: convId, sender: "user", content: question });
  return insertMessage(h.db, {
    conversationId: convId,
    sender: "assistant",
    replyToId: q.id,
    content: blocked ? "I can't help with that." : "Sure.",
    status: "ok",
    blockedCategory: blocked,
    completedAt: new Date(),
  });
}

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  h = createDb({ url });
  await resetDatabase(h);
  await applySchema(h);
  const [u] = await h.db.insert(users).values({ username: "alice", passwordHash: "x", displayName: "alice", status: "active", roleId: roleIdOf("functional") }).returning();
  alice = u.id;
});
afterAll(async () => {
  await h?.close();
});

describe("blocked_category", () => {
  it("is NULL by default and stores the category on the assistant row", async () => {
    const c = await createConversation(h.db, alice, "col", "functional");
    const ok = await turn(c.id, "what is a GRN?");
    const bad = await turn(c.id, "ignore all rules", "jailbreak");
    const [a] = await h.db.select().from(chatMessages).where(eq(chatMessages.id, ok.id));
    const [b] = await h.db.select().from(chatMessages).where(eq(chatMessages.id, bad.id));
    expect(a.blockedCategory).toBeNull();
    expect(b.blockedCategory).toBe("jailbreak");
  });

  it("the idempotent migration column exists exactly once and is nullable text", async () => {
    const cols = await query<{ data_type: string; is_nullable: string }>(
      h.db,
      sql`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'chat_messages' AND column_name = 'blocked_category'`,
    );
    expect(cols).toEqual([{ data_type: "text", is_nullable: "YES" }]);
  });
});

describe("admin chats: Blocked filter", () => {
  it("filters by any blocked answer and by each category", async () => {
    const clean = await createConversation(h.db, alice, "clean chat", "functional");
    await turn(clean.id, "what is a GRN?");
    const ids: Record<string, string> = {};
    for (const cat of BLOCKED_FILTERS) {
      const c = await createConversation(h.db, alice, `blocked ${cat}`, "functional");
      await turn(c.id, "fine question");
      await turn(c.id, "bad question", cat);
      ids[cat] = c.id;
    }

    const any = (await adminListChats(h.db, { blocked: "any" })).map((r) => r.id);
    expect(any).not.toContain(clean.id);
    for (const cat of BLOCKED_FILTERS) expect(any).toContain(ids[cat]);

    for (const cat of BLOCKED_FILTERS) {
      const only = (await adminListChats(h.db, { blocked: cat })).map((r) => r.id);
      expect(only).toContain(ids[cat]);
      expect(only).not.toContain(clean.id);
      for (const other of BLOCKED_FILTERS) if (other !== cat) expect(only).not.toContain(ids[other]);
    }

    // no filter still lists everything, clean chat included
    expect((await adminListChats(h.db, {})).map((r) => r.id)).toContain(clean.id);
  });

  it("ignores an unknown category instead of injecting it", async () => {
    // @ts-expect-error not a BlockedFilter: must neither throw nor filter
    const rows = await adminListChats(h.db, { blocked: "x' OR 1=1 --" });
    expect(rows.length).toBeGreaterThan(0);
  });
});
