"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ChevronLeft, Flame, Layers, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface FlashcardWidgetProps {
  /** Number of cards remaining in today's deck */
  remaining: number;
  /** Total cards in today's deck */
  total: number;
  /** Current streak */
  streak: number;
  /** Whether the user has answered at least one card today */
  answeredToday: boolean;
  /** Preview of the first unanswered card front text, if any */
  nextCardFront?: string | null;
}

export function FlashcardWidget({ remaining, total, streak, nextCardFront }: FlashcardWidgetProps) {
  const [collapsed, setCollapsed] = useState(false);

  const done = total - remaining;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = remaining === 0;
  const circ = 87.96; // circumference of r=14 circle

  return (
    <motion.aside
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 340, damping: 32 }}
      className="hidden xl:flex shrink-0 self-start sticky top-4"
    >
      <AnimatePresence mode="wait" initial={false}>
        {collapsed ? (
          /* ── Collapsed: icon pill ── */
          <motion.div
            key="collapsed"
            initial={{ opacity: 0, scale: 0.85, x: 16 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.85, x: 16 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="flex flex-col items-center gap-2 rounded-2xl border bg-card p-2 shadow-card ring-1 ring-foreground/[0.07]"
          >
            {/* Expand */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={() => setCollapsed(false)}
                    className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors hover:bg-primary/20"
                    aria-label="Expand flashcard widget"
                  />
                }
              >
                <Layers className="size-4" />
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">Today's Flashcards</TooltipContent>
            </Tooltip>

            {/* Progress ring */}
            {total > 0 && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <div
                      className="relative flex size-9 cursor-default items-center justify-center"
                      aria-label={`${done} of ${total} cards done`}
                    />
                  }
                >
                  <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90 size-9">
                    <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3.5" className="stroke-muted" />
                    <motion.circle
                      cx="18" cy="18" r="14" fill="none" strokeWidth="3.5"
                      strokeLinecap="round"
                      className="stroke-primary"
                      strokeDasharray={circ}
                      initial={false}
                      animate={{ strokeDashoffset: circ * (1 - pct / 100) }}
                      transition={{ type: "spring", stiffness: 120, damping: 20 }}
                    />
                  </svg>
                  <span className="relative text-[9px] font-bold tabular-nums text-primary">{pct}%</span>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">{done}/{total} cards done</TooltipContent>
              </Tooltip>
            )}

            {/* Streak */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <div
                    className="flex size-9 cursor-default flex-col items-center justify-center gap-0.5"
                    aria-label={`${streak}-day streak`}
                  />
                }
              >
                <Flame className="size-4 text-warning" />
                <span className="text-[10px] font-bold tabular-nums">{streak}</span>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">{streak}-day streak</TooltipContent>
            </Tooltip>

            {/* Go to flashcards */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Link
                    href="/today"
                    className="flex size-9 items-center justify-center rounded-xl border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
                    aria-label="Go to flashcards"
                  />
                }
              >
                <ArrowRight className="size-4" />
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                {allDone ? "Review deck" : `${remaining} card${remaining === 1 ? "" : "s"} left`}
              </TooltipContent>
            </Tooltip>
          </motion.div>
        ) : (
          /* ── Expanded: full panel ── */
          <motion.div
            key="expanded"
            initial={{ opacity: 0, scale: 0.95, x: 16 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.95, x: 16 }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
            className="w-64 overflow-hidden rounded-2xl border bg-card shadow-card ring-1 ring-foreground/[0.07]"
          >
            {/* Header */}
            <div className="flex items-center gap-2 border-b bg-muted/40 px-3.5 py-2.5">
              <Layers className="size-4 text-primary" />
              <span className="flex-1 text-sm font-semibold">Today's Flashcards</span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      onClick={() => setCollapsed(true)}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label="Collapse flashcard widget"
                    />
                  }
                >
                  <ChevronLeft className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent className="text-xs">Collapse</TooltipContent>
              </Tooltip>
            </div>

            <div className="space-y-3 p-3.5">
              {/* Progress bar */}
              {total > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{done} of {total} done</span>
                    <span className="font-mono tabular-nums">{pct}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <motion.div
                      className="h-full rounded-full bg-primary"
                      initial={false}
                      animate={{ width: `${pct}%` }}
                      transition={{ type: "spring", stiffness: 120, damping: 20 }}
                    />
                  </div>
                </div>
              )}

              {/* Streak */}
              <div className="flex items-center gap-1.5 text-sm">
                <Flame className="size-4 text-warning" />
                <span className="font-semibold tabular-nums">{streak}</span>
                <span className="text-xs text-muted-foreground">day streak</span>
              </div>

              {/* Next card preview */}
              {!allDone && nextCardFront ? (
                <div className="rounded-xl border bg-background px-3 py-2.5 text-sm shadow-sm ring-1 ring-foreground/[0.05]">
                  <p className="mb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Next card</p>
                  <p className="line-clamp-3 leading-snug font-medium">{nextCardFront}</p>
                </div>
              ) : allDone ? (
                <div className="rounded-xl border border-success/30 bg-success/8 px-3 py-2.5 text-sm text-success">
                  ✓ All cards done for today!
                </div>
              ) : (
                <div className="rounded-xl border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                  No cards available yet.
                </div>
              )}

              {/* CTA */}
              <Link
                href="/today"
                className={cn(buttonVariants({ size: "sm", variant: allDone ? "outline" : "default" }), "w-full")}
              >
                <Layers className="size-3.5" />
                {allDone ? "Review deck" : remaining > 0 ? `${remaining} card${remaining === 1 ? "" : "s"} left` : "Go to flashcards"}
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}

/* Mobile version: compact banner shown above the chat */
export function FlashcardBanner({ remaining, total, streak }: Pick<FlashcardWidgetProps, "remaining" | "total" | "streak">) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || remaining === 0) return null;
  const done = total - remaining;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="xl:hidden mx-3 mb-2 flex items-center gap-3 rounded-xl border bg-card px-3 py-2 shadow-sm ring-1 ring-foreground/[0.06]">
      <Layers className="size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium">Flashcards</span>
          <span className="text-muted-foreground tabular-nums">{done}/{total} · {pct}%</span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Flame className="size-3.5 text-warning" />
        <span className="text-xs font-semibold tabular-nums">{streak}</span>
      </div>
      <Link href="/today" className={cn(buttonVariants({ size: "sm", variant: "default" }), "h-7 shrink-0 px-2.5 text-xs")}>
        Review
      </Link>
      <Button variant="ghost" size="icon" className="size-6 shrink-0" onClick={() => setDismissed(true)} aria-label="Dismiss">
        <X className="size-3" />
      </Button>
    </div>
  );
}
