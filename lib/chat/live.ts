import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { chatMessages, conversations } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { chatConfig, type AnswerRole } from "./config";
import { looksLikeResumeFailure, type ChatErrorCode } from "./errors";
import { toolActivityLabel } from "./policy";
import { buildReplayPrompt } from "./prompts";
import { SlotQueue } from "./queue";
import { createRunner, type ClaudeRunner, type RunResult, type RunUser } from "./runner";
import { insertToolCalls, replayHistory } from "./service";

/**
 * Answers run inside this Node process, independent of the HTTP request that started them: closing the tab does not
 * stop an answer, and reopening it re-attaches to the live stream. Text is flushed to Postgres while it streams, so a
 * page reload always shows what has been written so far.
 */

export type LiveEvent =
  | { type: "snapshot"; text: string; phase: Phase; position: number; activity: string | null }
  | { type: "queued"; position: number }
  | { type: "started" }
  | { type: "delta"; text: string }
  | { type: "activity"; label: string | null }
  | { type: "done"; status: "ok" | "stopped" | "error"; errorCode: ChatErrorCode | null; text: string };

type Phase = "queued" | "running" | "done";

interface ToolCallRec {
  toolUseId: string | null;
  toolName: string;
  arguments: Record<string, unknown>;
  allowed: boolean;
  isError: boolean | null;
  startedAt: number;
  durationMs: number | null;
}

interface LiveRun {
  messageId: number;
  conversationId: string;
  userId: string;
  phase: Phase;
  position: number;
  text: string;
  activity: string | null;
  listeners: Set<(e: LiveEvent) => void>;
  abort: AbortController;
  stopReason: "user" | "timeout" | null;
  final: Extract<LiveEvent, { type: "done" }> | null;
  done: Promise<void>;
}

interface Registry {
  runs: Map<number, LiveRun>;
  queue: SlotQueue;
  runner: ClaudeRunner | null;
}

const g = globalThis as unknown as { __kr_chat?: Registry };
function registry(): Registry {
  return (g.__kr_chat ??= { runs: new Map(), queue: new SlotQueue(() => chatConfig().maxConcurrent), runner: null });
}

/** Tests inject a MockRunner here. */
export function setRunner(r: ClaudeRunner | null) {
  registry().runner = r;
}
const runner = () => (registry().runner ??= createRunner());

export const queueStats = () => registry().queue.stats;
export const getLiveRun = (messageId: number) => registry().runs.get(messageId) ?? null;
export const hasActiveRunForConversation = (conversationId: string) =>
  [...registry().runs.values()].some((r) => r.conversationId === conversationId && r.phase !== "done");
export const hasActiveRunForUser = (userId: string) => [...registry().runs.values()].some((r) => r.userId === userId && r.phase !== "done");

const sending = new Set<string>();
/**
 * Claims the "one answer at a time" slot for a user while their question is being saved, closing the gap between the
 * check and startAnswer(). Returns false if the user already has an answer running or being started.
 */
export function reserveUser(userId: string): boolean {
  if (sending.has(userId) || hasActiveRunForUser(userId)) return false;
  sending.add(userId);
  return true;
}
export const releaseUser = (userId: string) => void sending.delete(userId);

export interface StartAnswerInput {
  db: DB;
  conversationId: string;
  claudeSessionId: string | null;
  role: AnswerRole;
  user: RunUser;
  /** The user's question row; earlier rows are the history replayed if the session cannot be resumed. */
  userMessageId: number;
  /** The assistant placeholder row (status 'streaming') this run fills in. */
  assistantMessageId: number;
  question: string;
  meta?: { sessionId?: string | null; ip?: string | null; userAgent?: string | null };
}

export function startAnswer(input: StartAnswerInput): LiveRun {
  const reg = registry();
  const run: LiveRun = {
    messageId: input.assistantMessageId,
    conversationId: input.conversationId,
    userId: input.user.id,
    phase: "queued",
    position: 0,
    text: "",
    activity: null,
    listeners: new Set(),
    abort: new AbortController(),
    stopReason: null,
    final: null,
    done: Promise.resolve(),
  };
  reg.runs.set(run.messageId, run);
  run.done = execute(run, input).catch((e) => console.error("[chat] run crashed", e));
  return run;
}

