import Link from "next/link";
import { CheckCircle2, Mail, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { getDb } from "@/db/client";
import { activateMailConnectionAction, deleteMailConnectionAction } from "@/app/actions/mail-admin";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { MailConnectionForm } from "@/components/admin/MailConnectionForm";
import { MailTestForm } from "@/components/admin/MailTestForm";
import { SectionCard } from "@/components/admin/SectionCard";
import { Empty, TableCard, Tag, tcell, thead } from "@/components/admin/bits";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getMailConnection, listMailConnections } from "@/lib/mail-settings";
import { cn } from "@/lib/utils";

/** Where the section lives: Admin > Settings. Links and redirects use this path with ?tab=email. */
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
    <section id="email" className="min-w-0 scroll-mt-24 space-y-4" data-testid="mail-section">
      <SectionCard
        icon={<Mail />}
        title={`Configured connections (${connections.length})`}
        description="The mail accounts that send one-time codes for sign-in, email verification and password recovery. Exactly one is in use."
      >

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
                          <Link href={`${MAIL_SETTINGS_HREF}?tab=email&edit=${c.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`Edit ${c.name}`}>
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

      </SectionCard>

      <SectionCard
        icon={editing ? <Pencil /> : <Plus />}
        title={editing ? `Edit "${editing.name}"` : "Add a connection"}
        description="Gmail, Microsoft 365 or any SMTP server. Passwords are stored encrypted and never shown again."
      >
        <div>
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
      </SectionCard>

      <SectionCard icon={<Mail />} title="Send a test email" description="Checks the login and delivery of a saved connection, before or after you switch to it.">
        <div>
          {testOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Save a connection first.</p>
          ) : (
            <MailTestForm options={testOptions} defaultId={active?.id ?? testOptions[0].id} defaultTo="" />
          )}
        </div>
      </SectionCard>
    </section>
  );
}
