import { getDb } from "@/db/client";
import { getSession } from "@/lib/auth/session";
import { todayStr } from "@/lib/dates";
import { isSameOrigin, json, requestMeta } from "@/lib/request";
import { recordReview } from "@/lib/review-service";
import { reviewSchema } from "@/lib/validation";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return json({ error: "Bad origin" }, 403);
  const session = await getSession();
  if (!session) return json({ error: "Not signed in" }, 401);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid review" }, 400);
  const meta = await requestMeta();
  const db = await getDb();
  const r = await recordReview(db, session.user.id, parsed.data, { sessionId: session.sessionId, ...meta }, todayStr());
  if (!r.ok) return json({ error: r.error }, r.status);
  // deliberately no card / entity / link information in the response
  return json({ ok: true, duplicate: r.duplicate, deckCompleted: r.deckCompleted });
}