/** Stop button (REQ-CHAT-08): cancels a queued or running answer; the partial text is kept as "stopped". */
export function stopAnswer(messageId: number): boolean {
  const run = registry().runs.get(messageId);
  if (!run || run.phase === "done") return false;
  run.stopReason = "user";
  run.abort.abort("stopped");
  return true;
}

/** Stops whatever is running in a conversation (used when it is deleted). */
export function stopConversation(conversationId: string): void {
  for (const r of registry().runs.values()) if (r.conversationId === conversationId && r.phase !== "done") stopAnswer(r.messageId);
}

/** Subscribe to a live answer. The first event is always a snapshot of everything so far. Returns an unsubscribe. */
export function subscribe(messageId: number, fn: (e: LiveEvent) => void): (() => void) | null {
  const run = registry().runs.get(messageId);
  if (!run) return null;
  fn({ type: "snapshot", text: run.text, phase: run.phase, position: run.position, activity: run.activity });
  if (run.final) {
    fn(run.final);
    return () => {};
  }
  run.listeners.add(fn);
  return () => run.listeners.delete(fn);
}

function emit(run: LiveRun, e: LiveEvent) {
  for (const fn of run.listeners) {
    try {
      fn(e);
    } catch {
      /* a broken listener must not break the run */
    }
  }
}

