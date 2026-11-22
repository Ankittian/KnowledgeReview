import { getDb } from "@/db/client";
import { getSession } from "@/lib/auth/session";
import { rateLimited } from "@/lib/rate-limit";
import { isSameOrigin, json, requestMeta } from "@/lib/request";
import { recordClientEvents } from "@/lib/review-service";
import { eventsSchema } from "@/lib/validation";

const EVENT_REQUESTS_PER_MINUTE = 60; // the client batches; a normal session sends a handful a minute

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return json({ error: "Bad origin" }, 403);
  const session = await getSession();
  if (!session) return json({ error: "Not signed in" }, 401);
  if (rateLimited(`events:${session.user.id}`, EVENT_REQUESTS_PER_MINUTE, 60_000)) return json({ error: "Too many requests" }, 429);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = eventsSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid events" }, 400);
  const meta = await requestMeta();
  const n = await recordClientEvents(await getDb(), session.user.id, parsed.data, { sessionId: session.sessionId, ...meta });
  return json({ ok: true, inserted: n });
}
