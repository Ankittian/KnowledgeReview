"use client";

import { Database } from "lucide-react";
import type { KbSource } from "@/lib/chat/config"; // type only: config.ts pulls in node:path, which must not reach the browser
import { cn } from "@/lib/utils";

/** Client-side copy of KB_LABELS (lib/chat/config.ts); the server keeps the same texts. */
export const KB_LABEL: Record<KbSource, string> = { spectrumerp: "SpectrumERP", spectrumerp_new: "SpectrumERP-new" };

export type KbReadOnly = "revoked" | "unconfigured";

/** Same wording the send/retry routes answer with (kb_read_only, D17 / D19). */
export const KB_READ_ONLY_TEXT: Record<KbReadOnly, string> = {
  revoked: "You no longer have access to SpectrumERP-new.",
  unconfigured: "SpectrumERP-new is not available right now.",
};

export interface KbReadOnlyState {
  reason: KbReadOnly;
  text: string;
}

export const readOnlyState = (reason: KbReadOnly | null | undefined): KbReadOnlyState | null =>
  reason ? { reason, text: KB_READ_ONLY_TEXT[reason] } : null;

/** A failed API call, keeping the machine-readable `code` (and `reason`) the chat routes add to their 403s. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly reason?: string,
  ) {
    super(message);
  }
}

/** Marks a chat that uses SpectrumERP-new; the default KB gets no badge so nothing changes for everyone else. */
export function KbBadge({ kb, className }: { kb: KbSource; className?: string }) {
  if (kb !== "spectrumerp_new") return null;
  return (
    <span
      className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-4xl bg-primary/10 px-2 text-xs font-medium whitespace-nowrap text-primary", className)}
      data-testid="chat-kb"
    >
      <Database className="size-3" aria-hidden />
      {KB_LABEL[kb]}
    </span>
  );
}
