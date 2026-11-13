import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { conversations } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { json } from "@/lib/request";
import { ANSWER_ROLES, chatConfig } from "@/lib/chat/config";
import { chatCaller, readJson, type ChatCaller } from "@/lib/chat/http";
import { hasActiveRunForConversation, releaseUser, reserveUser, startAnswer } from "@/lib/chat/live";
import { titleFrom } from "@/lib/chat/prompts";
import { createConversation, getAnswerRole, getOwnConversation, insertMessage, questionsToday } from "@/lib/chat/service";

const bodySchema = z.object({
  conversationId: z.uuid().optional().nullable(),
  /** Admins only, and only when starting a new conversation (REQ-CHAT-05). */
  role: z.enum(ANSWER_ROLES).optional().nullable(),
  text: z.string(),
});

/** Ask a question: creates the conversation if needed, saves the question and starts the answer. */
export async function POST(req: Request) {
  const caller = await chatCaller(req, { mutating: true });
  if (caller instanceof Response) return caller;
  const cfg = chatConfig();
  if (!cfg.enabled) return json({ error: "The assistant is switched off." }, 503);

  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  const text = parsed.data.text.trim();
  if (!text) return json({ error: "Type a question first." }, 400);
  if (text.length > cfg.maxQuestionChars) return json({ error: `Questions can be at most ${cfg.maxQuestionChars} characters.` }, 400);

  const db = await getDb();
  const { user } = caller.session;

  // One answer at a time per user keeps the shared queue fair.
  if (!reserveUser(user.id)) return json({ error: "Please wait for your current answer to finish, or stop it." }, 409);
  try {
    return await send(db, caller, parsed.data, text);
  } finally {
    releaseUser(user.id);
  }
}

async function send(db: Awaited<ReturnType<typeof getDb>>, caller: ChatCaller, data: z.infer<typeof bodySchema>, text: string) {
  const cfg = chatConfig();
  const { user } = caller.session;
  const asked = await questionsToday(db, user.id);
  if (asked >= cfg.dailyLimit) {
    return json({ error: `You have reached today's limit of ${cfg.dailyLimit} questions. It resets at midnight.`, code: "daily_limit" }, 429);
  }

  let conv;
  if (data.conversationId) {
    conv = await getOwnConversation(db, user.id, data.conversationId);
    if (!conv) return json({ error: "Conversation not found" }, 404);
    if (hasActiveRunForConversation(conv.id)) return json({ error: "An answer is still being written in this chat." }, 409);
  } else {
    // General users always get their assigned role; admins pick one per conversation (REQ-ROLE-04).
    const role = caller.isAdmin ? (data.role ?? (await getAnswerRole(db, user.id))) : await getAnswerRole(db, user.id);
    conv = await createConversation(db, user.id, titleFrom(text), role);
  }

  const question = await insertMessage(db, { conversationId: conv.id, sender: "user", content: text });
  const answer = await insertMessage(db, { conversationId: conv.id, sender: "assistant", replyToId: question.id, status: "streaming" });
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conv.id));
  await logEvent(db, {
    userId: user.id,
    type: "chat_prompt",
    payload: { conversationId: conv.id, messageId: question.id, role: conv.roleUsed, text, newConversation: !data.conversationId },
    ...caller.meta,
  });

  startAnswer({
    db,
    conversationId: conv.id,
    claudeSessionId: conv.claudeSessionId,
    role: conv.roleUsed,
    user: { id: user.id, username: user.username },
    userMessageId: question.id,
    assistantMessageId: answer.id,
    question: text,
    meta: caller.meta,
  });

  return json({
    conversation: { id: conv.id, title: conv.title, roleUsed: conv.roleUsed },
    userMessage: { id: question.id, createdAt: question.createdAt.toISOString() },
    assistantMessageId: answer.id,
    remainingToday: Math.max(0, cfg.dailyLimit - asked - 1),
  });
}
