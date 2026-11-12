import type { DB } from "@/db/client";
import { auditLog, interactionEvents } from "@/db/schema";

export interface EventInput {
  userId?: string | null;
  cardId?: string | null;
  type: string;
  payload?: Record<string, unknown>;
  sessionId?: string | null;
  userAgent?: string | null;
  ip?: string | null;
  clientEventId?: string | null;
  occurredAt?: Date | null;
}

const row = (e: EventInput) => ({
  userId: e.userId ?? null,
  cardId: e.cardId ?? null,
  eventType: e.type,
  payload: e.payload ?? {},
  sessionId: e.sessionId ?? null,
  userAgent: e.userAgent?.slice(0, 400) ?? null,
  ip: e.ip ?? null,
  clientEventId: e.clientEventId ?? null,
  occurredAt: e.occurredAt ?? null,
});

/** Append to the interaction log. Duplicate client_event_ids (retries) are ignored. */
export async function logEvents(db: DB, events: EventInput[]): Promise<number> {
  if (!events.length) return 0;
  const inserted = await db.insert(interactionEvents).values(events.map(row)).onConflictDoNothing().returning({ id: interactionEvents.id });
  return inserted.length;
}

export const logEvent = (db: DB, e: EventInput) => logEvents(db, [e]);

export async function audit(db: DB, actorId: string | null, action: string, targetType: string, targetId: string, details: Record<string, unknown> = {}) {
  await db.insert(auditLog).values({ actorId, action, targetType, targetId, details });
}
