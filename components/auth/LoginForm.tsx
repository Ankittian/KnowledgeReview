"use client";

import { useActionState } from "react";
import { LogIn } from "lucide-react";
import { loginAction, type FormState } from "@/app/actions/auth";
import { FormAlert, SubmitButton } from "./FormBits";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormAlert message={state.error} />
      <div>
        <label className="label" htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          className="input"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.values?.username}
          autoFocus
        />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      <SubmitButton icon={<LogIn className="h-4 w-4" />}>Sign in</SubmitButton>
    </form>
  );
}
