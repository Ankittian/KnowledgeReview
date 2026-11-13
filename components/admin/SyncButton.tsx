"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { syncKnowledgeBase, type SyncState } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

function SyncSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Spinner /> : <RefreshCw />}
      {pending ? "Syncing…" : "Sync now"}
    </Button>
  );
}

export function SyncButton() {
  const [state, action] = useActionState<SyncState>(syncKnowledgeBase, {});

  useEffect(() => {
    if (state.error) toast.error(state.error);
    else if (state.message) toast.success(state.message);
  }, [state]);

  return (
    <form action={action} className="space-y-3">
      <SyncSubmit />
      {state.error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </p>
      )}
      {state.message && (
        <p className="flex items-start gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          {state.message}
        </p>
      )}
    </form>
  );
}
