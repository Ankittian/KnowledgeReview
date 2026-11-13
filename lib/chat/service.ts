import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { query, type DB } from "@/db/client";
import { chatFeedback, chatMessages, chatToolCalls, conversations, users } from "@/db/schema";
import { DEFAULT_ANSWER_ROLE, type AnswerRole } from "./config";
import type { ReplayTurn } from "./prompts";

/**
 * Data access for the chat. Every function that takes a `userId` only ever touches that user's rows: a conversation or
 * message id belonging to someone else behaves exactly like one that does not exist.
 */

export type Conversation = typeof conversations.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;

export interface ConversationListItem {
  id: string;
  title: string;
  roleUsed: AnswerRole;
  updatedAt: Date;
}

export interface MessageView {
  id: number;
  sender: "user" | "assistant";
  content: string;
  status: "ok" | "streaming" | "stopped" | "error";
  errorCode: string | null;
  createdAt: string;
  feedback: { value: "up" | "down"; comment: string | null } | null;
}

/** General users answer in their admin-assigned role. Admins choose per conversation (REQ-ROLE-01, 04). */
export async function getAnswerRole(db: DB, userId: string): Promise<AnswerRole> {
  const [r] = await db.select({ role: users.answerRole }).from(users).where(eq(users.id, userId));
  return r?.role ?? DEFAULT_ANSWER_ROLE;
}

/** Who changed it is recorded by the admin action's `user_answer_role_changed` audit event. */
export async function setAnswerRole(db: DB, userId: string, role: AnswerRole): Promise<void> {
  await db.update(users).set({ answerRole: role }).where(eq(users.id, userId));
}

export async function listConversations(db: DB, userId: string): Promise<ConversationListItem[]> {
  return db
    .select({ id: conversations.id, title: conversations.title, roleUsed: conversations.roleUsed, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(and(eq(conversations.userId, userId), isNull(conversations.deletedAt)))
    .orderBy(desc(conversations.updatedAt))
    .limit(500);
}

export async function getOwnConversation(db: DB, userId: string, id: string): Promise<Conversation | null> {
  if (!isUuid(id)) return null;
  const [c] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId), isNull(conversations.deletedAt)));
  return c ?? null;
}

export async function createConversation(db: DB, userId: string, title: string, role: AnswerRole): Promise<Conversation> {
  const [c] = await db.insert(conversations).values({ userId, title, roleUsed: role }).returning();
  return c;
}

export async function renameConversation(db: DB, userId: string, id: string, title: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const r = await db
    .update(conversations)
    .set({ title })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId), isNull(conversations.deletedAt)))
    .returning({ id: conversations.id });
  return r.length > 0;
}

/** Soft delete: hidden from the user, kept for admins and the audit trail (REQ-CHAT-04). */
export async function softDeleteConversation(db: DB, userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const r = await db
    .update(conversations)
    .set({ deletedAt: new Date() })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId), isNull(conversations.deletedAt)))
    .returning({ id: conversations.id });
  return r.length > 0;
}

/** Messages of a conversation with the viewer's feedback. Caller must have checked access to the conversation. */
export async function loadMessages(db: DB, conversationId: string, viewerId: string): Promise<MessageView[]> {
  const rows = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversationId)).orderBy(asc(chatMessages.id));
  const ids = rows.filter((r) => r.sender === "assistant").map((r) => r.id);
  const fb = ids.length
    ? await db.select().from(chatFeedback).where(and(inArray(chatFeedback.messageId, ids), eq(chatFeedback.userId, viewerId)))
    : [];
  const byMsg = new Map(fb.map((f) => [f.messageId, f]));
  return rows.map((r) => ({
    id: r.id,
    sender: r.sender,
    content: r.content,
    status: r.status,
    errorCode: r.errorCode,
    createdAt: r.createdAt.toISOString(),
    feedback: byMsg.has(r.id) ? { value: byMsg.get(r.id)!.value, comment: byMsg.get(r.id)!.comment } : null,
  }));
}

/** A message plus its conversation, only if the conversation belongs to `userId` and is not deleted. */
export async function getOwnMessage(db: DB, userId: string, messageId: number) {
  const [r] = await db
    .select({ message: chatMessages, conversation: conversations })
    .from(chatMessages)
    .innerJoin(conversations, eq(conversations.id, chatMessages.conversationId))
    .where(and(eq(chatMessages.id, messageId), eq(conversations.userId, userId), isNull(conversations.deletedAt)));
  return r ?? null;
}

export async function insertMessage(db: DB, v: typeof chatMessages.$inferInsert): Promise<ChatMessage> {
  const [m] = await db.insert(chatMessages).values(v).returning();
  return m;
}

