"use client";

import { useState, useTransition } from "react";
import { Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** Admin: set a temporary password for a user who can't recover by email. Shown once, after a confirmation. */
export function ResetPasswordButton({ action, userId, name }: { action: (fd: FormData) => Promise<{ password?: string; error?: string }>; userId: string; name: string }) {
  const [password, setPassword] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = () => {
    if (!window.confirm(`Set a temporary password for ${name}? They will be signed out everywhere and must change it after signing in.`)) return;
    start(async () => {
      const fd = new FormData();
      fd.set("userId", userId);
      const r = await action(fd);
      if (r.password) setPassword(r.password);
      else toast.error(r.error ?? "Couldn't reset the password.");
    });
  };

  if (password) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-xs" data-testid="temp-password">
        <code className="font-mono font-semibold select-all">{password}</code>
        <button
          type="button"
          aria-label="Copy temporary password"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => navigator.clipboard?.writeText(password).then(() => toast.success("Copied"))}
        >
          <Copy className="size-3.5" />
        </button>
      </span>
    );
  }
  return (
    <Button type="button" variant="ghost" size="sm" onClick={run} disabled={pending} aria-label={`Reset password for ${name}`}>
      {pending ? <Spinner /> : <KeyRound />}
      Reset password
    </Button>
  );
}
