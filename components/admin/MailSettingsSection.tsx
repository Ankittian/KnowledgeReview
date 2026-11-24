import Link from "next/link";
import { CheckCircle2, Mail, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { getDb } from "@/db/client";
import { activateMailConnectionAction, deleteMailConnectionAction } from "@/app/actions/mail-admin";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { MailConnectionForm } from "@/components/admin/MailConnectionForm";
import { MailTestForm } from "@/components/admin/MailTestForm";
import { Empty, TableCard, Tag, surface, tcell, thead } from "@/components/admin/bits";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getMailConnection, listMailConnections } from "@/lib/mail-settings";
import { cn } from "@/lib/utils";

/** Where the section lives: Admin > Settings. Links and redirects use this path and the #email anchor. */
export const MAIL_SETTINGS_HREF = "/admin/settings";

/**
 * "Email" part of Settings: the SMTP connections that send sign-in, verification and password codes.
 * Save several (Gmail, Outlook / Microsoft 365, SES ...), test each, and pick the one to use.
 */
export async function MailSettingsSection({ userId, edit, saved }: { userId: string; edit?: string; saved?: string }) {
  const db = await getDb();
  const connections = await listMailConnections(db);
  const active = connections.find((c) => c.isActive) ?? null;
  const editing = edit && /^[0-9a-f-]{36}$/i.test(edit) ? await getMailConnection(db, edit) : null;

  const testOptions = connections.map((c) => ({ id: c.id, label: `${c.name} (${c.host})${c.isActive ? " - active" : ""}` }));

  return (
    <section id="email" className={cn(surface, "min-w-0 scroll-mt-24 space-y-6 p-5")} data-testid="mail-section">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
          <Mail />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Email (sign-in and password codes)</h2>
          <p className="mt-1 text-sm text-pretty text-muted-foreground">
            The mail account that sends one-time codes. Save several connections, test each, and pick the one to use. The password is stored encrypted and is never shown again.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3" data-testid="mail-status">
        <div className="min-w-0 flex-1 text-sm">
          {active ? (
            <p>
              Sending with <span className="font-medium">{active.name}</span>{" "}
              <span className="text-muted-foreground">
                ({active.host}:{active.port}, as {active.fromEmail})
              </span>
            </p>
          ) : (
            <p className="text-warning">
              <span className="font-medium">Email is not configured.</span> Nobody can receive codes until you add a connection below{connections.length ? " and press Use on it" : ""}.
            </p>
          )}
        </div>
      </div>
      {saved && (
        <p role="status" className="flex items-center gap-2 rounded-md border border-success/25 bg-success/5 px-3 py-2 text-sm text-success" data-testid="mail-saved">
          <CheckCircle2 className="size-4" /> Connection saved.
        </p>
      )}

      <div>
        <h3 className="mb-2 text-sm font-medium">
          Saved connections <span className="font-normal text-muted-foreground">({connections.length})</span>
        </h3>
        {connections.length === 0 ? (
          <Empty title="No saved connections yet" icon={<Mail />} />
        ) : (
          <TableCard>
            <Table className="min-w-[760px]">
              <TableHeader className={thead}>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Server</TableHead>
                  <TableHead>Login</TableHead>
                  <TableHead>Sender</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((c) => (
                  <TableRow key={c.id} data-testid="mail-connection">
                    <TableCell className={cn(tcell, "font-medium")}>{c.name}</TableCell>
                    <TableCell className={cn(tcell, "text-sm")}>
                      {c.host}:{c.port}
                      <span className="ml-1 text-xs text-muted-foreground">{c.security === "ssl" ? "SSL/TLS" : "STARTTLS"}</span>
                    </TableCell>
                    <TableCell className={cn(tcell, "text-sm text-muted-foreground")}>{c.username || "none"}</TableCell>
                    <TableCell className={cn(tcell, "text-sm text-muted-foreground")}>{c.fromEmail}</TableCell>
                    <TableCell className={tcell}>{c.isActive ? <Tag tone="success">Active</Tag> : <Tag tone="neutral">Saved</Tag>}</TableCell>
                    <TableCell className={cn(tcell, "text-right")}>
                      <div className="flex flex-wrap justify-end gap-1">
                        {!c.isActive && (
                          <form action={activateMailConnectionAction}>
                            <input type="hidden" name="id" value={c.id} />
                            <button className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`Use ${c.name}`}>
                              <Power /> Use
                            </button>
                          </form>
                        )}
                        <Link href={`${MAIL_SETTINGS_HREF}?edit=${c.id}#email`} className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`Edit ${c.name}`}>
                          <Pencil /> Edit
                        </Link>
                        <form action={deleteMailConnectionAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <ConfirmSubmitButton
                            message={c.isActive ? `Delete "${c.name}"? It is the active connection, so no email can be sent until you add or activate another.` : `Delete "${c.name}"?`}
                            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-destructive hover:bg-destructive/10 hover:text-destructive")}
                            aria-label={`Delete ${c.name}`}
                          >
                            <Trash2 />
                          </ConfirmSubmitButton>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        )}
      </div>

      <div className="grid gap-6 border-t pt-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            {editing ? <Pencil className="size-4" /> : <Plus className="size-4" />}
            {editing ? `Edit "${editing.name}"` : "Add a connection"}
          </h3>
          <div className="mt-4">
            <MailConnectionForm
              key={editing?.id ?? "new"}
              firstOne={connections.length === 0}
              connection={
                editing
                  ? { id: editing.id, name: editing.name, host: editing.host, port: editing.port, security: editing.security, username: editing.username, fromName: editing.fromName, fromEmail: editing.fromEmail, hasPassword: !!editing.passwordEnc }
                  : undefined
              }
            />
          </div>
        </div>

        <div className="h-fit min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Mail className="size-4" /> Send a test email
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">Checks the login and delivery of a saved connection, before or after you switch to it.</p>
          <div className="mt-4">
            {testOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Save a connection first.</p>
            ) : (
              <MailTestForm options={testOptions} defaultId={active?.id ?? testOptions[0].id} defaultTo="" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
