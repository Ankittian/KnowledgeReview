"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireRole } from "@/lib/auth/session";
import { audit } from "@/lib/events";
import { describeMailError, sendTestMail } from "@/lib/mail";
import {
  activateMailConnection,
  configFromConnection,
  deleteMailConnection,
  getMailConnection,
  mailConnectionSchema,
  saveMailConnection,
} from "@/lib/mail-settings";
import { rateLimited } from "@/lib/rate-limit";
import { emailSchema } from "@/lib/validation";
import type { FormState } from "./auth";

const uuid = z.uuid();
const pick = (fd: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, String(fd.get(k) ?? "")]));

/** Create (no `id`) or update (`id`) a saved connection. Blank password on update keeps the stored one. */
export async function saveMailConnectionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user: actor } = await requireRole(["admin"]);
  const raw = pick(fd, ["id", "name", "host", "port", "security", "user", "password", "fromName", "fromEmail"]);
  const values = { name: raw.name, host: raw.host, port: raw.port, security: raw.security, user: raw.user, fromName: raw.fromName, fromEmail: raw.fromEmail }; // never echo the password
  const parsed = mailConnectionSchema.safeParse({ ...raw, password: raw.password || undefined });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors, values };
  }
  const id = raw.id ? uuid.safeParse(raw.id).data : undefined;
  if (!id && parsed.data.user && !parsed.data.password) return { fieldErrors: { password: "Enter the password for this login." }, values };

  const db = await getDb();
  const result = await saveMailConnection(db, parsed.data, { id, actorId: actor.id, activate: fd.get("activate") === "on" });
  if (!result.ok) return { fieldErrors: { [result.field]: result.message }, values };
  const d = parsed.data;
  await audit(db, actor.id, id ? "mail_connection_updated" : "mail_connection_created", "mail_connection", result.id, {
    name: d.name,
    host: d.host,
    port: d.port,
    security: d.security,
    user: d.user,
    fromEmail: d.fromEmail,
    passwordChanged: !!d.password,
  }); // the password itself is never logged
  revalidatePath("/admin/settings");
  redirect(`/admin/settings?saved=${result.id}#email`);
}

/** Make a saved connection the one that sends. */
export async function activateMailConnectionAction(fd: FormData) {
  const { user: actor } = await requireRole(["admin"]);
  const id = uuid.parse(fd.get("id"));
  const db = await getDb();
  if (await activateMailConnection(db, id)) await audit(db, actor.id, "mail_connection_activated", "mail_connection", id);
  revalidatePath("/admin/settings");
}

export async function deleteMailConnectionAction(fd: FormData) {
  const { user: actor } = await requireRole(["admin"]);
  const id = uuid.parse(fd.get("id"));
  const db = await getDb();
  const r = await deleteMailConnection(db, id);
  if (r.existed) await audit(db, actor.id, "mail_connection_deleted", "mail_connection", id, { wasActive: r.wasActive });
  revalidatePath("/admin/settings");
}

/** Sends the test email through one saved connection, so it can be checked before it is activated. */
export async function sendTestMailAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user: actor } = await requireRole(["admin"]);
  const raw = pick(fd, ["connectionId", "to"]);
  const values = { connectionId: raw.connectionId, to: raw.to };
  const to = emailSchema.safeParse(raw.to);
  if (!to.success) return { fieldErrors: { to: to.error.issues[0].message }, values };
  if (rateLimited(`mail-test:${actor.id}`, 5, 60_000)) return { error: "Too many test emails. Wait a minute.", values };

  const db = await getDb();
  const id = uuid.safeParse(raw.connectionId);
  const c = id.success ? await getMailConnection(db, id.data) : null;
  if (!c) return { error: "Choose a saved connection to test.", values };
  const cfg = configFromConnection(c);
  try {
    await sendTestMail(cfg, to.data);
  } catch (e) {
    await audit(db, actor.id, "mail_test_failed", "mail_connection", c.id, { to: to.data });
    return { error: describeMailError(e), values };
  }
  await audit(db, actor.id, "mail_test_sent", "mail_connection", c.id, { to: to.data });
  return { success: `Test email sent to ${to.data} through ${c.name}. Check the inbox (and spam).`, values };
}
