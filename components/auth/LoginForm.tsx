"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { loginAction, type FormState } from "@/app/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmailCodeLoginForm } from "./EmailCodeLoginForm";
import { FormAlert, SubmitButton, SwitchLink } from "./FormBits";

function PasswordLoginForm({ next, notice, onSwitch }: { next: string; notice?: string; onSwitch: () => void }) {
  const [state, action] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {notice && (
        <p role="status" className="rounded-md border border-success/25 bg-success/5 px-3 py-2 text-sm text-success">
          {notice}
        </p>
      )}
      <FormAlert message={state.error} />
      <div className="space-y-1.5">
        <Label htmlFor="username">Username or email</Label>
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
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Forgot password?
          </Link>
        </div>
        <Input id="password" name="password" type="password" className="h-10" autoComplete="current-password" required />
      </div>
      <SubmitButton icon={<ArrowRight className="order-last" />}>Sign in</SubmitButton>
      <SwitchLink onClick={onSwitch}>Use an email code instead</SwitchLink>
    </form>
  );
}

/** Sign in with a password; a small link below switches to a one-time code emailed to the account's verified address. */
export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [mode, setMode] = useState<"password" | "code">("password");
  return mode === "password" ? (
    <PasswordLoginForm next={next} notice={notice} onSwitch={() => setMode("code")} />
  ) : (
    <EmailCodeLoginForm next={next} onSwitch={() => setMode("password")} />
  );
}
