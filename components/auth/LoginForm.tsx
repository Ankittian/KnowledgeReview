"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { loginAction, type FormState } from "@/app/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormAlert, SubmitButton } from "./FormBits";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormAlert message={state.error} />
      <div className="space-y-1.5">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          name="username"
          className="h-10"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.values?.username}
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" className="h-10" autoComplete="current-password" required />
      </div>
      <SubmitButton icon={<ArrowRight className="order-last" />}>Sign in</SubmitButton>
    </form>
  );
}