/** Questions asked today (server day) by this user, for the daily limit (REQ-HARN-06). */
export async function questionsToday(db: DB, userId: string): Promise<number> {
  const [{ n }] = await query<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM chat_messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.user_id = ${userId} AND m.sender = 'user' AND m.created_at >= date_trunc('day', now())`,
  );
  return n;
}

/** Earlier completed turns, oldest first, for replay when the Claude session cannot be resumed. */
export async function replayHistory(db: DB, conversationId: string, beforeMessageId: number, maxTurns: number): Promise<ReplayTurn[]> {
  const rows = await db
    .select({ id: chatMessages.id, sender: chatMessages.sender, content: chatMessages.content, status: chatMessages.status })
    .from(chatMessages)
    .where(and(eq(chatMessages.conversationId, conversationId), sql`${chatMessages.id} < ${beforeMessageId}`))
    .orderBy(desc(chatMessages.id))
    .limit(maxTurns * 2 + 2);
  return rows
    .reverse()
    .filter((r) => r.content.trim() && (r.sender === "user" || r.status === "ok" || r.status === "stopped"))
    .map((r) => ({ sender: r.sender, content: r.content.slice(0, 6000) }));
}

export async function saveFeedback(db: DB, userId: string, messageId: number, value: "up" | "down", comment: string | null) {
  await db
    .insert(chatFeedback)
    .values({ messageId, userId, value, comment })
    .onConflictDoUpdate({ target: [chatFeedback.messageId, chatFeedback.userId], set: { value, comment, updatedAt: new Date() } });
}

export async function insertToolCalls(db: DB, rows: (typeof chatToolCalls.$inferInsert)[]) {
  if (rows.length) await db.insert(chatToolCalls).values(rows);
}

// ---------------------------------------------------------------- admin: all chats (REQ-CHAT-06)

export interface AdminChatFilter {
  userId?: string;
  role?: AnswerRole;
  from?: string; // yyyy-mm-dd
  to?: string;
  feedback?: "up" | "down" | "any" | "none";
  includeDeleted?: boolean;
}

export interface AdminChatRow {
  id: string;
  title: string;
  roleUsed: AnswerRole;
  username: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  questions: number;
  ups: number;
  downs: number;
  errors: number;
  tokens: number;
}

export async function adminListChats(db: DB, f: AdminChatFilter): Promise<AdminChatRow[]> {
  const conds = [sql`true`];
  if (f.userId && isUuid(f.userId)) conds.push(sql`c.user_id = ${f.userId}`);
  if (f.role) conds.push(sql`c.role_used = ${f.role}`);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(sql`c.updated_at >= ${f.from}::date`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(sql`c.created_at < ${f.to}::date + 1`);
  if (!f.includeDeleted) conds.push(sql`c.deleted_at IS NULL`);
  const fbFilter =
    f.feedback === "up" ? sql`WHERE ups > 0`
    : f.feedback === "down" ? sql`WHERE downs > 0`
    : f.feedback === "any" ? sql`WHERE ups + downs > 0`
    : f.feedback === "none" ? sql`WHERE ups + downs = 0`
    : sql``;
  return query<AdminChatRow>(
    db,
    sql`WITH m AS (
          SELECT conversation_id,
                 count(*) FILTER (WHERE sender = 'user')::int AS questions,
                 count(*) FILTER (WHERE status = 'error')::int AS errors,
                 coalesce(sum(coalesce(tokens_in, 0) + coalesce(tokens_out, 0)), 0)::int AS tokens
          FROM chat_messages GROUP BY conversation_id
        ), fb AS (
          SELECT cm.conversation_id,
                 count(*) FILTER (WHERE f.value = 'up')::int AS ups,
                 count(*) FILTER (WHERE f.value = 'down')::int AS downs
          FROM chat_feedback f JOIN chat_messages cm ON cm.id = f.message_id GROUP BY cm.conversation_id
        ), rows AS (
          SELECT c.id, c.title, c.role_used AS "roleUsed", u.username, u.display_name AS "displayName",
                 c.created_at AS "createdAt", c.updated_at AS "updatedAt", c.deleted_at AS "deletedAt",
                 coalesce(m.questions, 0) AS questions, coalesce(fb.ups, 0) AS ups, coalesce(fb.downs, 0) AS downs,
                 coalesce(m.errors, 0) AS errors, coalesce(m.tokens, 0) AS tokens
          FROM conversations c
          JOIN users u ON u.id = c.user_id
          LEFT JOIN m ON m.conversation_id = c.id
          LEFT JOIN fb ON fb.conversation_id = c.id
          WHERE ${sql.join(conds, sql` AND `)}
        )
        SELECT * FROM rows ${fbFilter} ORDER BY "updatedAt" DESC LIMIT 300`,
  );
}

/** Full transcript for the admin detail view: any conversation, deleted ones included. */
export async function adminLoadConversation(db: DB, id: string) {
  if (!isUuid(id)) return null;
  const [c] = await db
    .select({ conversation: conversations, username: users.username, displayName: users.displayName })
    .from(conversations)
    .innerJoin(users, eq(users.id, conversations.userId))
    .where(eq(conversations.id, id));
  if (!c) return null;
  const msgs = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, id)).orderBy(asc(chatMessages.id));
  const ids = msgs.map((m) => m.id);
  const tools = ids.length ? await db.select().from(chatToolCalls).where(inArray(chatToolCalls.messageId, ids)).orderBy(asc(chatToolCalls.id)) : [];
  const fb = ids.length
    ? await db
        .select({ messageId: chatFeedback.messageId, value: chatFeedback.value, comment: chatFeedback.comment, username: users.username })
        .from(chatFeedback)
        .innerJoin(users, eq(users.id, chatFeedback.userId))
        .where(inArray(chatFeedback.messageId, ids))
    : [];
  return { ...c, messages: msgs, tools, feedback: fb };
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
