"use client";

import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import { signupAction, type FormState } from "@/app/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { FieldError, FormAlert, SubmitButton } from "./FormBits";

function Field({ id, label, optional, error, children }: { id: string; label: string; optional?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children}
      <FieldError message={error} />
    </div>
  );
}

export function SignupForm({ modules }: { modules: { code: string; name: string }[] }) {
  const [state, action] = useActionState<FormState, FormData>(signupAction, {});
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      <FormAlert message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="displayName" label="Full name" error={fe.displayName}>
          <Input id="displayName" name="displayName" className="h-10" autoComplete="name" defaultValue={v.displayName} aria-invalid={!!fe.displayName || undefined} required />
        </Field>
        <Field id="username" label="Username" error={fe.username}>
          <Input
            id="username"
            name="username"
            className="h-10"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={v.username}
            aria-invalid={!!fe.username || undefined}
            required
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="department" label="Department" optional error={fe.department}>
          <Input id="department" name="department" className="h-10" defaultValue={v.department} aria-invalid={!!fe.department || undefined} />
        </Field>
        <Field id="primaryModule" label="Main area" error={fe.primaryModule}>
          <NativeSelect id="primaryModule" name="primaryModule" size="lg" className="w-full" defaultValue={v.primaryModule ?? ""}>
            <NativeSelectOption value="">All areas</NativeSelectOption>
            {modules.map((m) => (
              <NativeSelectOption key={m.code} value={m.code}>
                {m.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="password" label="Password" error={fe.password}>
          <Input id="password" name="password" type="password" className="h-10" autoComplete="new-password" required minLength={8} aria-invalid={!!fe.password || undefined} />
        </Field>
        <Field id="confirmPassword" label="Confirm password" error={fe.confirmPassword}>
          <Input id="confirmPassword" name="confirmPassword" type="password" className="h-10" autoComplete="new-password" required aria-invalid={!!fe.confirmPassword || undefined} />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">Use at least 8 characters for your password.</p>
      <SubmitButton icon={<UserPlus />}>Request account</SubmitButton>
    </form>
  );
}
