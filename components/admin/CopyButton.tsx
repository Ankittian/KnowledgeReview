"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** Copies `text` to the clipboard. Falls back to a hidden textarea where the Clipboard API is unavailable (plain-HTTP LAN access). */
async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error("copy failed");
}

/** Small "Copy" text button. */
export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", className)}
      onClick={async () => {
        try {
          await copyText(text);
          setDone(true);
          toast.success("Copied");
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error("Could not copy. Select the text and copy it by hand.");
        }
      }}
    >
      {done ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
      {done ? "Copied" : label}
    </button>
  );
}
