"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { cardFeedback, roleIdOf, roles, users } from "@/db/schema";
import { requireRole, revokeUserSessions } from "@/lib/auth/session";
import { audit } from "@/lib/events";
import { ANNOUNCEMENT_MAX_LENGTH, ANNOUNCEMENT_TONES, DAILY_LIMIT_MAX, DAILY_LIMIT_MIN, getAnnouncement, setAnnouncement, setDailyCardLimit } from "@/lib/settings";
import { ANSWER_ROLES } from "@/lib/chat/config";
import { setAnswerRole, setCanUseKgNew } from "@/lib/chat/service";

const uuid = z.uuid();

export async function approveUser(fd: FormData) {
  const { user: actor } = await requireRole(["admin"]);
  const id = uuid.parse(fd.get("userId"));
  const role = z.enum(["admin", "functional", "technical"]).catch("functional").parse(fd.get("role"));
  const db = await getDb();
  // Only a pending sign-up can be approved: this must not re-enable a disabled account or re-role an active one.
  const approved = await db
    .update(users)
    .set({ status: "active", roleId: roleIdOf(role) })
    .where(and(eq(users.id, id), eq(users.status, "pending")))
    .returning({ id: users.id });
  if (!approved.length) {
    revalidatePath("/admin/users");
    return;
  }
  await revokeUserSessions(id); // nothing from before the approval stays valid
  await audit(db, actor.id, "user_approved", "user", id, { role });
  revalidatePath("/admin/users");
}

export async function setUserStatus(fd: FormData) {
  const { user: actor } = await requireRole(["admin"]);
  const id = uuid.parse(fd.get("userId"));
  const status = z.enum(["active", "disabled"]).parse(fd.get("status"));
  if (id === actor.id) throw new Error("You can't change your own status.");
  const db = await getDb();
  await db.update(users).set({ status }).where(eq(users.id, id));
  if (status === "disabled") await revokeUserSessions(id);
  await audit(db, actor.id, status === "disabled" ? "user_disabled" : "user_enabled", "user", id);
  revalidatePath("/admin/users");
}

export async function setUserRole(fd: FormData) {
  const { user: actor } = await requireRole(["admin"]);
  const id = uuid.parse(fd.get("userId"));
  const role = z.enum(["admin", "functional", "technical"]).parse(fd.get("role"));
  if (id === actor.id) throw new Error("You can't change your own role.");
  const db = await getDb();
  await db.update(users).set({ roleId: roleIdOf(role), answerRole: null }).where(eq(users.id, id)); // answer style follows the new role again
  await revokeUserSessions(id); // new permissions on next sign-in
  await audit(db, actor.id, "user_role_changed", "user", id, { role });
  revalidatePath("/admin/users");
}

/**
 * Permanently deletes a user and everything they own: flashcard progress, reviews, feedback and assistant chats.
 * The activity log is kept (it has no foreign key) so the audit trail survives. Admins cannot delete themselves.
 */
export async function deleteUser(fd: FormData) {
  const { user: actor } = await requireRole(["admin"]);
  const id = uuid.parse(fd.get("userId"));
  if (id === actor.id) throw new Error("You can't delete your own account.");
  const db = await getDb();
  const [target] = await db.select({ username: users.username, displayName: users.displayName }).from(users).where(eq(users.id, id));
  if (!target) return;

  await revokeUserSessions(id);
  await db.transaction(async (tx) => {
    const convos = sql`(SELECT id FROM conversations WHERE user_id = ${id})`;
    const msgs = sql`(SELECT id FROM chat_messages WHERE conversation_id IN ${convos})`;
    await tx.execute(sql`DELETE FROM chat_feedback WHERE user_id = ${id} OR message_id IN ${msgs}`);
    await tx.execute(sql`DELETE FROM chat_tool_calls WHERE message_id IN ${msgs}`);
    await tx.execute(sql`DELETE FROM chat_messages WHERE conversation_id IN ${convos}`);
    await tx.execute(sql`DELETE FROM conversations WHERE user_id = ${id}`);
    await tx.execute(sql`DELETE FROM card_feedback WHERE user_id = ${id}`); // before card_reviews: it points at them
    await tx.execute(sql`DELETE FROM card_reviews WHERE user_id = ${id}`);
    await tx.delete(users).where(eq(users.id, id)); // cascades: decks, review schedule, sessions
  });
  await audit(db, actor.id, "user_deleted", "user", id, { username: target.username, displayName: target.displayName });
  revalidatePath("/admin/users");
}

