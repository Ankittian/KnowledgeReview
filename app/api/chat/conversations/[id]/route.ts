import { z } from "zod";
import { getDb } from "@/db/client";
import { logEvent } from "@/lib/events";
import { json } from "@/lib/request";
import { chatCaller, readJson } from "@/lib/chat/http";
import { stopConversation } from "@/lib/chat/live";
import { getOwnConversation, loadMessages, renameConversation, softDeleteConversation } from "@/lib/chat/service";

type Ctx = { params: Promise<{ id: string }> };

/** One of the caller's own conversations with its messages. */
export async function GET(req: Request, ctx: Ctx) {
  const caller = await chatCaller(req, { mutating: false });
  if (caller instanceof Response) return caller;
  const db = await getDb();
  const conv = await getOwnConversation(db, caller.session.user.id, (await ctx.params).id);
  if (!conv) return json({ error: "Not found" }, 404);
  return json({
    conversation: { id: conv.id, title: conv.title, roleUsed: conv.roleUsed },
    messages: await loadMessages(db, conv.id, caller.session.user.id),
  });
}

const renameSchema = z.object({ title: z.string().trim().min(1, "Enter a title.").max(120) });

export async function PATCH(req: Request, ctx: Ctx) {
  const caller = await chatCaller(req, { mutating: true });
  if (caller instanceof Response) return caller;
  const parsed = renameSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid title" }, 400);
  const db = await getDb();
  const id = (await ctx.params).id;
  if (!(await renameConversation(db, caller.session.user.id, id, parsed.data.title))) return json({ error: "Not found" }, 404);
  await logEvent(db, { userId: caller.session.user.id, type: "chat_renamed", payload: { conversationId: id, title: parsed.data.title }, ...caller.meta });
  return json({ ok: true });
}

/** Soft delete (REQ-CHAT-04): hidden from the user, kept for admins and the audit trail. */
export async function DELETE(req: Request, ctx: Ctx) {
  const caller = await chatCaller(req, { mutating: true });
  if (caller instanceof Response) return caller;
  const db = await getDb();
  const id = (await ctx.params).id;
  const conv = await getOwnConversation(db, caller.session.user.id, id);
  if (!conv || !(await softDeleteConversation(db, caller.session.user.id, id))) return json({ error: "Not found" }, 404);
  stopConversation(id);
  await logEvent(db, { userId: caller.session.user.id, type: "chat_deleted", payload: { conversationId: id, title: conv.title }, ...caller.meta });
  return json({ ok: true });
}

