/** Chat database integration tests (needs TEST_DATABASE_URL; the database is wiped). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, migrateDb, resetDatabase, type DbHandle } from "@/db/client";
import { chatMessages, chatToolCalls, conversations, interactionEvents, users } from "@/db/schema";
import { getLiveRun, hasActiveRunForUser, releaseUser, reserveUser, setRunner, startAnswer, stopAnswer, subscribe, type LiveEvent } from "@/lib/chat/live";
import { MockRunner, type RunRequest, type RunResult } from "@/lib/chat/runner";
import {
  adminListChats,
  createConversation,
  getAnswerRole,
  getOwnConversation,
  getOwnMessage,
  insertMessage,
  listConversations,
  questionsToday,
  replayHistory,
  saveFeedback,
  setAnswerRole,
  softDeleteConversation,
} from "@/lib/chat/service";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- database: service + live runs

let h: DbHandle;
let alice: { id: string; username: string };
let bob: { id: string; username: string };
let admin: { id: string; username: string };

async function mkUser(username: string, role: "employee" | "admin" = "employee") {
  const [u] = await h.db.insert(users).values({ username, passwordHash: "x", displayName: username, status: "active", role }).returning();
  return { id: u.id, username: u.username };
}

/** Saves a question + placeholder, starts the run, waits for it to finish. */
async function ask(user: { id: string; username: string }, convId: string, question: string, opts: { wait?: boolean } = {}) {
  const [conv] = await h.db.select().from(conversations).where(eq(conversations.id, convId));
  const q = await insertMessage(h.db, { conversationId: convId, sender: "user", content: question });
  const a = await insertMessage(h.db, { conversationId: convId, sender: "assistant", replyToId: q.id, status: "streaming" });
  const run = startAnswer({ db: h.db, conversationId: convId, claudeSessionId: conv.claudeSessionId, role: conv.roleUsed, user, userMessageId: q.id, assistantMessageId: a.id, question });
  if (opts.wait !== false) await (run as unknown as { done: Promise<void> }).done;
  return { questionId: q.id, answerId: a.id, run };
}
const msg = async (id: number) => (await h.db.select().from(chatMessages).where(eq(chatMessages.id, id)))[0];

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  h = createDb({ url });
  await resetDatabase(h);
  await migrateDb(h);
  alice = await mkUser("alice");
  bob = await mkUser("bob");
  admin = await mkUser("boss", "admin");
});
afterAll(async () => {
  setRunner(null);
  await h?.close();
});
beforeEach(() => {
  process.env.CHAT_TIMEOUT_SECONDS = "120";
  process.env.MAX_CONCURRENT_CLAUDE = "3";
  setRunner(new MockRunner());
});

describe("ownership (general users never see other users' chats)", () => {
  it("scopes conversations and messages to their owner", async () => {
    const c = await createConversation(h.db, alice.id, "Alice chat", "functional");
    const { answerId } = await ask(alice, c.id, "What is GRN?");
    expect(await getOwnConversation(h.db, alice.id, c.id)).not.toBeNull();
    expect(await getOwnConversation(h.db, bob.id, c.id)).toBeNull();
    expect(await getOwnMessage(h.db, alice.id, answerId)).not.toBeNull();
    expect(await getOwnMessage(h.db, bob.id, answerId)).toBeNull();
    expect((await listConversations(h.db, bob.id)).map((x) => x.id)).not.toContain(c.id);
    expect(await getOwnConversation(h.db, alice.id, "not-a-uuid")).toBeNull();
  });
  it("soft delete hides the chat from its owner but keeps it for admins", async () => {
    const c = await createConversation(h.db, alice.id, "To delete", "product");
    expect(await softDeleteConversation(h.db, bob.id, c.id)).toBe(false);
    expect(await softDeleteConversation(h.db, alice.id, c.id)).toBe(true);
    expect(await getOwnConversation(h.db, alice.id, c.id)).toBeNull();
    expect((await adminListChats(h.db, {})).map((r) => r.id)).not.toContain(c.id);
    expect((await adminListChats(h.db, { includeDeleted: true })).map((r) => r.id)).toContain(c.id);
  });
  it("answer roles: default functional, set by admin", async () => {
    expect(await getAnswerRole(h.db, bob.id)).toBe("functional");
    await setAnswerRole(h.db, bob.id, "technical", admin.id);
    expect(await getAnswerRole(h.db, bob.id)).toBe("technical");
  });
});

