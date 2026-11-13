import { getDb } from "@/db/client";
import { logEvent } from "@/lib/events";
import { json } from "@/lib/request";
import { chatCaller, parseId } from "@/lib/chat/http";
import { stopAnswer } from "@/lib/chat/live";
import { getOwnMessage } from "@/lib/chat/service";

/** Stop button (REQ-CHAT-08). The run saves its partial text with status "stopped". */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await chatCaller(req, { mutating: true });
  if (caller instanceof Response) return caller;
  const id = parseId((await ctx.params).id);
  if (id == null) return json({ error: "Not found" }, 404);
  const db = await getDb();
  const own = await getOwnMessage(db, caller.session.user.id, id);
  if (!own || own.message.sender !== "assistant") return json({ error: "Not found" }, 404);
  const stopped = stopAnswer(id);
  if (stopped) {
    await logEvent(db, { userId: caller.session.user.id, type: "chat_stopped", payload: { conversationId: own.conversation.id, messageId: id }, ...caller.meta });
  }
  return json({ ok: true, stopped });
}
