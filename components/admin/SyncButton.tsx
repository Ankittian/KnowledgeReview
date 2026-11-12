"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { syncKnowledgeBase, type SyncState } from "@/app/actions/admin";
import { FormAlert, SubmitButton } from "@/components/auth/FormBits";

export function SyncButton() {
  const [state, action] = useActionState<SyncState>(syncKnowledgeBase, {});
  return (
    <form action={action} className="mt-4 space-y-3">
      <SubmitButton className="btn btn-primary" icon={<RefreshCw className="h-4 w-4" />}>
        Sync now
      </SubmitButton>
      <FormAlert message={state.error} />
      {state.message && <p className="rounded-xl bg-success-soft px-3.5 py-2.5 text-sm text-success">{state.message}</p>}
    </form>
  );
}
