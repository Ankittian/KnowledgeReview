import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { query, type DB } from "@/db/client";
import { cardGenerationJobs, generatedCards, notifications } from "@/db/schema";
import { audienceOf, jobParamsSchema, LIMITS, totalCards, type JobParams, type JobStatus, type NotificationKind } from "./config";
import { templateExists } from "./prompt";
import { checkCard } from "./validate";

export type JobRow = typeof cardGenerationJobs.$inferSelect;
export type GeneratedCardRow = typeof generatedCards.$inferSelect;

/** Server-side limits: constants from config.ts, overridable by environment for a given server. */
export function serverLimits(env: Record<string, string | undefined> = process.env) {
  const n = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
  return { maxCardsPerJob: n(env.CARDS_MAX_PER_JOB, LIMITS.maxCardsPerJob), maxJobsPerDay: n(env.CARDS_MAX_JOBS_PER_DAY, LIMITS.maxJobsPerDay) };
}

export class JobError extends Error {}

// ---------------------------------------------------------------- creating and moving jobs

/** Validates the request, enforces the caps and queues the job. */
export async function createJob(db: DB, userId: string, input: unknown): Promise<JobRow> {
  const parsed = jobParamsSchema.safeParse(input);
  if (!parsed.success) throw new JobError(parsed.error.issues[0]?.message ?? "Invalid request");
  const params = parsed.data;
  if (!templateExists(params.audience)) throw new JobError(`There is no ${params.audience} prompt template yet, so ${params.audience} cards cannot be generated.`);
  const limits = serverLimits();
  const cards = totalCards(params.items);
  if (cards > limits.maxCardsPerJob) throw new JobError(`That is ${cards} cards; one job may ask for at most ${limits.maxCardsPerJob}.`);

  const since = new Date(Date.now() - 24 * 3600_000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cardGenerationJobs)
    .where(and(eq(cardGenerationJobs.requestedBy, userId), gte(cardGenerationJobs.createdAt, since)));
  if (n >= limits.maxJobsPerDay) throw new JobError(`You have started ${n} jobs in the last 24 hours; the limit is ${limits.maxJobsPerDay}.`);

  const [job] = await db
    .insert(cardGenerationJobs)
    .values({ requestedBy: userId, level: params.level, params, model: params.model, progress: { done: 0, total: 0 } })
    .returning();
  return job;
}

/** Takes the oldest queued job for this worker. Safe with more than one worker: each job is claimed once. */
export async function claimNextJob(db: DB): Promise<JobRow | null> {
  const rows = await query<{ id: number }>(
    db,
    sql`UPDATE card_generation_jobs SET status = 'generating', started_at = now(), error = NULL
        WHERE id = (SELECT id FROM card_generation_jobs WHERE status = 'queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id`,
  );
  return rows[0] ? (await getJob(db, rows[0].id)) ?? null : null;
}

/**
 * A job left in 'generating' by a worker that died goes back to the queue (cards are only stored when a job finishes).
 * Only jobs that started more than `staleMinutes` ago: another worker may be running a younger one right now.
 */
export async function requeueInterrupted(db: DB, staleMinutes = 45): Promise<number> {
  const rows = await query<{ id: number }>(
    db,
    sql`UPDATE card_generation_jobs SET status = 'queued' WHERE status = 'generating' AND started_at < now() - make_interval(mins => ${staleMinutes}) RETURNING id`,
  );
  return rows.length;
}

export const getJob = async (db: DB, id: number): Promise<JobRow | undefined> => (await db.select().from(cardGenerationJobs).where(eq(cardGenerationJobs.id, id)))[0];

export async function listJobs(db: DB, limit = 50): Promise<JobRow[]> {
  return db.select().from(cardGenerationJobs).orderBy(desc(cardGenerationJobs.id)).limit(limit);
}

export const setProgress = (db: DB, id: number, done: number, total: number) =>
  db.update(cardGenerationJobs).set({ progress: { done, total } }).where(eq(cardGenerationJobs.id, id));

export async function isCancelRequested(db: DB, id: number): Promise<boolean> {
  const j = await getJob(db, id);
  return !j || j.cancelRequested || j.status === "cancelled";
}

/** Queued: cancelled at once. Generating: the worker stops after the current batch. */
export async function cancelJob(db: DB, id: number): Promise<"cancelled" | "stopping" | "not_cancellable"> {
  const done = await query<{ id: number }>(
    db,
    sql`UPDATE card_generation_jobs SET status = 'cancelled', finished_at = now() WHERE id = ${id} AND status = 'queued' RETURNING id`,
  );
  if (done.length) return "cancelled";
  const running = await query<{ id: number }>(db, sql`UPDATE card_generation_jobs SET cancel_requested = true WHERE id = ${id} AND status = 'generating' RETURNING id`);
  return running.length ? "stopping" : "not_cancellable";
}

/** A failed or cancelled job goes back to the queue. */
export async function retryJob(db: DB, id: number): Promise<boolean> {
  const rows = await query<{ id: number }>(
    db,
    sql`UPDATE card_generation_jobs SET status = 'queued', error = NULL, cancel_requested = false, finished_at = NULL, started_at = NULL,
          progress = '{"done":0,"total":0}'::jsonb, report = '{}'::jsonb
        WHERE id = ${id} AND status IN ('failed', 'cancelled') RETURNING id`,
  );
  return rows.length > 0;
}