/** Answer style (Claude skill) of a general user (REQ-ROLE-01). Applies to chats they start from now on. */
export async function setUserAnswerRole(fd: FormData) {
  const { user: actor } = await requireRole(["admin"]);
  const id = uuid.parse(fd.get("userId"));
  const role = z.enum(ANSWER_ROLES).parse(fd.get("answerRole"));
  const db = await getDb();
  await setAnswerRole(db, id, role);
  await audit(db, actor.id, "user_answer_role_changed", "user", id, { answerRole: role });
  revalidatePath("/admin/users");
}

/**
 * Lets a non-admin user pick SpectrumERP-new for new chats, or takes that away (D2). Admins always have access, so
 * their flag is never touched. Revoking leaves the user's existing SpectrumERP-new chats visible but read-only (D17).
 */
export async function setUserKgNewAccess(fd: FormData) {
  const { user: actor } = await requireRole(["admin"]);
  const id = uuid.parse(fd.get("userId"));
  const allowed = z.enum(["on", "off"]).parse(fd.get("access")) === "on";
  const db = await getDb();
  const [target] = await db.select({ role: roles.name, was: users.canUseKgNew }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, id));
  if (!target || target.role === "admin") return;
  if (target.was !== allowed) {
    await setCanUseKgNew(db, id, allowed);
    await audit(db, actor.id, "user_kg_new_access_changed", "user", id, { old: target.was, new: allowed });
  }
  revalidatePath("/admin/users");
}

export async function resolveFeedback(fd: FormData) {
  const { user: actor } = await requireRole(["admin"]);
  const id = z.coerce.number().int().positive().parse(fd.get("feedbackId"));
  const status = z.enum(["open", "accepted", "rejected", "applied"]).parse(fd.get("status"));
  const note = z.string().max(2000).optional().parse((fd.get("note") as string) || undefined);
  const commit = z
    .string()
    .max(80)
    .optional()
    .parse((fd.get("commit") as string)?.trim() || undefined);
  const db = await getDb();
  await db
    .update(cardFeedback)
    .set({
      status,
      resolutionNote: note ?? null,
      appliedCommit: status === "applied" ? (commit ?? null) : null,
      resolvedBy: status === "open" ? null : actor.id,
      resolvedAt: status === "open" ? null : new Date(),
    })
    .where(eq(cardFeedback.id, id));
  await audit(db, actor.id, "feedback_resolved", "feedback", String(id), { status, note, commit });
  revalidatePath("/admin/feedback");
  revalidatePath("/admin/health");
}

export async function saveDailyCardLimit(fd: FormData) {
  const { user: actor } = await requireRole(["admin"]);
  const limit = z.coerce.number().int().min(DAILY_LIMIT_MIN).max(DAILY_LIMIT_MAX).parse(fd.get("dailyLimit"));
  const db = await getDb();
  await setDailyCardLimit(db, limit);
  await audit(db, actor.id, "setting_changed", "setting", "daily_card_limit", { value: limit });
  revalidatePath("/admin/settings");
}

/** Publishes, edits or switches off the announcement banner. Each save gets a new id so earlier dismissals reset. */
export async function saveAnnouncement(fd: FormData) {
  const { user: actor } = await requireRole(["admin"]);
  const message = z.string().trim().max(ANNOUNCEMENT_MAX_LENGTH).parse(fd.get("message") ?? "");
  const tone = z.enum(ANNOUNCEMENT_TONES).catch("info").parse(fd.get("tone"));
  const publish = fd.get("intent") === "publish";
  if (publish && !message) throw new Error("Write a message to publish.");
  const db = await getDb();
  const prev = await getAnnouncement(db);
  await setAnnouncement(db, { id: crypto.randomUUID(), message: message || prev?.message || "", tone, active: publish });
  await audit(db, actor.id, "setting_changed", "setting", "announcement", { active: publish, tone, message });
  revalidatePath("/", "layout");
}
