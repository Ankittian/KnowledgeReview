"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { cardFeedback, roleIdOf, users } from "@/db/schema";
import { requireRole, revokeUserSessions } from "@/lib/auth/session";
import { audit } from "@/lib/events";
import { runKbSync } from "@/lib/kb-sync";
import { DAILY_LIMIT_MAX, DAILY_LIMIT_MIN, setDailyCardLimit } from "@/lib/settings";

const uuid = z.uuid();

export async function approveUser(fd: FormData) {
  const { user: actor } = await requireRole(["admin"]);
  const id = uuid.parse(fd.get("userId"));
  const role = z.enum(["employee", "functional", "technical", "reviewer", "admin"]).catch("employee").parse(fd.get("role"));
  const db = await getDb();
  await db.update(users).set({ status: "active", roleId: roleIdOf(role) }).where(eq(users.id, id));
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
  const role = z.enum(["employee", "functional", "technical", "reviewer", "admin"]).parse(fd.get("role"));
  if (id === actor.id) throw new Error("You can't change your own role.");
  const db = await getDb();
  await db.update(users).set({ roleId: roleIdOf(role) }).where(eq(users.id, id));
  await revokeUserSessions(id); // new permissions on next sign-in
  await audit(db, actor.id, "user_role_changed", "user", id, { role });
  revalidatePath("/admin/users");
}

export async function resolveFeedback(fd: FormData) {
  const { user: actor } = await requireRole(["admin", "reviewer"]);
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

export interface SyncState {
  message?: string;
  error?: string;
}

export async function syncKnowledgeBase(_prev: SyncState): Promise<SyncState> {
  const { user: actor } = await requireRole(["admin"]);
  try {
    const { report, warnings, quality } = await runKbSync(await getDb(), { actor: actor.id, via: "admin" });
    revalidatePath("/admin", "layout");
    const c = report.cards;
    return {
      message: report.changed
        ? `Synced: ${c.inserted} new cards, ${c.newVersions} updated, ${c.retired} retired, ${report.staleFeedback} feedback marked stale${warnings.length ? `, ${warnings.length} warnings` : ""}.`
        : `Already in sync (${report.totalCards} cards).${quality.length ? ` ${quality.length} data-quality findings listed below.` : ""}`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
