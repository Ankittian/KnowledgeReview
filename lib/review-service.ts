import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { DB } from "@/db/client";
import { cards, cardVersions, dailyDecks, feedback, reviews, srsState } from "@/db/schema";
import { addDays } from "./dates";
import { logEvents, type EventInput } from "./events";
import { getDailyCardLimit } from "./settings";
import { nextSrs } from "./srs";
import type { eventsSchema, reviewSchema } from "./validation";

export type ReviewInput = z.infer<typeof reviewSchema>;
export type EventsInput = z.infer<typeof eventsSchema>;

export interface Meta {
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

type Result = { ok: true; duplicate: boolean; deckCompleted: boolean } | { ok: false; status: number; error: string };

const toDate = (s?: string | null) => (s ? new Date(s) : null);
const ms = (a: Date | null, b: Date | null) => (a && b ? Math.max(0, Math.min(2_147_000_000, b.getTime() - a.getTime())) : null);

/**
 * Records one flashcard answer. The client only sends the opaque version id; the card, YAML entity and
 * source field are resolved and stamped here, server-side.
 */
export async function recordReview(db: DB, userId: string, input: ReviewInput, meta: Meta, today: string): Promise<Result> {
  const [ver] = await db
    .select({
      versionId: cardVersions.id,
      cardId: cardVersions.cardId,
      sourceText: cardVersions.sourceText,
      entityId: cards.entityId,
      sourceField: cards.sourceField,
    })
    .from(cardVersions)
    .innerJoin(cards, eq(cards.id, cardVersions.cardId))
    .where(eq(cardVersions.id, input.versionId));
  if (!ver) return { ok: false, status: 404, error: "Unknown card." };

  // The answer must belong to one of the user's decks from today (or yesterday, for decks finished after midnight).
  if (input.deckDate !== today && input.deckDate !== addDays(today, -1)) return { ok: false, status: 409, error: "This deck has expired." };
  const decks = await db
    .select({ id: dailyDecks.id, cardIds: dailyDecks.cardIds })
    .from(dailyDecks)
    .where(and(eq(dailyDecks.userId, userId), eq(dailyDecks.deckDate, input.deckDate)))
    .orderBy(desc(dailyDecks.id));
  const deck = decks.find((d) => (input.deckId ? d.id === input.deckId : true) && d.cardIds.includes(ver.cardId));
  if (!deck) return { ok: false, status: 409, error: "Card is not in your deck." };

  // hard daily limit (all sign-ins together)
  const dailyLimit = await getDailyCardLimit(db);
  const [{ n: answeredBefore }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reviews)
    .where(and(eq(reviews.userId, userId), eq(reviews.deckDate, input.deckDate)));
  const [already] = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(and(eq(reviews.userId, userId), eq(reviews.deckDate, input.deckDate), eq(reviews.cardId, ver.cardId)));
  if (already) return { ok: true, duplicate: true, deckCompleted: false };
  if (answeredBefore >= dailyLimit) return { ok: false, status: 409, error: "Daily card limit reached." };

  const shownAt = toDate(input.shownAt);
  const flippedAt = toDate(input.flippedAt);
  const answeredAt = toDate(input.answeredAt) ?? new Date();

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(reviews)
      .values({
        userId,
        cardId: ver.cardId,
        cardVersionId: ver.versionId,
        entityId: ver.entityId,
        sourceField: ver.sourceField,
        deckDate: input.deckDate,
        deckId: deck.id,
        knewIt: input.knewIt,
        verdict: input.verdict,
        shownAt,
        flippedAt,
        answeredAt,
        timeToFlipMs: ms(shownAt, flippedAt),
        timeToAnswerMs: ms(shownAt, answeredAt),
        device: input.device ?? null,
        clientEventId: input.clientEventId,
      })
      .onConflictDoNothing()
      .returning({ id: reviews.id });
    if (!inserted.length) return { ok: true as const, duplicate: true, deckCompleted: false };
    const reviewId = inserted[0].id;

    // spaced repetition
    const [prev] = await tx
      .select()
      .from(srsState)
      .where(and(eq(srsState.userId, userId), eq(srsState.cardId, ver.cardId)));
    const next = nextSrs(prev ?? null, input.knewIt, input.deckDate);
    await tx
      .insert(srsState)
      .values({ userId, cardId: ver.cardId, ...next, lastReviewedAt: answeredAt })
      .onConflictDoUpdate({
        target: [srsState.userId, srsState.cardId],
        set: { box: next.box, dueDate: next.dueDate, reps: next.reps, lapses: next.lapses, lastReviewedAt: answeredAt },
      });

    const events: EventInput[] = [
      {
        userId,
        cardId: ver.cardId,
        type: "review_submitted",
        payload: { review_id: reviewId, version_id: ver.versionId, knew_it: input.knewIt, verdict: input.verdict, deck_date: input.deckDate, deck_id: deck.id },
        clientEventId: `srv:review:${input.clientEventId}`,
        occurredAt: answeredAt,
        ...meta,
      },
    ];

    if (input.verdict === "needs_improvement" && input.feedback) {
      const suggested = input.feedback.suggestedText?.trim() || null;
      const [fb] = await tx
        .insert(feedback)
        .values({
          reviewId,
          userId,
          cardId: ver.cardId,
          cardVersionId: ver.versionId,
          entityId: ver.entityId,
          sourceField: ver.sourceField,
          category: input.feedback.category,
          currentText: ver.sourceText,
          suggestedText: suggested,
          comment: input.feedback.comment?.trim() || null,
        })
        .returning({ id: feedback.id });
      events.push({
        userId,
        cardId: ver.cardId,
        type: "feedback_submitted",
        payload: { feedback_id: fb.id, review_id: reviewId, category: input.feedback.category, has_suggestion: !!suggested },
        clientEventId: `srv:feedback:${input.clientEventId}`,
        occurredAt: answeredAt,
        ...meta,
      });
    }

    // deck completion: every active card of this deck answered, or the daily limit reached
    const answeredToday = answeredBefore + 1;
    const open = await tx
      .select({ id: cards.id })
      .from(cards)
      .where(
        and(
          inArray(cards.id, deck.cardIds),
          eq(cards.status, "active"),
          sql`NOT EXISTS (SELECT 1 FROM reviews r WHERE r.user_id = ${userId} AND r.deck_date = ${input.deckDate}::date AND r.card_id = ${cards.id})`,
        ),
      );
    const limitReached = answeredToday >= dailyLimit;
    let deckCompleted = false;
    if (open.length === 0 || limitReached) {
      const done = await tx
        .update(dailyDecks)
        .set({ completedAt: new Date() })
        .where(and(eq(dailyDecks.id, deck.id), sql`${dailyDecks.completedAt} IS NULL`))
        .returning({ id: dailyDecks.id });
      deckCompleted = done.length > 0;
      if (deckCompleted)
        events.push({
          userId,
          type: "deck_completed",
          payload: { deck_id: deck.id, deck_date: input.deckDate, answered_today: answeredToday, daily_limit: dailyLimit },
          clientEventId: `srv:deck:${deck.id}`,
          ...meta,
        });
    }
    if (limitReached)
      events.push({
        userId,
        type: "daily_limit_reached",
        payload: { deck_date: input.deckDate, daily_limit: dailyLimit },
        clientEventId: `srv:limit:${userId}:${input.deckDate}`,
        ...meta,
      });
    await logEvents(tx as unknown as DB, events);
    return { ok: true as const, duplicate: false, deckCompleted };
  });
}

/** Client-side interaction events (shown, flipped, ...). Version ids are mapped to card ids here. */
export async function recordClientEvents(db: DB, userId: string, input: EventsInput, meta: Meta): Promise<number> {
  const vids = [...new Set(input.events.map((e) => e.versionId).filter((v): v is number => !!v))];
  const map = new Map<number, string>();
  if (vids.length) {
    const rows = await db.select({ id: cardVersions.id, cardId: cardVersions.cardId }).from(cardVersions).where(inArray(cardVersions.id, vids));
    rows.forEach((r) => map.set(r.id, r.cardId));
  }
  return logEvents(
    db,
    input.events.map((e) => ({
      userId,
      cardId: e.versionId ? (map.get(e.versionId) ?? null) : null,
      type: e.type,
      payload: { ...(e.payload ?? {}), ...(e.versionId ? { version_id: e.versionId } : {}) },
      clientEventId: e.clientEventId,
      occurredAt: toDate(e.at),
      ...meta,
    })),
  );
}
