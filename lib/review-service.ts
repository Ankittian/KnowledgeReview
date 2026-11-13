import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { DB } from "@/db/client";
import { cardFeedback, cardReviews, cards, cardVersions, dailyDecks, deckCards, reviewSchedule, roles, users } from "@/db/schema";
import type { Role } from "@/lib/auth/types";
import { audiencesFor } from "./cards/audience";
import { READ_LOCK_ENABLED, countWords, minReadSeconds } from "./cards/spec";
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

/**
 * Records one flashcard answer. The client only sends the opaque version id; the card is resolved server-side
 * (its KB item and source field are reached through the version, so they are never copied onto the answer).
 */
export async function recordReview(
  db: DB,
  userId: string,
  input: ReviewInput,
  meta: Meta,
  today: string,
  opts: { enforceReadTime?: boolean } = {},
): Promise<Result> {
  const enforceReadTime = opts.enforceReadTime ?? READ_LOCK_ENABLED;
  const [who] = await db.select({ role: roles.name }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, userId));
  const allowed = audiencesFor((who?.role ?? "employee") as Role);
  const [ver] = await db
    .select({ versionId: cardVersions.id, cardId: cardVersions.cardId, back: cardVersions.back, audience: cards.audience })
    .from(cardVersions)
    .innerJoin(cards, eq(cards.id, cardVersions.cardId))
    .where(eq(cardVersions.id, input.versionId));
  // a card outside the user's set (or a legacy card with no audience) does not exist for them, even with a valid id
  if (!ver || !ver.audience || !allowed.includes(ver.audience)) return { ok: false, status: 404, error: "Unknown card." };

  // The answer must belong to one of the user's decks from today (or yesterday, for decks finished after midnight).
  if (input.deckDate !== today && input.deckDate !== addDays(today, -1)) return { ok: false, status: 409, error: "This deck has expired." };
  const [deck] = await db
    .select({ id: dailyDecks.id })
    .from(dailyDecks)
    .innerJoin(deckCards, eq(deckCards.deckId, dailyDecks.id))
    .where(
      and(
        eq(dailyDecks.userId, userId),
        eq(dailyDecks.deckDate, input.deckDate),
        eq(deckCards.cardId, ver.cardId),
        input.deckId ? eq(dailyDecks.id, input.deckId) : undefined,
      ),
    )
    .orderBy(desc(dailyDecks.id))
    .limit(1);
  if (!deck) return { ok: false, status: 409, error: "Card is not in your deck." };

  // hard daily limit (all sign-ins together)
  const dailyLimit = await getDailyCardLimit(db);
  const [{ n: answeredBefore }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cardReviews)
    .innerJoin(dailyDecks, eq(dailyDecks.id, cardReviews.deckId))
    .where(and(eq(cardReviews.userId, userId), eq(dailyDecks.deckDate, input.deckDate)));
  const [already] = await db
    .select({ id: cardReviews.id })
    .from(cardReviews)
    .innerJoin(dailyDecks, eq(dailyDecks.id, cardReviews.deckId))
    .innerJoin(cardVersions, eq(cardVersions.id, cardReviews.cardVersionId))
    .where(and(eq(cardReviews.userId, userId), eq(dailyDecks.deckDate, input.deckDate), eq(cardVersions.cardId, ver.cardId)));
  if (already) return { ok: true, duplicate: true, deckCompleted: false };
  if (answeredBefore >= dailyLimit) return { ok: false, status: 409, error: "Daily card limit reached." };

  const shownAt = toDate(input.shownAt);
  const flippedAt = toDate(input.flippedAt);
  const answeredAt = toDate(input.answeredAt) ?? new Date();

  // Read-time lock: an answer is only valid after the card's designated read time (words / 5 s, min 4 s) of attended time.
  // The browser can only report time to subtract (hidden/idle), never to add: attended time is capped by the wall clock between shown and answered.
  const minReadMs = minReadSeconds(countWords(ver.back)) * 1000;
  const wallMs = shownAt ? answeredAt.getTime() - shownAt.getTime() : 0;
  const attendedMs = input.activeMs == null ? wallMs : Math.min(input.activeMs, wallMs);
  if (enforceReadTime) {
    if (answeredAt.getTime() > Date.now() + 60_000) return { ok: false, status: 400, error: "Invalid answer time." };
    if (attendedMs < minReadMs - 750) {
      const wait = Math.max(1, Math.ceil((minReadMs - attendedMs) / 1000));
      return { ok: false, status: 409, error: `Read the card first: ${wait} more second${wait === 1 ? "" : "s"} before you can answer.` };
    }
  }

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(cardReviews)
      .values({
        userId,
        cardVersionId: ver.versionId,
        deckId: deck.id,
        knewIt: input.knewIt,
        verdict: input.verdict,
        shownAt,
        flippedAt,
        answeredAt,
        clientEventId: input.clientEventId,
      })
      .onConflictDoNothing()
      .returning({ id: cardReviews.id });
    if (!inserted.length) return { ok: true as const, duplicate: true, deckCompleted: false };
    const reviewId = inserted[0].id;

    // spaced repetition
    const [prev] = await tx
      .select()
      .from(reviewSchedule)
      .where(and(eq(reviewSchedule.userId, userId), eq(reviewSchedule.cardId, ver.cardId)));
    const next = nextSrs(prev ?? null, input.knewIt, input.deckDate);
    await tx
      .insert(reviewSchedule)
      .values({ userId, cardId: ver.cardId, ...next })
      .onConflictDoUpdate({
        target: [reviewSchedule.userId, reviewSchedule.cardId],
        set: { box: next.box, dueDate: next.dueDate, reps: next.reps, lapses: next.lapses },
      });

    const events: EventInput[] = [
      {
        userId,
        cardId: ver.cardId,
        type: "review_submitted",
        payload: { review_id: reviewId, version_id: ver.versionId, knew_it: input.knewIt, verdict: input.verdict, deck_date: input.deckDate, deck_id: deck.id, active_ms: attendedMs, wall_ms: wallMs, min_read_ms: minReadMs },
        clientEventId: `srv:review:${input.clientEventId}`,
        occurredAt: answeredAt,
        ...meta,
      },
    ];

    if (input.verdict === "needs_improvement" && input.feedback) {
      const suggested = input.feedback.suggestedText?.trim() || null;
      const [fb] = await tx
        .insert(cardFeedback)
        .values({
          reviewId,
          userId,
          cardVersionId: ver.versionId,
          category: input.feedback.category,
          suggestedText: suggested,
          comment: input.feedback.comment?.trim() || null,
        })
        .returning({ id: cardFeedback.id });
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
      .from(deckCards)
      .innerJoin(cards, eq(cards.id, deckCards.cardId))
      .where(
        and(
          eq(deckCards.deckId, deck.id),
          eq(cards.status, "active"),
          sql`NOT EXISTS (SELECT 1 FROM card_reviews r JOIN daily_decks d ON d.id = r.deck_id JOIN card_versions v ON v.id = r.card_version_id
                          WHERE r.user_id = ${userId} AND d.deck_date = ${input.deckDate}::date AND v.card_id = ${cards.id})`,
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
