"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { RotateCcw } from "lucide-react";
import { startOutbox, trackEvent } from "@/lib/client/outbox";
import type { ClientCard } from "@/lib/deck";
import { Badge } from "@/components/ui/badge";

export function BrowseCard({ card }: { card: ClientCard }) {
  const [flipped, setFlipped] = useState(false);
  const reduce = useReducedMotion();
  const face =
    "backface-hidden [grid-area:1/1] flex min-h-52 flex-col rounded-xl bg-card p-4 text-left shadow-card ring-1 ring-foreground/[0.07] transition-shadow group-hover:shadow-float group-hover:ring-foreground/[0.12]";
  return (
    <button
      type="button"
      className="group perspective block w-full rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-pressed={flipped}
      aria-label={flipped ? "Show question" : "Show answer"}
      onClick={() => {
        if (!flipped) {
          startOutbox();
          trackEvent("browse_flip", card.v);
        }
        setFlipped((f) => !f);
      }}
    >
      <motion.div
        className="preserve-3d grid"
        animate={reduce ? undefined : { rotateY: flipped ? 180 : 0 }}
        whileHover={reduce ? undefined : { y: -2 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
      >
        <div className={face} style={reduce ? { visibility: flipped ? "hidden" : "visible" } : undefined}>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs text-muted-foreground">{card.context}</span>
            {card.module && <Badge className="ml-auto shrink-0 bg-primary/10 text-primary">{card.module}</Badge>}
          </div>
          <p className="mt-3 flex-1 text-[15px] leading-snug font-medium whitespace-pre-line">{card.front}</p>
          <span className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors group-hover:text-primary">
            <RotateCcw className="size-3" /> Flip for answer
          </span>
        </div>
        <div className={face} style={reduce ? { visibility: flipped ? "visible" : "hidden" } : { transform: "rotateY(180deg)" }}>
          <span className="text-[11px] font-medium tracking-wider text-primary uppercase">Answer</span>
          <p className="mt-2 max-h-56 flex-1 overflow-y-auto text-sm leading-relaxed whitespace-pre-line">{card.back}</p>
        </div>
      </motion.div>
    </button>
  );
}
