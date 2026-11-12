"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { startOutbox, trackEvent } from "@/lib/client/outbox";
import type { ClientCard } from "@/lib/deck";

export function BrowseCard({ card }: { card: ClientCard }) {
  const [flipped, setFlipped] = useState(false);
  const reduce = useReducedMotion();
  const face = "backface-hidden [grid-area:1/1] flex min-h-52 flex-col rounded-2xl border border-border bg-surface p-4 text-left";
  return (
    <button
      type="button"
      className="perspective block w-full rounded-2xl text-left"
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
      <motion.div className="preserve-3d grid" animate={reduce ? undefined : { rotateY: flipped ? 180 : 0 }} transition={{ type: "spring", stiffness: 260, damping: 26 }}>
        <div className={face} style={reduce ? { visibility: flipped ? "hidden" : "visible" } : undefined}>
          <span className="truncate text-xs font-medium text-muted">{card.context}</span>
          <p className="mt-3 flex-1 text-[15px] leading-snug font-semibold whitespace-pre-line">{card.front}</p>
          <span className="mt-3 text-xs font-medium text-primary">Tap to flip</span>
        </div>
        <div className={face} style={reduce ? { visibility: flipped ? "visible" : "hidden" } : { transform: "rotateY(180deg)" }}>
          <span className="text-xs font-semibold tracking-wider text-primary uppercase">Answer</span>
          <p className="mt-2 max-h-56 flex-1 overflow-y-auto text-sm leading-relaxed whitespace-pre-line">{card.back}</p>
        </div>
      </motion.div>
    </button>
  );
}
