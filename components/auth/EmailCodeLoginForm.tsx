"use client";

import { useActionState } from "react";
import { CheckCircle2, LogIn, Send } from "lucide-react";
import type { FormState } from "@/app/actions/auth";
import { loginWithCodeAction, requestLoginCodeAction } from "@/app/actions/recovery";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, FormAlert, SubmitButton, SwitchLink } from "./FormBits";

/** Passwordless sign-in: 1) username or email, 2) the 6-digit code emailed to the account's verified address. */
export function EmailCodeLoginForm({ next, onSwitch }: { next: string; onSwitch: () => void }) {
  const [req, reqAction] = useActionState<FormState, FormData>(requestLoginCodeAction, {});
  const [res, resAction] = useActionState<FormState, FormData>(loginWithCodeAction, {});
  const identifier = res.values?.identifier ?? req.values?.identifier ?? "";
  const step2 = req.step === "verify" || res.step === "verify";
  const rfe = req.fieldErrors ?? {};
  const fe = res.fieldErrors ?? {};

  if (!step2) {
    return (
      <form action={reqAction} className="mt-6 space-y-4" noValidate data-testid="code-login-request">
        <FormAlert message={req.error} />
        <div className="space-y-1.5">
          <Label htmlFor="codeIdentifier">Username or email</Label>
          <Input id="codeIdentifier" name="identifier" className="h-10" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus defaultValue={req.values?.identifier} aria-invalid={!!rfe.identifier || undefined} />
          <FieldError message={rfe.identifier} />
        </div>
        <p className="text-xs text-muted-foreground">We email a 6-digit code to the verified email on the account. No email added yet? Sign in with your password first and add one on your profile.</p>
        <SubmitButton icon={<Send />}>Email me a code</SubmitButton>
        <SwitchLink onClick={onSwitch}>Use your password instead</SwitchLink>
      </form>
    );
  }

  return (
    <form action={resAction} className="mt-6 space-y-4" noValidate data-testid="code-login-verify">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="identifier" value={identifier} />
      {req.success && (
        <Alert className="border-success/25 bg-success/5" role="status">
          <CheckCircle2 className="text-success" />
          <AlertDescription className="text-success">{req.success}</AlertDescription>
        </Alert>
      )}
      <FormAlert message={res.error} />
      <div className="space-y-1.5">
        <Label htmlFor="loginCode">6-digit code</Label>
        <Input id="loginCode" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="h-10 max-w-40 text-center font-mono text-lg tracking-[0.4em]" required autoFocus aria-invalid={!!fe.code || undefined} />
        <FieldError message={fe.code} />
      </div>
      <SubmitButton icon={<LogIn />}>Sign in</SubmitButton>
      <SwitchLink onClick={onSwitch}>Use your password instead</SwitchLink>
    </form>
  );
}