export async function finishJob(
  db: DB,
  id: number,
  status: Extract<JobStatus, "ready" | "failed" | "cancelled">,
  patch: { report?: Record<string, unknown>; error?: string | null; tokensIn?: number; tokensOut?: number; model?: string | null },
) {
  await db
    .update(cardGenerationJobs)
    .set({
      status,
      finishedAt: new Date(),
      error: patch.error ?? null,
      ...(patch.report ? { report: patch.report } : {}),
      inputTokens: patch.tokensIn ?? 0,
      outputTokens: patch.tokensOut ?? 0,
      ...(patch.model ? { model: patch.model } : {}),
    })
    .where(eq(cardGenerationJobs.id, id));
}

// ---------------------------------------------------------------- the cards of a job

export interface NewGeneratedCard {
  module: string;
  scope: string;
  groupKey: string;
  groupTitle: string;
  context?: string | null;
  level: "easy" | "medium" | "hard";
  topicKey: string;
  title: string;
  body: string;
  sourceRefs: string[];
  warnings: string[];
}

export async function insertCards(db: DB, jobId: number, cards: NewGeneratedCard[]) {
  if (!cards.length) return;
  await db.insert(generatedCards).values(cards.map((c) => ({ ...c, jobId, context: c.context ?? null })));
}

export const loadCards = (db: DB, jobId: number): Promise<GeneratedCardRow[]> =>
  db.select().from(generatedCards).where(eq(generatedCards.jobId, jobId)).orderBy(asc(generatedCards.module), asc(generatedCards.groupKey), asc(generatedCards.id));

export const loadDraftCards = (db: DB, jobId: number): Promise<GeneratedCardRow[]> =>
  db.select().from(generatedCards).where(and(eq(generatedCards.jobId, jobId), eq(generatedCards.status, "draft"))).orderBy(asc(generatedCards.module), asc(generatedCards.groupKey), asc(generatedCards.id));

/** A card can only be changed while its job is waiting for review. */
async function editableCard(db: DB, cardId: number): Promise<GeneratedCardRow> {
  const [card] = await db.select().from(generatedCards).where(eq(generatedCards.id, cardId));
  if (!card) throw new JobError("Card not found");
  const job = await getJob(db, card.jobId);
  if (!job || job.status !== "ready") throw new JobError("These cards can no longer be changed (the job is not waiting for review).");
  return card;
}

export async function setCardDeleted(db: DB, cardId: number, deleted: boolean): Promise<GeneratedCardRow> {
  await editableCard(db, cardId);
  const [row] = await db.update(generatedCards).set({ status: deleted ? "deleted" : "draft" }).where(eq(generatedCards.id, cardId)).returning();
  return row;
}

export interface CardEdit {
  title: string;
  body: string;
  level: "easy" | "medium" | "hard";
  topicKey: string;
}

/**
 * Saves an edit and re-checks the card. Hard failures (empty text, a topic key already used by another card of the
 * same item and level) refuse the save; length and wording problems are stored as warnings the admin can see.
 */
export async function editCard(db: DB, cardId: number, edit: CardEdit): Promise<GeneratedCardRow> {
  const card = await editableCard(db, cardId);
  const title = edit.title.trim();
  const body = edit.body.trim();
  const topicKey = edit.topicKey.trim();
  if (!title || !body) throw new JobError("Title and body cannot be empty.");
  if (title.length > 400) throw new JobError("The title is too long.");
  if (!topicKey) throw new JobError("The topic key cannot be empty.");
  const clash = await db
    .select({ id: generatedCards.id })
    .from(generatedCards)
    .where(
      and(
        eq(generatedCards.jobId, card.jobId),
        eq(generatedCards.groupKey, card.groupKey),
        eq(generatedCards.level, edit.level),
        eq(generatedCards.topicKey, topicKey),
        ne(generatedCards.id, cardId),
        ne(generatedCards.status, "deleted"),
      ),
    );
  if (clash.length) throw new JobError("Another card of this item already has that level and topic key.");

  const job = await getJob(db, card.jobId);
  const warnings = [...checkCard({ level: edit.level, topic_key: topicKey, title, body, source_refs: card.sourceRefs }, audienceOf(job?.params)).map((p) => p.message), ...card.warnings.filter((w) => w.startsWith("Similar"))].filter((w, i, a) => a.indexOf(w) === i);
  const [row] = await db.update(generatedCards).set({ title, body, level: edit.level, topicKey, edited: true, warnings }).where(eq(generatedCards.id, cardId)).returning();
  return row;
}

export const addCardWarnings = async (db: DB, ids: number[], warning: string) => {
  if (!ids.length) return;
  await db.update(generatedCards).set({ warnings: sql`CASE WHEN warnings ? ${warning} THEN warnings ELSE warnings || to_jsonb(${warning}::text) END` }).where(inArray(generatedCards.id, ids));
};

// ---------------------------------------------------------------- notifications

export async function notify(db: DB, userId: string, kind: NotificationKind, jobId: number | null, message: string) {
  await db.insert(notifications).values({ userId, kind, jobId, message });
}

export type NotificationRow = typeof notifications.$inferSelect;

export async function loadNotifications(db: DB, userId: string, limit = 15): Promise<{ items: NotificationRow[]; unread: number }> {
  const items = await db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.id)).limit(limit);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return { items, unread: n };
}

export async function markNotificationsRead(db: DB, userId: string, ids?: number[]) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), ids?.length ? inArray(notifications.id, ids) : undefined));
}

export type { JobParams };