describe("live answers (REQ-CHAT-01, 02, 08, 09; REQ-HARN-04, 08)", () => {
  it("streams, saves the answer, session id, tokens and tool calls; denials are audit-logged", async () => {
    setRunner(
      new MockRunner(async (req: RunRequest): Promise<RunResult> => {
        req.onEvent({ type: "session", sessionId: "sess-1", model: "m" });
        req.onEvent({ type: "tool_use", toolUseId: "t1", name: "mcp__spectrum-kg__search", input: { query: "grn" } });
        req.onEvent({ type: "tool_result", toolUseId: "t1", isError: false });
        req.onEvent({ type: "tool_denied", toolUseId: "t2", name: "Bash", input: { command: "cat .env" } });
        req.onEvent({ type: "tool_denied", toolUseId: "t2", name: "Bash", input: { command: "cat .env" } }); // reported twice by the SDK
        req.onEvent({ type: "text", delta: "GRN records " });
        req.onEvent({ type: "text", delta: "received goods." });
        return { ok: true, sessionId: "sess-1", model: "m", tokensIn: 50, tokensOut: 7, numTurns: 2, producedOutput: true };
      }),
    );
    const c = await createConversation(h.db, alice.id, "Streaming", "technical");
    const { answerId } = await ask(alice, c.id, "What is GRN?");
    const m = await msg(answerId);
    expect(m).toMatchObject({ status: "ok", content: "GRN records received goods.", tokensIn: 50, tokensOut: 7, numTurns: 2 });
    const [conv] = await h.db.select().from(conversations).where(eq(conversations.id, c.id));
    expect(conv.claudeSessionId).toBe("sess-1");
    const tools = await h.db.select().from(chatToolCalls).where(eq(chatToolCalls.messageId, answerId));
    expect(tools.map((t) => [t.toolName, t.allowed])).toEqual([
      ["mcp__spectrum-kg__search", true],
      ["Bash", false],
    ]);
    const denied = await h.db.select().from(interactionEvents).where(eq(interactionEvents.eventType, "chat_tool_denied"));
    expect(denied).toHaveLength(1);
    expect(denied[0].payload).toMatchObject({ tool: "Bash", messageId: answerId });
    const audit = await h.db.select().from(interactionEvents).where(eq(interactionEvents.eventType, "chat_answer"));
    expect(audit.at(-1)?.payload).toMatchObject({ messageId: answerId, status: "ok", answer: "GRN records received goods.", role: "technical" });
  });

  it("follow-ups resume the stored Claude session; the role is applied on every turn", async () => {
    const seen: RunRequest[] = [];
    setRunner(
      new MockRunner(async (req) => {
        seen.push(req);
        req.onEvent({ type: "session", sessionId: "sess-follow", model: "m" });
        req.onEvent({ type: "text", delta: "ok" });
        return { ok: true, sessionId: "sess-follow", tokensIn: 1, tokensOut: 1, numTurns: 1, producedOutput: true };
      }),
    );
    const c = await createConversation(h.db, alice.id, "Follow", "product");
    await ask(alice, c.id, "first");
    await ask(alice, c.id, "second");
    expect(seen.map((r) => [r.resumeSessionId ?? null, r.role, r.prompt])).toEqual([
      [null, "product", "first"],
      ["sess-follow", "product", "second"],
    ]);
  });

  it("replays the stored history when the session cannot be resumed", async () => {
    const prompts: { prompt: string; resume: string | null | undefined }[] = [];
    setRunner(
      new MockRunner(async (req) => {
        prompts.push({ prompt: req.prompt, resume: req.resumeSessionId });
        if (req.resumeSessionId === "gone") return { ok: false, errorCode: "error", errorDetail: "No conversation found with session ID: gone", tokensIn: 0, tokensOut: 0, numTurns: 0, producedOutput: false };
        req.onEvent({ type: "session", sessionId: "fresh", model: "m" });
        req.onEvent({ type: "text", delta: "answer with context" });
        return { ok: true, sessionId: "fresh", tokensIn: 1, tokensOut: 1, numTurns: 1, producedOutput: true };
      }),
    );
    const c = await createConversation(h.db, bob.id, "Replay", "functional");
    await insertMessage(h.db, { conversationId: c.id, sender: "user", content: "What is a PO?" });
    await insertMessage(h.db, { conversationId: c.id, sender: "assistant", content: "A purchase order.", status: "ok" });
    await h.db.update(conversations).set({ claudeSessionId: "gone" }).where(eq(conversations.id, c.id));
    const { answerId } = await ask(bob, c.id, "And after it?");
    expect(prompts).toHaveLength(2);
    expect(prompts[1].resume).toBeNull();
    expect(prompts[1].prompt).toContain("What is a PO?");
    expect(prompts[1].prompt).toContain("A purchase order.");
    expect(prompts[1].prompt.endsWith("And after it?")).toBe(true);
    expect(await msg(answerId)).toMatchObject({ status: "ok", content: "answer with context" });
    expect((await replayHistory(h.db, c.id, answerId, 8)).map((t) => t.content)).toContain("And after it?");
  });

  it("Stop keeps the partial answer, marked stopped", async () => {
    setRunner(
      new MockRunner(async (req) => {
        req.onEvent({ type: "text", delta: "partial " });
        await new Promise<void>((r) => req.signal.addEventListener("abort", () => r(), { once: true }));
        return { ok: false, errorCode: "error", tokensIn: 3, tokensOut: 1, numTurns: 1, producedOutput: true };
      }),
    );
    const c = await createConversation(h.db, alice.id, "Stop", "functional");
    const { answerId, run } = await ask(alice, c.id, "long question", { wait: false });
    await tick(30);
    expect(stopAnswer(answerId)).toBe(true);
    await (run as unknown as { done: Promise<void> }).done;
    expect(await msg(answerId)).toMatchObject({ status: "stopped", content: "partial ", errorCode: null });
  });

  it("times out after the configured limit with a clear error", async () => {
    process.env.CHAT_TIMEOUT_SECONDS = "1";
    setRunner(
      new MockRunner(async (req) => {
        await new Promise<void>((r) => req.signal.addEventListener("abort", () => r(), { once: true }));
        return { ok: false, errorCode: "error", tokensIn: 0, tokensOut: 0, numTurns: 0, producedOutput: false };
      }),
    );
    const c = await createConversation(h.db, alice.id, "Slow", "functional");
    const { answerId } = await ask(alice, c.id, "slow");
    expect(await msg(answerId)).toMatchObject({ status: "error", errorCode: "timeout" });
  });

  it("passes usage-limit and KB errors through", async () => {
    setRunner(new MockRunner(async () => ({ ok: false, errorCode: "usage_limit", tokensIn: 0, tokensOut: 0, numTurns: 0, producedOutput: false })));
    const c = await createConversation(h.db, alice.id, "Limit", "functional");
    const { answerId } = await ask(alice, c.id, "q");
    expect(await msg(answerId)).toMatchObject({ status: "error", errorCode: "usage_limit" });
  });

  it("queues answers beyond the slot limit, FIFO, and reports positions", async () => {
    process.env.MAX_CONCURRENT_CLAUDE = "1";
    const releases: (() => void)[] = [];
    const startedOrder: string[] = [];
    setRunner(
      new MockRunner(async (req) => {
        startedOrder.push(req.prompt);
        await new Promise<void>((r) => releases.push(r));
        req.onEvent({ type: "text", delta: "done" });
        return { ok: true, tokensIn: 1, tokensOut: 1, numTurns: 1, producedOutput: true };
      }),
    );
    const c1 = await createConversation(h.db, alice.id, "Q1", "functional");
    const c2 = await createConversation(h.db, bob.id, "Q2", "functional");
    const first = await ask(alice, c1.id, "one", { wait: false });
    await tick(20);
    const second = await ask(bob, c2.id, "two", { wait: false });
    await tick(20);
    const events: LiveEvent[] = [];
    subscribe(second.answerId, (e) => events.push(e));
    expect(events[0]).toMatchObject({ type: "snapshot", phase: "queued", position: 1 });
    expect(getLiveRun(second.answerId)?.phase).toBe("queued");
    expect(startedOrder).toEqual(["one"]);
    releases.shift()!();
    await (first.run as unknown as { done: Promise<void> }).done;
    await tick(20);
    expect(startedOrder).toEqual(["one", "two"]);
    expect(events.some((e) => e.type === "started")).toBe(true);
    releases.shift()!();
    await (second.run as unknown as { done: Promise<void> }).done;
    expect(events.at(-1)).toMatchObject({ type: "done", status: "ok", text: "done" });
  });

  it("one answer at a time per user", async () => {
    expect(hasActiveRunForUser(alice.id)).toBe(false);
    expect(reserveUser(alice.id)).toBe(true);
    expect(reserveUser(alice.id)).toBe(false);
    releaseUser(alice.id);
    expect(reserveUser(alice.id)).toBe(true);
    releaseUser(alice.id);
  });
});

