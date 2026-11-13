"use client";

import { motion, useReducedMotion } from "motion/react";
import { Check, Lock, PencilLine, BookOpenCheck, MousePointerClick } from "lucide-react";
import type { ClientCard } from "@/lib/deck";
import { READ_LOCK_ENABLED } from "@/lib/cards/spec";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { LevelChip } from "./LevelChip";

export type StatementAnswer = "known" | "new" | "incorrect";

const face =
  "backface-hidden [grid-area:1/1] flex min-h-[320px] flex-col rounded-2xl bg-card p-5 shadow-float ring-1 ring-foreground/[0.08] sm:min-h-[340px] sm:p-7";

/**
 * A generated card: the question (statement title) on the front. Tap or press Space to flip it and read the
 * description on the back. The answer buttons (StatementActions) appear after the flip.
 */
export function StatementCard({
  card,
  position,
  total,
  remainingMs,
  flipped,
  onFlip,
}: {
  card: ClientCard;
  position?: number;
  total?: number;
  remainingMs: number;
  flipped: boolean;
  onFlip: () => void;
}) {
  const reduce = useReducedMotion();
  const lines = card.back.split(/\r?\n/).filter((l) => l.trim());
  const need = card.minRead * 1000;
  const done = need > 0 ? Math.min(1, 1 - remainingMs / need) : 1;

  const Meta = () => (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="secondary" className="max-w-full truncate" title={card.context}>
        {card.context}
      </Badge>
      {card.module && <Badge className="bg-primary/10 text-primary">{card.module}</Badge>}
      {card.level && <LevelChip level={card.level} weight={card.weight} />}
      {position !== undefined && total !== undefined && (
        <span className="ml-auto text-xs font-medium text-muted-foreground tabular-nums">
          {position}/{total}
        </span>
      )}
    </div>
  );

  return (
    <div className="perspective" data-testid="flashcard" data-statement="true">
      <motion.div
        className="preserve-3d grid cursor-pointer"
        animate={reduce ? undefined : { rotateY: flipped ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
        onClick={() => !flipped && onFlip()}
        role="button"
        tabIndex={-1}
        aria-label={flipped ? "Description side" : "Question side. Reveal the description"}
      >
        {/* front: the question */}
        <div className={`${face} group`} style={reduce ? { visibility: flipped ? "hidden" : "visible" } : undefined} aria-hidden={flipped}>
          <Meta />
          <div className="flex flex-1 items-center py-6">
            <h2 className="text-lg leading-snug font-bold tracking-tight whitespace-pre-line text-balance sm:text-xl" data-testid="statement-title">
              {card.front}
            </h2>
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <MousePointerClick className="size-3.5 transition-transform group-hover:-rotate-12" />
            <span className="hide-mouse">Tap the card to read the description</span>
            <span className="hide-touch inline-flex items-center gap-1.5">
              Click or press <Kbd>Space</Kbd> to reveal
            </span>
          </p>
        </div>

        {/* back: the description */}
        <div
          className={face}
          style={reduce ? { visibility: flipped ? "visible" : "hidden" } : { transform: "rotateY(180deg)" }}
          aria-hidden={!flipped}
        >
          <Meta />
          <p className="mt-4 text-[11px] font-medium tracking-wider text-primary uppercase">Description</p>
          <div className="mt-2 max-h-[42dvh] flex-1 space-y-2 overflow-y-auto pr-1 text-[15px] leading-relaxed sm:max-h-[44vh] sm:text-base" data-testid="statement-body">
            {lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
          {READ_LOCK_ENABLED && (
            <div className="mt-4" aria-live="polite">
              <div
                className="h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Read time"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(done * 100)}
              >
                <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${done * 100}%` }} />
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="read-timer">
                {remainingMs > 0 ? (
                  <>
                    <Lock className="size-3.5" /> Read the card. You can answer in {Math.ceil(remainingMs / 1000)}s
                  </>
                ) : (
                  <>
                    <Check className="size-3.5 text-success" /> Ready: choose your answer
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/** The three answers. Locked (disabled) until the read time has passed. */
export function StatementActions({
  locked,
  remainingMs,
  onAnswer,
  selected = null,
}: {
  locked: boolean;
  remainingMs: number;
  onAnswer: (a: StatementAnswer) => void;
  /** the answer chosen so far, highlighted on its button */
  selected?: StatementAnswer | null;
}) {
  const hint = locked ? `Unlocks in ${Math.ceil(remainingMs / 1000)}s` : undefined;
  return (
    <section aria-labelledby="q-statement">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="q-statement" className="text-sm font-semibold">
          Is this statement right, and did you know it?
        </h2>
        <span className="hide-touch text-xs text-muted-foreground">
          <KbdGroup>
            <Kbd>1</Kbd>
            <Kbd>2</Kbd>
            <Kbd>3</Kbd>
          </KbdGroup>
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Button
          variant="outline"
          className={cn("h-auto flex-col gap-1 py-2.5 hover:border-success/40 hover:bg-success/[0.06] [&_svg]:text-success", selected === "known" && "border-success bg-success/10")}
          aria-pressed={selected === "known"}
          disabled={locked}
          title={hint}
          onClick={() => onAnswer("known")}
          data-testid="answer-known"
        >
          <Check className="size-5" />
          <span className="leading-tight">Known and correct</span>
        </Button>
        <Button variant="outline" className={cn("h-auto flex-col gap-1 py-2.5", selected === "new" && "border-primary bg-primary/10")} aria-pressed={selected === "new"} disabled={locked} title={hint} onClick={() => onAnswer("new")} data-testid="answer-new">
          <BookOpenCheck className="size-5" />
          <span className="leading-tight">New to me</span>
        </Button>
        <Button
          variant="outline"
          className={cn("h-auto flex-col gap-1 py-2.5 hover:border-warning/50 hover:bg-warning/[0.08] [&_svg]:text-warning", selected === "incorrect" && "border-warning bg-warning/10")}
          aria-pressed={selected === "incorrect"}
          disabled={locked}
          title={hint}
          onClick={() => onAnswer("incorrect")}
          data-testid="answer-incorrect"
        >
          <PencilLine className="size-5" />
          <span className="leading-tight">Incorrect or incomplete</span>
        </Button>
      </div>
      {locked && <p className="mt-2 text-center text-xs text-muted-foreground">The answers unlock after the read time so every card is actually read.</p>}
    </section>
  );
}
