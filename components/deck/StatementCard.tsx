"use client";

import { Check, Lock, PencilLine, BookOpenCheck } from "lucide-react";
import type { ClientCard } from "@/lib/deck";
import { READ_LOCK_ENABLED } from "@/lib/cards/spec";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { LevelChip } from "./LevelChip";

export type StatementAnswer = "known" | "new" | "incorrect";

/** A generated card: a statement to verify, shown whole (title + body). No flip. */
export function StatementCard({
  card,
  position,
  total,
  remainingMs,
}: {
  card: ClientCard;
  position: number;
  total: number;
  remainingMs: number;
}) {
  const lines = card.back.split(/\r?\n/).filter((l) => l.trim());
  const need = card.minRead * 1000;
  const done = need > 0 ? Math.min(1, 1 - remainingMs / need) : 1;
  return (
    <div
      className="flex min-h-[320px] flex-col rounded-2xl bg-card p-5 shadow-card ring-1 ring-foreground/[0.07] sm:p-7"
      data-testid="flashcard"
      data-statement="true"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="max-w-full truncate" title={card.context}>
          {card.context}
        </Badge>
        {card.module && (
          <Badge className="bg-primary/10 text-primary">{card.module}</Badge>
        )}
        {card.level && <LevelChip level={card.level} weight={card.weight} />}
        <span className="ml-auto text-xs font-medium text-muted-foreground tabular-nums">
          {position}/{total}
        </span>
      </div>
      <h2
        className="mt-4 text-lg leading-snug font-bold tracking-tight sm:text-xl"
        data-testid="statement-title"
      >
        {card.front}
      </h2>
      <div
        className="mt-3 max-h-[46dvh] flex-1 space-y-2 overflow-y-auto pr-1 text-[15px] leading-relaxed sm:max-h-[48vh] sm:text-base"
        data-testid="statement-body"
      >
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
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${done * 100}%` }}
            />
          </div>
          <p
            className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"
            data-testid="read-timer"
          >
            {remainingMs > 0 ? (
              <>
                <Lock className="size-3.5" /> Read the card. You can answer
                in {Math.ceil(remainingMs / 1000)}s
              </>
            ) : (
              <>
                <Check className="size-3.5 text-success" /> Ready: choose
                your answer
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/** The three answers. Locked (disabled) until the read time has passed. */
export function StatementActions({
  locked,
  remainingMs,
  onAnswer,
}: {
  locked: boolean;
  remainingMs: number;
  onAnswer: (a: StatementAnswer) => void;
}) {
  const hint = locked
    ? `Unlocks in ${Math.ceil(remainingMs / 1000)}s`
    : undefined;
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
          variant="outline" className="h-auto flex-col gap-1 py-2.5 hover:border-success/40 hover:bg-success/[0.06] [&_svg]:text-success"
          disabled={locked}
          title={hint}
          onClick={() => onAnswer("known")}
          data-testid="answer-known"
        >
          <Check className="size-5" />
          <span className="leading-tight">Known and correct</span>
        </Button>
        <Button
          variant="outline" className="h-auto flex-col gap-1 py-2.5"
          disabled={locked}
          title={hint}
          onClick={() => onAnswer("new")}
          data-testid="answer-new"
        >
          <BookOpenCheck className="size-5" />
          <span className="leading-tight">New to me</span>
        </Button>
        <Button
          variant="outline" className="h-auto flex-col gap-1 py-2.5 hover:border-warning/50 hover:bg-warning/[0.08] [&_svg]:text-warning"
          disabled={locked}
          title={hint}
          onClick={() => onAnswer("incorrect")}
          data-testid="answer-incorrect"
        >
          <PencilLine className="size-5" />
          <span className="leading-tight">Incorrect or incomplete</span>
        </Button>
      </div>
      {locked && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          The answers unlock after the read time so every card is actually read.
        </p>
      )}
    </section>
  );
}
