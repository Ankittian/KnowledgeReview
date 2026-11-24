import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { mailConnections } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";

/**
 * Outgoing-mail (SMTP) connections. An admin saves several under Admin > Settings & exports > Email (table `mail_connections`)
 * and marks one active; the active one sends the one-time codes. The password is stored encrypted (lib/secret-box.ts).
 * There is no environment-variable configuration: with no active connection no email is sent.
 */
export const MAIL_SECURITY = ["starttls", "ssl"] as const;
export type MailSecurity = (typeof MAIL_SECURITY)[number];

export type MailConnection = typeof mailConnections.$inferSelect;

/** What the admin page may show: everything except the encrypted password. */
export type MailConnectionView = Omit<MailConnection, "passwordEnc"> & { hasPassword: boolean };

export interface MailConfig {
  source: "admin" | "none";
  /** the saved connection in use (source "admin") */
  connectionId?: string;
  name?: string;
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  user?: string;
  pass?: string;
  from: string;
  /** a password is saved but cannot be decrypted (the server secret changed): the admin must enter it again */
  passwordUnreadable?: boolean;
}

// A host name or IP. Not a URL: no scheme, path or port.
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export const mailConnectionSchema = z.object({
  name: z.string().trim().min(1, "Give this connection a name.").max(60, "At most 60 characters."),
  host: z.string().trim().toLowerCase().regex(HOST, "Enter a host name such as smtp.gmail.com (no https:// and no port)."),
  port: z.coerce.number().int("Enter a whole number.").min(1, "Port must be between 1 and 65535.").max(65535, "Port must be between 1 and 65535."),
  security: z.enum(MAIL_SECURITY),
  user: z.string().trim().max(254),
  password: z.string().max(512).optional(), // blank = keep the saved one
  fromName: z.string().trim().max(80).refine((v) => !/[\r\n<>"]/.test(v), "The name cannot contain quotes, angle brackets or line breaks."),
  fromEmail: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid sender email address.")),
});
export type MailConnectionInput = z.infer<typeof mailConnectionSchema>;

const view = ({ passwordEnc, ...rest }: MailConnection): MailConnectionView => ({ ...rest, hasPassword: !!passwordEnc });

/** All saved connections, the active one first. Never includes passwords. */
export async function listMailConnections(db: DB): Promise<MailConnectionView[]> {
  const rows = await db.select().from(mailConnections).orderBy(sql`${mailConnections.isActive} desc`, asc(mailConnections.name));
  return rows.map(view);
}

export async function getMailConnection(db: DB, id: string): Promise<MailConnection | null> {
  const [row] = await db.select().from(mailConnections).where(eq(mailConnections.id, id));
  return row ?? null;
}

export type SaveResult = { ok: true; id: string } | { ok: false; field: "name"; message: string };

/**
 * Creates a connection, or updates `id`. An empty `password` keeps the stored one. `activate` makes it the active
 * connection (the previous active one is switched off in the same transaction).
 */
export async function saveMailConnection(db: DB, input: MailConnectionInput, opts: { id?: string; actorId: string; activate: boolean }): Promise<SaveResult> {
  const [clash] = await db.select({ id: mailConnections.id }).from(mailConnections).where(sql`lower(${mailConnections.name}) = ${input.name.toLowerCase()}`);
  if (clash && clash.id !== opts.id) return { ok: false, field: "name", message: "A connection with that name already exists." };

  return db.transaction(async (tx) => {
    const values = {
      name: input.name,
      host: input.host,
      port: input.port,
      security: input.security,
      username: input.user,
      fromName: input.fromName,
      fromEmail: input.fromEmail,
      updatedAt: new Date(),
    };
    let id = opts.id;
    if (id) {
      const set = input.password ? { ...values, passwordEnc: encryptSecret(input.password) } : values;
      const updated = await tx.update(mailConnections).set(set).where(eq(mailConnections.id, id)).returning({ id: mailConnections.id });
      if (!updated.length) id = undefined;
    }
    if (!id) {
      const first = (await tx.select({ id: mailConnections.id }).from(mailConnections).limit(1)).length === 0;
      const [row] = await tx
        .insert(mailConnections)
        .values({ ...values, passwordEnc: input.password ? encryptSecret(input.password) : null, createdBy: opts.actorId, isActive: false })
        .returning({ id: mailConnections.id });
      id = row.id;
      if (first) opts = { ...opts, activate: true }; // the very first connection is used right away
    }
    if (opts.activate) {
      await tx.update(mailConnections).set({ isActive: false }).where(eq(mailConnections.isActive, true));
      await tx.update(mailConnections).set({ isActive: true }).where(eq(mailConnections.id, id));
    }
    return { ok: true as const, id };
  });
}

/** Makes `id` the one connection used for sending. Returns false when it does not exist. */
export async function activateMailConnection(db: DB, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ id: mailConnections.id }).from(mailConnections).where(eq(mailConnections.id, id));
    if (!row) return false;
    await tx.update(mailConnections).set({ isActive: false }).where(eq(mailConnections.isActive, true));
    await tx.update(mailConnections).set({ isActive: true }).where(eq(mailConnections.id, id));
    return true;
  });
}

export async function deleteMailConnection(db: DB, id: string): Promise<{ existed: boolean; wasActive: boolean }> {
  const [row] = await db.delete(mailConnections).where(eq(mailConnections.id, id)).returning({ isActive: mailConnections.isActive });
  return { existed: !!row, wasActive: !!row?.isActive };
}

const fromHeader = (name: string, email: string) => (name ? `"${name}" <${email}>` : email);

/** A saved connection as send-ready settings (decrypts the password). */
export function configFromConnection(c: MailConnection): MailConfig {
  const pass = c.passwordEnc ? decryptSecret(c.passwordEnc) : null;
  return {
    source: "admin",
    connectionId: c.id,
    name: c.name,
    host: c.host,
    port: c.port,
    secure: c.security === "ssl",
    requireTLS: c.security !== "ssl",
    user: c.username || undefined,
    pass: pass ?? undefined,
    from: fromHeader(c.fromName, c.fromEmail),
    passwordUnreadable: !!c.passwordEnc && pass === null,
  };
}

const NONE: MailConfig = { source: "none", host: "", port: 587, secure: false, requireTLS: false, from: "" };

/** The settings to send with right now: the active saved connection, or none. */
export async function resolveMailConfig(db: DB | null): Promise<MailConfig> {
  if (db) {
    try {
      const [active] = await db.select().from(mailConnections).where(eq(mailConnections.isActive, true));
      if (active) return configFromConnection(active);
    } catch (e) {
      console.error("[mail] could not read the saved email connections:", e instanceof Error ? e.message : e);
    }
  }
  return NONE;
}
