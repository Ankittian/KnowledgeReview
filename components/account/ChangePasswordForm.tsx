"use client";

import { useActionState, useEffect, useRef } from "react";
import { CheckCircle2, KeyRound } from "lucide-react";
import { changePasswordAction, type FormState } from "@/app/actions/auth";
import { FieldError, FormAlert, SubmitButton } from "@/components/auth/FormBits";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <FieldError message={error} />
    </div>
  );
}

export function ChangePasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(changePasswordAction, {});
  const ref = useRef<HTMLFormElement>(null);
  const fe = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.success) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="space-y-4" noValidate>
      <FormAlert message={state.error} />
      {state.success && (
        <Alert className="border-success/25 bg-success/5" role="status">
          <CheckCircle2 className="text-success" />
          <AlertDescription className="text-success">{state.success}</AlertDescription>
        </Alert>
      )}
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
