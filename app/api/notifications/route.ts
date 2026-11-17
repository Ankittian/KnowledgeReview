import { getDb } from "@/db/client";
import { getSession } from "@/lib/auth/session";
import { loadNotifications } from "@/lib/cards/generate/jobs";
import { json } from "@/lib/request";

/** The signed-in user's latest notifications and the unread count. Polled by the bell in the top bar. */
export async function GET() {
  const session = await getSession();
  if (!session) return json({ error: "Not signed in" }, 401);
  const { items, unread } = await loadNotifications(await getDb(), session.user.id);
  return json({
    unread,
    items: items.map((n) => ({ id: n.id, kind: n.kind, jobId: n.jobId, message: n.message, read: n.readAt !== null, createdAt: n.createdAt.toISOString() })),
  });
}
