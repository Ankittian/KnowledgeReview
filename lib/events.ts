import type { DB } from "@/db/client";
import { activityLog } from "@/db/schema";

export interface EventInput {
  userId?: string | null;
  cardId?: string | null;
  type: string;
  payload?: Record<string, unknown>;
  sessionId?: string | null;
  ip?: string | null;
  clientEventId?: string | null;
  /** when it happened on the client (offline queue); stored inside `details.occurred_at` */
  occurredAt?: Date | null;
}

const row = (e: EventInput) => ({
  userId: e.userId ?? null,
  action: e.type,
  targetType: e.cardId ? "card" : null,
  targetId: e.cardId ?? null,
  details: { ...(e.payload ?? {}), ...(e.occurredAt ? { occurred_at: e.occurredAt.toISOString() } : {}) },
  sessionId: e.sessionId ?? null,
  ip: e.ip ?? null,
  clientEventId: e.clientEventId ?? null,
});

/** Append to the activity log. Duplicate client_event_ids (retries) are ignored. */
export async function logEvents(db: DB, events: EventInput[]): Promise<number> {
  if (!events.length) return 0;
  const inserted = await db.insert(activityLog).values(events.map(row)).onConflictDoNothing().returning({ id: activityLog.id });
  return inserted.length;
}

export const logEvent = (db: DB, e: EventInput) => logEvents(db, [e]);

export async function audit(db: DB, actorId: string | null, action: string, targetType: string, targetId: string, details: Record<string, unknown> = {}) {
  await db.insert(activityLog).values({ userId: actorId, action, targetType, targetId, details });
}
