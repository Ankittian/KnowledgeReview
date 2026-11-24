import { getDb } from "@/db/client";
import type { Session } from "@/lib/auth/session";
import { canUseKgNew, getAnswerRole, getOwnConversation, kbReadOnly, listConversations, loadMessages } from "@/lib/chat/service";
import type { ConvItem, Msg } from "@/components/chat/ChatApp";

/** Everything the chat page needs, always scoped to the signed-in user's own conversations. */
export async function loadChatPage(session: Session, conversationId: string | null) {
  const db = await getDb();
  const userId = session.user.id;
  const isAdmin = session.user.role === "admin";
  const [list, myRole, conv, kgNewAllowed] = await Promise.all([
    listConversations(db, userId),
    getAnswerRole(db, userId),
    conversationId ? getOwnConversation(db, userId, conversationId) : Promise.resolve(null),
    canUseKgNew(db, userId, isAdmin),
  ]);
  const readOnly = conv ? await kbReadOnly(db, conv, isAdmin) : null;
  const messages: Msg[] = conv ? (await loadMessages(db, conv.id, userId)).map(({ createdAt: _c, ...m }) => m) : [];
  const conversations: ConvItem[] = list.map((c) => ({ ...c, updatedAt: c.updatedAt.toISOString() }));
  return {
    conversations,
    active: conv ? { id: conv.id, title: conv.title, roleUsed: conv.roleUsed, kbSource: conv.kbSource, readOnly } : null,
    messages,
    isAdmin,
    myRole,
    canUseKgNew: kgNewAllowed,
    found: !conversationId || !!conv,
  };
}
