"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Mail, MailCheck } from "lucide-react";
import type { FormState } from "@/app/actions/auth";
import { requestEmailOtpAction, verifyEmailOtpAction } from "@/app/actions/profile";
import { FieldError, FormAlert, SubmitButton } from "@/components/auth/FormBits";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Notice({ message }: { message?: string }) {
  return message ? (
    <Alert className="border-success/25 bg-success/5" role="status">
      <CheckCircle2 className="text-success" />
      <AlertDescription className="text-success">{message}</AlertDescription>
    </Alert>
  ) : null;
}


export function EmailCard({ email }: { email: string | null }) {
  const [reqState, reqAction] = useActionState<FormState, FormData>(requestEmailOtpAction, {});
  const [verState, verAction] = useActionState<FormState, FormData>(verifyEmailOtpAction, {});
  const [changing, setChanging] = useState(false);

  const verified = verState.success && !verState.fieldErrors;
  const pendingEmail = reqState.values?.email ?? "";
  const awaitingCode = !verified && (reqState.step === "verify" || verState.step === "verify");
  const rfe = reqState.fieldErrors ?? {};
  const vfe = verState.fieldErrors ?? {};

  if (verified) {
    return (
      <div className="space-y-3" data-testid="email-verified">
        <Notice message={verState.success} />
      </div>
    );
  }

  if (awaitingCode) {
    return (
      <form action={verAction} className="space-y-4" noValidate data-testid="email-code-form">
        <input type="hidden" name="email" value={verState.values?.email ?? pendingEmail} />
        <Notice message={reqState.success} />
        <FormAlert message={verState.error ?? reqState.error} />
        <div className="space-y-1.5">
          <Label htmlFor="emailCode">6-digit code sent to {verState.values?.email ?? pendingEmail}</Label>
          <Input id="emailCode" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="h-10 max-w-40 text-center font-mono text-lg tracking-[0.4em]" required autoFocus aria-invalid={!!vfe.code || undefined} />
          <FieldError message={vfe.code} />
        </div>
        <FieldError message={vfe.email} />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton icon={<MailCheck />} className="sm:w-auto">
            Verify email
          </SubmitButton>
          <button type="button" className="text-sm text-muted-foreground underline-offset-4 hover:underline" onClick={() => window.location.reload()}>
            Use a different address
          </button>
        </div>
      </form>
    );
  }

  if (email && !changing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3" data-testid="email-current">
        <p className="flex items-center gap-2 text-sm">
          <MailCheck className="size-4 text-success" />
          <span className="font-medium">{email}</span>
          <span className="text-xs text-muted-foreground">verified</span>
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setChanging(true)}>
          Change email
        </Button>
      </div>
    );
  }

  return (
    <form action={reqAction} className="space-y-4" noValidate data-testid="email-request-form">
      <FormAlert message={reqState.error} />
      <div className="space-y-1.5">
        <Label htmlFor="email">{email ? "New email address" : "Email address"}</Label>
        <Input id="email" name="email" type="email" className="h-10" autoComplete="email" autoCapitalize="none" spellCheck={false} required defaultValue={reqState.values?.email} aria-invalid={!!rfe.email || undefined} />
        <FieldError message={rfe.email} />
      </div>
      {email && (
        <div className="space-y-1.5">
          <Label htmlFor="emailCurrentPassword">Current password</Label>
          <Input id="emailCurrentPassword" name="currentPassword" type="password" className="h-10" autoComplete="current-password" required aria-invalid={!!rfe.currentPassword || undefined} />
          <FieldError message={rfe.currentPassword} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">We email a 6-digit code to confirm it is yours. The email is saved only after you enter it.</p>
      <div className="flex items-center gap-3">
        <SubmitButton icon={<Mail />} className="sm:w-auto">
          Send code
        </SubmitButton>
        {email && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setChanging(false)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
