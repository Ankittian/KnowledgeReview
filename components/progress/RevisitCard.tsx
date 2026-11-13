"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** A card the user missed, with an expandable answer. */
export function RevisitCard({ context, front, back }: { context: string; front: string; back: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-full flex-col rounded-xl bg-card p-4 shadow-card ring-1 ring-foreground/[0.07]">
      <p className="truncate text-xs text-muted-foreground">{context}</p>
      <p className="mt-1.5 text-[15px] leading-snug font-medium whitespace-pre-line">{front}</p>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-3 inline-flex w-fit items-center gap-1 rounded text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {open ? "Hide answer" : "Show answer"}
        <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <p className="mt-2 border-l-2 border-primary/30 pl-3 text-sm leading-relaxed whitespace-pre-line text-muted-foreground">{back}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