async function execute(run: LiveRun, input: StartAnswerInput) {
  const { db } = input;
  const cfg = chatConfig();
  const started = Date.now();
  const tools: ToolCallRec[] = [];
  let flushedLen = 0;
  let flushing: Promise<unknown> | null = null;
  const flush = () => {
    if (flushing || run.text.length === flushedLen) return;
    const len = run.text.length;
    flushing = db
      .update(chatMessages)
      .set({ content: run.text })
      .where(eq(chatMessages.id, run.messageId))
      .then(() => (flushedLen = len))
      .catch(() => {})
      .finally(() => (flushing = null));
  };

  const ticket = registry().queue.acquire({
    signal: run.abort.signal,
    onPosition: (pos) => {
      run.position = pos;
      if (pos > 0) emit(run, { type: "queued", position: pos });
    },
  });

  let result: RunResult | null = null;
  let timer: NodeJS.Timeout | undefined;
  let flushTimer: NodeJS.Timeout | undefined;
  try {
    await ticket.ready;
    run.phase = "running";
    emit(run, { type: "started" });
    timer = setTimeout(() => {
      run.stopReason = "timeout";
      run.abort.abort("timeout");
    }, cfg.timeoutMs);
    flushTimer = setInterval(flush, 1500);

    const attempt = (prompt: string, resumeSessionId: string | null) =>
      runner().run({
        prompt,
        role: input.role,
        user: input.user,
        resumeSessionId,
        signal: run.abort.signal,
        onEvent: (e) => {
          switch (e.type) {
            case "session":
              void db.update(conversations).set({ claudeSessionId: e.sessionId }).where(eq(conversations.id, run.conversationId)).catch(() => {});
              break;
            case "text":
              run.text += e.delta;
              if (run.activity) {
                run.activity = null;
                emit(run, { type: "activity", label: null });
              }
              emit(run, { type: "delta", text: e.delta });
              break;
            case "tool_use":
              tools.push({ toolUseId: e.toolUseId, toolName: e.name, arguments: e.input, allowed: true, isError: null, startedAt: Date.now(), durationMs: null });
              run.activity = toolActivityLabel(e.name);
              emit(run, { type: "activity", label: run.activity });
              break;
            case "tool_result": {
              const t = tools.find((x) => x.toolUseId === e.toolUseId);
              if (t) {
                t.isError = e.isError;
                t.durationMs = Date.now() - t.startedAt;
              }
              break;
            }
            case "tool_denied": {
              const existing = e.toolUseId ? tools.find((x) => x.toolUseId === e.toolUseId) : undefined;
              if (existing) {
                if (!existing.allowed) break; // already recorded (canUseTool + result.permission_denials)
                existing.allowed = false;
              } else tools.push({ toolUseId: e.toolUseId ?? null, toolName: e.name, arguments: e.input, allowed: false, isError: null, startedAt: Date.now(), durationMs: 0 });
              void logEvent(db, {
                userId: input.user.id,
                type: "chat_tool_denied",
                payload: { conversationId: run.conversationId, messageId: run.messageId, tool: e.name, arguments: e.input },
                ...input.meta,
              }).catch(() => {});
              break;
            }
          }
        },
      });

    result = await attempt(input.question, input.claudeSessionId);

    // The stored Claude session could not be resumed (for example its transcript is gone): replay the history instead.
    if (!result.ok && input.claudeSessionId && !result.producedOutput && !run.abort.signal.aborted && result.errorCode !== "usage_limit" && result.errorCode !== "kb_unavailable") {
      const resumeBroken = looksLikeResumeFailure(result.errorDetail ?? "") || result.errorCode === "error";
      if (resumeBroken) {
        const history = await replayHistory(db, run.conversationId, input.userMessageId, cfg.replayTurns);
        result = await attempt(buildReplayPrompt(history, input.question), null);
      }
    }
  } catch (e) {
    if (!(e instanceof Error && e.name === "AbortError")) console.error("[chat] answer failed", e);
  } finally {
    clearTimeout(timer);
    clearInterval(flushTimer);
    ticket.release();
  }

  // ---- final status
  let status: "ok" | "stopped" | "error" = "error";
  let errorCode: ChatErrorCode | null = null;
  if (run.stopReason === "user") {
    status = "stopped";
  } else if (run.stopReason === "timeout") {
    errorCode = "timeout";
  } else if (result?.ok) {
    status = "ok";
  } else {
    errorCode = result?.errorCode ?? "error";
  }

  run.activity = null;
  if (flushing) await flushing;
  const durationMs = Date.now() - started;
  await db
    .update(chatMessages)
    .set({
      content: run.text,
      status,
      errorCode,
      tokensIn: result?.tokensIn ?? null,
      tokensOut: result?.tokensOut ?? null,
      numTurns: result?.numTurns ?? null,
      model: result?.model ?? null,
      durationMs,
      completedAt: new Date(),
    })
    .where(eq(chatMessages.id, run.messageId));
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, run.conversationId));
  await insertToolCalls(
    db,
    tools.map((t) => ({ messageId: run.messageId, toolUseId: t.toolUseId, toolName: t.toolName, arguments: t.arguments, allowed: t.allowed, isError: t.isError, durationMs: t.durationMs })),
  );
  // Full audit entry for the turn (REQ-AUD-01, REQ-HARN-08).
  await logEvent(db, {
    userId: input.user.id,
    type: "chat_answer",
    payload: {
      conversationId: run.conversationId,
      messageId: run.messageId,
      role: input.role,
      status,
      errorCode,
      errorDetail: result?.errorDetail ?? null,
      tokensIn: result?.tokensIn ?? null,
      tokensOut: result?.tokensOut ?? null,
      numTurns: result?.numTurns ?? null,
      model: result?.model ?? null,
      durationMs,
      toolCalls: tools.map((t) => ({ name: t.toolName, arguments: t.arguments, allowed: t.allowed, isError: t.isError, durationMs: t.durationMs })),
      answer: run.text,
    },
    ...input.meta,
  }).catch((e) => console.error("[chat] audit failed", e));

  run.phase = "done";
  run.final = { type: "done", status, errorCode, text: run.text };
  emit(run, run.final);
  run.listeners.clear();
  // Keep the finished run briefly so a late subscriber still gets the result without a DB round-trip.
  setTimeout(() => registry().runs.delete(run.messageId), 60_000).unref?.();
}
