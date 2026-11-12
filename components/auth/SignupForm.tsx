"use client";

import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import { signupAction, type FormState } from "@/app/actions/auth";
import { FieldError, FormAlert, SubmitButton } from "./FormBits";

export function SignupForm({ modules }: { modules: { code: string; name: string }[] }) {
  const [state, action] = useActionState<FormState, FormData>(signupAction, {});
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      <FormAlert message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="displayName">Full name</label>
          <input id="displayName" name="displayName" className="input" autoComplete="name" defaultValue={v.displayName} required />
          <FieldError message={fe.displayName} />
        </div>
        <div>
          <label className="label" htmlFor="username">Username</label>
          <input id="username" name="username" className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} defaultValue={v.username} required />
          <FieldError message={fe.username} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="department">
            Department <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="department" name="department" className="input" defaultValue={v.department} />
          <FieldError message={fe.department} />
        </div>
        <div>
          <label className="label" htmlFor="primaryModule">Main area</label>
          <select id="primaryModule" name="primaryModule" className="input" defaultValue={v.primaryModule ?? ""}>
            <option value="">All areas</option>
            {modules.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name}
              </option>
            ))}
          </select>
          <FieldError message={fe.primaryModule} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" className="input" autoComplete="new-password" required minLength={8} />
          <FieldError message={fe.password} />
        </div>
        <div>
          <label className="label" htmlFor="confirmPassword">Confirm password</label>
          <input id="confirmPassword" name="confirmPassword" type="password" className="input" autoComplete="new-password" required />
          <FieldError message={fe.confirmPassword} />
        </div>
      </div>
      <SubmitButton icon={<UserPlus className="h-4 w-4" />}>Request account</SubmitButton>
    </form>
  );
}
