"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, KeyRound, Send } from "lucide-react";
import { changePasswordAction, type FormState } from "@/app/actions/auth";
import { changePasswordWithOtpAction, requestPasswordOtpAction } from "@/app/actions/recovery";
import { FieldError, FormAlert, SubmitButton } from "@/components/auth/FormBits";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <FieldError message={error} />
    </div>
  );
}

function Notice({ message }: { message?: string }) {
  return message ? (
    <Alert className="border-success/25 bg-success/5" role="status">
      <CheckCircle2 className="text-success" />
      <AlertDescription className="text-success">{message}</AlertDescription>
    </Alert>
  ) : null;
}

function WithCurrentPassword() {
  const [state, action] = useActionState<FormState, FormData>(changePasswordAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const fe = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.success) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-4" noValidate>
      <FormAlert message={state.error} />
      <Notice message={state.success} />
      <Field id="currentPassword" label="Current password" error={fe.currentPassword}>
        <Input id="currentPassword" name="currentPassword" type="password" className="h-10" autoComplete="current-password" required aria-invalid={!!fe.currentPassword || undefined} />
      </Field>
      <Field id="newPassword" label="New password" error={fe.newPassword}>
        <Input id="newPassword" name="newPassword" type="password" className="h-10" autoComplete="new-password" required minLength={8} aria-invalid={!!fe.newPassword || undefined} />
      </Field>
      <Field id="confirmPassword" label="Confirm new password" error={fe.confirmPassword}>
        <Input id="confirmPassword" name="confirmPassword" type="password" className="h-10" autoComplete="new-password" required aria-invalid={!!fe.confirmPassword || undefined} />
      </Field>
      <p className="text-xs text-muted-foreground">At least 8 characters. Changing it signs you out on your other devices.</p>
      <SubmitButton icon={<KeyRound />} className="sm:w-auto">
        Update password
      </SubmitButton>
    </form>
  );
}

function WithEmailCode({ email }: { email: string }) {
  const [sent, setSent] = useState<FormState>({});
  const [sending, startSend] = useTransition();
  const [state, action] = useActionState<FormState, FormData>(changePasswordWithOtpAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const fe = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.success) ref.current?.reset();
  }, [state]);

  const send = () =>
    startSend(async () => {
      setSent(await requestPasswordOtpAction());
    });

  const showForm = sent.step === "verify" && !state.success;
  return (
    <div className="space-y-4">
      <Notice message={state.success} />
      {!showForm && !state.success && (
        <div className="space-y-3">
          <FormAlert message={sent.error} />
          <p className="text-sm text-muted-foreground">
            We will email a 6-digit code to <span className="font-medium text-foreground">{email}</span>. No need to remember the old password.
          </p>
          <Button type="button" onClick={send} disabled={sending} data-testid="send-password-code">
            {sending ? <Spinner /> : <Send />}
            Email me a code
          </Button>
        </div>
      )}
      {showForm && (
        <form ref={ref} action={action} className="space-y-4" noValidate data-testid="password-otp-form">
          <Notice message={sent.success} />
          <FormAlert message={state.error ?? sent.error} />
          <Field id="otpCode" label="6-digit code" error={fe.code}>
            <Input id="otpCode" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="h-10 max-w-40 text-center font-mono text-lg tracking-[0.4em]" required autoFocus aria-invalid={!!fe.code || undefined} />
          </Field>
          <Field id="otpNewPassword" label="New password" error={fe.newPassword}>
            <Input id="otpNewPassword" name="newPassword" type="password" className="h-10" autoComplete="new-password" required minLength={8} aria-invalid={!!fe.newPassword || undefined} />
          </Field>
          <Field id="otpConfirmPassword" label="Confirm new password" error={fe.confirmPassword}>
            <Input id="otpConfirmPassword" name="confirmPassword" type="password" className="h-10" autoComplete="new-password" required aria-invalid={!!fe.confirmPassword || undefined} />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton icon={<KeyRound />} className="sm:w-auto">
              Update password
            </SubmitButton>
            <button type="button" onClick={send} disabled={sending} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
              Resend code
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Change password with the current one, or (when a verified email exists) with a code emailed to it. */
export function PasswordCard({ email }: { email: string | null }) {
  const [mode, setMode] = useState<"current" | "email">("current");
  const tab = (m: "current" | "email", label: string, disabled = false) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      disabled={disabled}
      title={disabled ? "Add and verify an email address first" : undefined}
      onClick={() => setMode(m)}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-4">
      <div role="tablist" className="inline-flex gap-1 rounded-lg bg-muted p-1">
        {tab("current", "Use current password")}
        {tab("email", "Use email code", !email)}
      </div>
      {mode === "current" || !email ? <WithCurrentPassword /> : <WithEmailCode email={email} />}
    </div>
  );
}