describe("feedback, limits and admin view (REQ-CHAT-06, 07; REQ-HARN-06)", () => {
  it("counts today's questions per user", async () => {
    const n = await questionsToday(h.db, alice.id);
    const c = await createConversation(h.db, alice.id, "Count", "functional");
    await insertMessage(h.db, { conversationId: c.id, sender: "user", content: "x" });
    expect(await questionsToday(h.db, alice.id)).toBe(n + 1);
  });
  it("admin list filters by user, role and feedback", async () => {
    const c = await createConversation(h.db, bob.id, "Rated", "technical");
    const { answerId } = await ask(bob, c.id, "rate me");
    await saveFeedback(h.db, bob.id, answerId, "down", "wrong table");
    await saveFeedback(h.db, bob.id, answerId, "down", "wrong table name"); // upsert, not a second row
    const down = await adminListChats(h.db, { feedback: "down" });
    expect(down.map((r) => r.id)).toContain(c.id);
    expect(down.find((r) => r.id === c.id)).toMatchObject({ downs: 1, ups: 0, questions: 1, roleUsed: "technical", username: "bob" });
    expect((await adminListChats(h.db, { userId: alice.id })).every((r) => r.username === "alice")).toBe(true);
    expect((await adminListChats(h.db, { role: "product" })).every((r) => r.roleUsed === "product")).toBe(true);
    expect((await adminListChats(h.db, { feedback: "none" })).map((r) => r.id)).not.toContain(c.id);
  });
});
