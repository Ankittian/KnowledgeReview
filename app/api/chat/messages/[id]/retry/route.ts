import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { chatMessages } from "@/db/schema";
import { logEvent } from "@/lib/events";
import { json } from "@/lib/request";
import { chatConfig } from "@/lib/chat/config";
import { chatCaller, parseId } from "@/lib/chat/http";
import { hasActiveRunForConversation, releaseUser, reserveUser, startAnswer } from "@/lib/chat/live";
import { getOwnMessage, insertMessage, questionsToday } from "@/lib/chat/service";

/**
 * Retry a failed or stopped answer (REQ-CHAT-09): a new answer to the same question. Only the latest answer of a
 * conversation can be retried, so the conversation history stays linear.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await chatCaller(req, { mutating: true });
  if (caller instanceof Response) return caller;
  const id = parseId((await ctx.params).id);
  if (id == null) return json({ error: "Not found" }, 404);
  const db = await getDb();
  const { user } = caller.session;
  const own = await getOwnMessage(db, user.id, id);
  if (!own || own.message.sender !== "assistant" || !own.message.replyToId) return json({ error: "Not found" }, 404);
  if (own.message.status !== "error" && own.message.status !== "stopped") return json({ error: "Only failed or stopped answers can be retried." }, 400);
  const [latest] = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, own.conversation.id))
    .orderBy(desc(chatMessages.id))
    .limit(1);
  if (latest?.id !== id) return json({ error: "Only the latest answer can be retried." }, 400);
  if (hasActiveRunForConversation(own.conversation.id)) return json({ error: "An answer is still being written in this chat." }, 409);

  const cfg = chatConfig();
  if ((await questionsToday(db, user.id)) > cfg.dailyLimit) return json({ error: "You have reached today's question limit." }, 429);
  if (!reserveUser(user.id)) return json({ error: "Please wait for your current answer to finish, or stop it." }, 409);
  try {
    const [question] = await db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.id, own.message.replyToId), eq(chatMessages.conversationId, own.conversation.id)));
    if (!question) return json({ error: "Not found" }, 404);
    const answer = await insertMessage(db, { conversationId: own.conversation.id, sender: "assistant", replyToId: question.id, status: "streaming" });
    await logEvent(db, {
      userId: user.id,
      type: "chat_retry",
      payload: { conversationId: own.conversation.id, failedMessageId: id, messageId: answer.id },
      ...caller.meta,
    });
    startAnswer({
      db,
      conversationId: own.conversation.id,
      claudeSessionId: own.conversation.claudeSessionId,
      role: own.conversation.roleUsed,
      user: { id: user.id, username: user.username },
      userMessageId: question.id,
      assistantMessageId: answer.id,
      question: question.content,
      meta: caller.meta,
    });
    return json({ assistantMessageId: answer.id });
  } finally {
    releaseUser(user.id);
  }
}
