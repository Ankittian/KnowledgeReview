"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireRole } from "@/lib/auth/session";
import { audit } from "@/lib/events";
import { cancelJob, createJob, editCard, getJob, JobError, loadDraftCards, markNotificationsRead, retryJob, setCardDeleted, type GeneratedCardRow } from "@/lib/cards/generate/jobs";
import { audienceOf } from "@/lib/cards/generate/config";
import { previewPush, pushJob, type PushOutcome, type PushPreview } from "@/lib/cards/generate/push";

/**
 * Server actions of Admin > Cards. Every one checks the admin role again (never trust the page that called it).
 * They return { ok: false, error } for expected problems so the UI can show the message.
 */
type Fail = { ok: false; error: string };
const fail = (e: unknown): Fail => ({ ok: false, error: e instanceof JobError || e instanceof Error ? e.message : "Something went wrong" });
const refresh = (jobId?: number) => {
  revalidatePath("/admin/cards");
  if (jobId) revalidatePath(`/admin/cards/${jobId}`);
};

export async function createGenerationJob(input: unknown): Promise<{ ok: true; id: number } | Fail> {
  const { user } = await requireRole(["admin"]);
  try {
    const db = await getDb();
    const job = await createJob(db, user.id, input);
    await audit(db, user.id, "card_generation_started", "card_generation_job", String(job.id), { level: job.level, model: job.model });
    refresh();
    return { ok: true, id: job.id };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelGenerationJob(id: number): Promise<{ ok: true; result: string } | Fail> {
  const { user } = await requireRole(["admin"]);
  try {
    const db = await getDb();
    const result = await cancelJob(db, z.number().int().parse(id));
    if (result === "not_cancellable") return { ok: false, error: "This job can no longer be cancelled." };
    await audit(db, user.id, "card_generation_cancelled", "card_generation_job", String(id));
    refresh(id);
    return { ok: true, result };
  } catch (e) {
    return fail(e);
  }
}

export async function retryGenerationJob(id: number): Promise<{ ok: true } | Fail> {
  const { user } = await requireRole(["admin"]);
  try {
    const db = await getDb();
    if (!(await retryJob(db, z.number().int().parse(id)))) return { ok: false, error: "Only a failed or cancelled job can be retried." };
    await audit(db, user.id, "card_generation_retried", "card_generation_job", String(id));
    refresh(id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const editSchema = z.object({
  title: z.string().min(1).max(400),
  body: z.string().min(1).max(8000),
  level: z.enum(["easy", "medium", "hard"]),
  topicKey: z.string().min(1).max(200),
});

export async function saveCardEdit(cardId: number, input: unknown): Promise<{ ok: true; card: GeneratedCardRow } | Fail> {
  const { user } = await requireRole(["admin"]);
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid card" };
  try {
    const db = await getDb();
    const card = await editCard(db, z.number().int().parse(cardId), parsed.data);
    await audit(db, user.id, "generated_card_edited", "generated_card", String(cardId), { job: card.jobId });
    return { ok: true, card };
  } catch (e) {
    return fail(e);
  }
}

export async function setGeneratedCardDeleted(cardId: number, deleted: boolean): Promise<{ ok: true; card: GeneratedCardRow } | Fail> {
  const { user } = await requireRole(["admin"]);
  try {
    const db = await getDb();
    const card = await setCardDeleted(db, z.number().int().parse(cardId), deleted);
    await audit(db, user.id, deleted ? "generated_card_deleted" : "generated_card_restored", "generated_card", String(cardId), { job: card.jobId });
    return { ok: true, card };
  } catch (e) {
    return fail(e);
  }
}

/** Dry run of the push for the confirmation dialog: nothing is saved. */
export async function previewJobPush(jobId: number): Promise<{ ok: true; previews: PushPreview[] } | Fail> {
  await requireRole(["admin"]);
  try {
    const db = await getDb();
    const job = await getJob(db, z.number().int().parse(jobId));
    if (!job || job.status !== "ready") return { ok: false, error: "This job is not waiting for review." };
    const rows = await loadDraftCards(db, job.id);
    if (!rows.length) return { ok: false, error: "There are no cards to push: every card was deleted." };
    return { ok: true, previews: await previewPush(db, rows, audienceOf(job.params)) };
  } catch (e) {
    return fail(e);
  }
}

export async function pushGenerationJob(jobId: number): Promise<PushOutcome> {
  const { user } = await requireRole(["admin"]);
  try {
    const db = await getDb();
    const out = await pushJob(db, z.number().int().parse(jobId), user.id);
    if (out.ok) await audit(db, user.id, "card_generation_pushed", "card_generation_job", String(jobId), { files: out.files });
    refresh(jobId);
    return out;
  } catch (e) {
    return fail(e);
  }
}

export async function markNotificationsReadAction(ids?: number[]): Promise<void> {
  const { user } = await requireRole(["admin"]);
  await markNotificationsRead(await getDb(), user.id, ids);
}
