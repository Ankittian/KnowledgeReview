"use client";

import { useRef } from "react";
import { buttonVariants } from "@/components/ui/button";
import type { BrowseKind } from "@/lib/browse-topics";
import { cn } from "@/lib/utils";

const OPTIONS: { kind: BrowseKind; label: string; hint: string }[] = [
  { kind: "form", label: "Form questions", hint: "Cards about one form" },
  {
    kind: "common",
    label: "Common questions",
    hint: "Cards that apply across forms, or to a whole flow or area",
  },
];

/**
 * Two buttons above the Browse filters: Form questions | Common questions. The choice is a hidden `kind` field of the
 * surrounding GET form, so pressing Enter in the search box keeps it. A click sets the field and submits the form, which
 * reloads the page with the other filters kept (and shows the form dropdown only for Form questions). Clicking the active
 * button turns the choice off (all cards).
 */
export function KindToggle({ kind, counts }: { kind: BrowseKind | ""; counts: Record<BrowseKind, number> }) {
  const field = useRef<HTMLInputElement>(null);

  function choose(next: BrowseKind | "") {
    if (!field.current) return;
    field.current.value = next;
    field.current.form?.requestSubmit();
  }

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Kind of question">
      <input ref={field} type="hidden" name="kind" defaultValue={kind} />
      {OPTIONS.map((o) => {
        const active = kind === o.kind;
        const empty = counts[o.kind] === 0;
        return (
          <button
            key={o.kind}
            type="button"
            aria-pressed={active}
            disabled={empty && !active}
            title={empty ? "No cards of this kind yet" : o.hint}
            onClick={() => choose(active ? "" : o.kind)}
            className={cn(buttonVariants({ variant: active ? "default" : "outline" }), "h-9 flex-1 px-4 sm:flex-none")}
          >
            {o.label}
            <span className={cn("ml-1.5 text-xs tabular-nums", active ? "opacity-80" : "text-muted-foreground")}>
              {counts[o.kind].toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
