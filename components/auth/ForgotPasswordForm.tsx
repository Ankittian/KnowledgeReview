"use client";

import { useActionState } from "react";
import { CheckCircle2, KeyRound, Send } from "lucide-react";
import type { FormState } from "@/app/actions/auth";
import { requestPasswordResetAction, resetPasswordAction } from "@/app/actions/recovery";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, FormAlert, SubmitButton } from "./FormBits";

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <FieldError message={error} />
    </div>
  );
}

/** Forgot password: 1) username or email, 2) the emailed code and a new password. */
export function ForgotPasswordForm() {
  const [req, reqAction] = useActionState<FormState, FormData>(requestPasswordResetAction, {});
  const [res, resAction] = useActionState<FormState, FormData>(resetPasswordAction, {});
  const identifier = res.values?.identifier ?? req.values?.identifier ?? "";
  const step2 = req.step === "reset" || res.step === "reset";
  const rfe = req.fieldErrors ?? {};
  const fe = res.fieldErrors ?? {};

  if (!step2) {
    return (
      <form action={reqAction} className="mt-6 space-y-4" noValidate data-testid="forgot-request-form">
        <FormAlert message={req.error} />
        <Field id="identifier" label="Username or email" error={rfe.identifier}>
          <Input id="identifier" name="identifier" className="h-10" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus defaultValue={req.values?.identifier} aria-invalid={!!rfe.identifier || undefined} />
        </Field>
        <p className="text-xs text-muted-foreground">We email a 6-digit code to the verified email on the account. No verified email on your account? Ask an administrator to reset it.</p>
        <SubmitButton icon={<Send />}>Send code</SubmitButton>
      </form>
    );
  }

  return (
    <form action={resAction} className="mt-6 space-y-4" noValidate data-testid="forgot-reset-form">
      <input type="hidden" name="identifier" value={identifier} />
      {req.success && (
        <Alert className="border-success/25 bg-success/5" role="status">
          <CheckCircle2 className="text-success" />
          <AlertDescription className="text-success">{req.success}</AlertDescription>
        </Alert>
      )}
      <FormAlert message={res.error} />
      <Field id="code" label="6-digit code" error={fe.code}>
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="h-10 max-w-40 text-center font-mono text-lg tracking-[0.4em]" required autoFocus aria-invalid={!!fe.code || undefined} />
      </Field>
      <Field id="newPassword" label="New password" error={fe.newPassword}>
        <Input id="newPassword" name="newPassword" type="password" className="h-10" autoComplete="new-password" required minLength={8} aria-invalid={!!fe.newPassword || undefined} />
      </Field>
      <Field id="confirmPassword" label="Confirm new password" error={fe.confirmPassword}>
        <Input id="confirmPassword" name="confirmPassword" type="password" className="h-10" autoComplete="new-password" required aria-invalid={!!fe.confirmPassword || undefined} />
      </Field>
      <p className="text-xs text-muted-foreground">At least 8 characters. You will be signed out everywhere and asked to sign in again.</p>
      <SubmitButton icon={<KeyRound />}>Reset password</SubmitButton>
    </form>
  );
}
