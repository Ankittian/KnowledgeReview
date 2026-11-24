"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Info, Save } from "lucide-react";
import type { FormState } from "@/app/actions/auth";
import { saveMailConnectionAction } from "@/app/actions/mail-admin";
import { FieldError, FormAlert, SubmitButton } from "@/components/auth/FormBits";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export interface ConnectionDefaults {
  id?: string;
  name: string;
  host: string;
  port: number;
  security: string;
  username: string;
  fromName: string;
  fromEmail: string;
  hasPassword?: boolean;
}

const PRESETS = [
  { label: "Gmail", host: "smtp.gmail.com", port: "587", security: "starttls", name: "Gmail" },
  { label: "Outlook / Microsoft 365", host: "smtp.office365.com", port: "587", security: "starttls", name: "Outlook" },
] as const;

/** What the admin must know before the chosen provider will accept the login. Shown from the host that is typed or picked. */
function providerHint(host: string): { tone: "info" | "warning"; title: string; body: string } | null {
  const h = host.trim().toLowerCase();
  if (h === "smtp.office365.com")
    return {
      tone: "info",
      title: "Microsoft 365 (work or school mailbox)",
      body: "Before this works, your Microsoft 365 admin must enable Authenticated SMTP for this mailbox, and Security Defaults or Conditional Access must not block password sign-in. The mailbox must not require 2-step verification. Use the full mailbox address as both Username and Sender email.",
    };
  if (h === "smtp-mail.outlook.com" || h.endsWith("hotmail.com") || h.endsWith("live.com"))
    return {
      tone: "warning",
      title: "Personal Outlook.com / Hotmail accounts cannot be used",
      body: "Microsoft no longer accepts a password or app password for sending from personal accounts (it answers 'basic authentication is disabled'). Use a work mailbox on smtp.office365.com, Gmail with an app password, or another SMTP service such as AWS SES.",
    };
  if (h === "smtp.gmail.com")
    return {
      tone: "info",
      title: "Gmail",
      body: "Turn on 2-Step Verification, then create an app password at myaccount.google.com/apppasswords and paste it as the Password (not your normal Google password). Sender email must be this Gmail address.",
    };
  return null;
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError message={error} />
    </div>
  );
}

/** Add a connection, or edit one (`connection` given). The saved password is never sent to the browser. */
export function MailConnectionForm({ connection, firstOne }: { connection?: ConnectionDefaults; firstOne: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(saveMailConnectionAction, {});
  const v = state.values ?? {};
  const fe = state.fieldErrors ?? {};
  const [host, setHost] = useState(v.host ?? connection?.host ?? "");
  const [port, setPort] = useState(v.port ?? String(connection?.port ?? 587));
  const [security, setSecurity] = useState(v.security ?? connection?.security ?? "starttls");
  const [name, setName] = useState(v.name ?? connection?.name ?? "");
  const editing = !!connection?.id;
  const hint = providerHint(host);

  return (
    <form action={action} className="space-y-4" noValidate data-testid="mail-form">
      {connection?.id && <input type="hidden" name="id" value={connection.id} />}
      <FormAlert message={state.error} />

      {!editing && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Start from:</span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="rounded-md border px-2 py-1 font-medium text-foreground hover:bg-muted"
              onClick={() => {
                setHost(p.host);
                setPort(p.port);
                setSecurity(p.security);
                setName((n) => n || p.name);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {hint && (
        <div
          role="note"
          data-testid="mail-hint"
          className={`flex gap-2.5 rounded-lg border p-3 text-sm ${hint.tone === "warning" ? "border-warning/30 bg-warning/10" : "border-info/30 bg-info/10"}`}
        >
          <Info className={`mt-0.5 size-4 shrink-0 ${hint.tone === "warning" ? "text-warning" : "text-info"}`} />
          <div>
            <p className="font-medium">{hint.title}</p>
            <p className="mt-0.5 text-muted-foreground">{hint.body}</p>
          </div>
        </div>
      )}

      <Field id="mc-name" label="Name" error={fe.name} hint="Only for you, to tell connections apart (for example Gmail testing).">
        <Input id="mc-name" name="name" className="h-10" value={name} onChange={(e) => setName(e.target.value)} required aria-invalid={!!fe.name || undefined} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-[1fr_7rem_11rem]">
        <Field id="mc-host" label="Host" error={fe.host}>
          <Input id="mc-host" name="host" className="h-10" placeholder="smtp.gmail.com" autoCapitalize="none" spellCheck={false} value={host} onChange={(e) => setHost(e.target.value)} required aria-invalid={!!fe.host || undefined} />
        </Field>
        <Field id="mc-port" label="Port" error={fe.port}>
          <Input id="mc-port" name="port" type="number" min={1} max={65535} className="h-10 tabular-nums" value={port} onChange={(e) => setPort(e.target.value)} required aria-invalid={!!fe.port || undefined} />
        </Field>
        <Field id="mc-security" label="Security" error={fe.security}>
          <NativeSelect id="mc-security" name="security" value={security} onChange={(e) => setSecurity(e.target.value)} className="w-full">
            <NativeSelectOption value="starttls">STARTTLS (587)</NativeSelectOption>
            <NativeSelectOption value="ssl">SSL/TLS (465)</NativeSelectOption>
          </NativeSelect>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="mc-user" label="Username" error={fe.user} hint="Usually the full email address of the mailbox.">
          <Input id="mc-user" name="user" className="h-10" autoComplete="off" autoCapitalize="none" spellCheck={false} defaultValue={v.user ?? connection?.username ?? ""} aria-invalid={!!fe.user || undefined} />
        </Field>
        <Field
          id="mc-password"
          label="Password"
          error={fe.password}
          hint={editing && connection?.hasPassword ? "A password is saved. Leave blank to keep it." : "Gmail needs an app password. Stored encrypted."}
        >
          <Input id="mc-password" name="password" type="password" className="h-10" autoComplete="new-password" placeholder={editing && connection?.hasPassword ? "••••••••••••••••" : ""} aria-invalid={!!fe.password || undefined} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="mc-fromname" label="Sender name" error={fe.fromName}>
          <Input id="mc-fromname" name="fromName" className="h-10" placeholder="Knowledge Review" defaultValue={v.fromName ?? connection?.fromName ?? "Knowledge Review"} aria-invalid={!!fe.fromName || undefined} />
        </Field>
        <Field id="mc-fromemail" label="Sender email" error={fe.fromEmail} hint="Gmail and Microsoft 365 only send as the mailbox you log in with.">
          <Input id="mc-fromemail" name="fromEmail" type="email" className="h-10" autoCapitalize="none" spellCheck={false} defaultValue={v.fromEmail ?? connection?.fromEmail ?? ""} required aria-invalid={!!fe.fromEmail || undefined} />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="activate" defaultChecked={firstOne} className="size-4 accent-[var(--primary)]" />
        Use this connection for sending now
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton icon={<Save />} className="sm:w-auto">
          {editing ? "Save changes" : "Save connection"}
        </SubmitButton>
        {editing && (
          <Link href="/admin/settings#email" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Cancel
          </Link>
        )}
      </div>
    </form>
  );
}
