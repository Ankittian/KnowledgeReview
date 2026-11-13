import { z } from "zod";
import { getDb } from "@/db/client";
import { logEvent } from "@/lib/events";
import { json } from "@/lib/request";
import { chatCaller, parseId, readJson } from "@/lib/chat/http";
import { getOwnMessage, saveFeedback } from "@/lib/chat/service";

const bodySchema = z.object({
  value: z.enum(["up", "down"]),
  comment: z.string().trim().max(2000).optional().nullable(),
});

/** Thumbs up/down on an answer, optional comment on thumbs down (REQ-CHAT-07). Can be changed later. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await chatCaller(req, { mutating: true });
  if (caller instanceof Response) return caller;
  const id = parseId((await ctx.params).id);
  if (id == null) return json({ error: "Not found" }, 404);
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "Invalid feedback" }, 400);
  const db = await getDb();
  const own = await getOwnMessage(db, caller.session.user.id, id);
  if (!own || own.message.sender !== "assistant" || own.message.status === "streaming") return json({ error: "Not found" }, 404);
  const comment = parsed.data.value === "down" ? parsed.data.comment || null : null;
  await saveFeedback(db, caller.session.user.id, id, parsed.data.value, comment);
  await logEvent(db, {
    userId: caller.session.user.id,
    type: "chat_feedback",
    payload: { conversationId: own.conversation.id, messageId: id, value: parsed.data.value, comment },
    ...caller.meta,
  });
  return json({ ok: true });
}
