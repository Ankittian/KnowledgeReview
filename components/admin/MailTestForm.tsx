"use client";

import { useActionState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import type { FormState } from "@/app/actions/auth";
import { sendTestMailAction } from "@/app/actions/mail-admin";
import { FieldError, FormAlert, SubmitButton } from "@/components/auth/FormBits";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

/** Send a test email through a chosen saved connection (it does not have to be the active one). */
export function MailTestForm({ options, defaultTo, defaultId }: { options: { id: string; label: string }[]; defaultTo: string; defaultId: string }) {
  const [state, action] = useActionState<FormState, FormData>(sendTestMailAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate data-testid="mail-test-form">
      <FormAlert message={state.error} />
      {state.success && (
        <Alert className="border-success/25 bg-success/5" role="status" data-testid="mail-test-ok">
          <CheckCircle2 className="text-success" />
          <AlertDescription className="text-success">{state.success}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="mt-conn">Send through</Label>
        <NativeSelect id="mt-conn" name="connectionId" defaultValue={state.values?.connectionId ?? defaultId} className="w-full">
          {options.map((o) => (
            <NativeSelectOption key={o.id} value={o.id}>
              {o.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="mt-to">Send the test email to</Label>
        <Input id="mt-to" name="to" type="email" className="h-10" autoCapitalize="none" spellCheck={false} defaultValue={state.values?.to ?? defaultTo} required aria-invalid={!!fe.to || undefined} />
        <FieldError message={fe.to} />
      </div>
      <SubmitButton icon={<Send />} className="sm:w-auto">
        Send test email
      </SubmitButton>
    </form>
  );
}
