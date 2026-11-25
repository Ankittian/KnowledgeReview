"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { ArrowRight, BarChart3, ChevronLeft, ChevronRight, CloudOff, Flame, Inbox, Search } from "lucide-react";
import type { ClientCard, DeckAnswer } from "@/lib/deck";
import { deviceInfo, enqueue, onPendingChange, startOutbox, trackEvent, uid } from "@/lib/client/outbox";
import { AnimatedNumber } from "@/components/common/AnimatedNumber";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { FeedbackSheet, type FeedbackValue } from "./FeedbackSheet";
import { READ_LOCK_ENABLED } from "@/lib/cards/spec";
import { StatementActions, StatementCard, type StatementAnswer } from "./StatementCard";

interface Props {
  deckId: number | null;
  date: string;
  dateLabel: string;
  cards: ClientCard[];
  answered: number[];
  /** the latest answer to each answered card (version id): shown on the card and open to change */
  answers: Record<number, DeckAnswer>;
  /** answers given today across all sign-ins (including this deck's) */
  answeredTodayTotal: number;
  dailyLimit: number;
  streak: number;
  answeredToday: boolean;
}

/** Where the cards sit in the stack: the open card in front, its neighbours behind, smaller, faded and blurred. */
const SLOT = {
  "-1": { x: "-34%", y: 14, scale: 0.86, opacity: 0.5, filter: "blur(3px)" },
  "0": { x: "0%", y: 0, scale: 1, opacity: 1, filter: "blur(0px)" },
  "1": { x: "34%", y: 14, scale: 0.86, opacity: 0.5, filter: "blur(3px)" },
} as const;
type Offset = -1 | 0 | 1;

export function DeckClient({ deckId, date, dateLabel, cards, answered: initialAnswered, answers: initialAnswers, answeredTodayTotal, dailyLimit, streak, answeredToday }: Props) {
  const [answers, setAnswers] = useState<Record<number, StatementAnswer>>(() => ({ ...initialAnswers }));
  // the deck is a row of cards you move along; it opens on the first card that has no answer yet
  const [index, setIndex] = useState(() => Math.max(0, cards.findIndex((c) => !initialAnswers[c.v])));
  // cards whose description side is showing (answered cards always are)
  const [flipped, setFlipped] = useState<Set<number>>(() => new Set(initialAnswered));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const [slowSave, setSlowSave] = useState(false);
  const [online, setOnline] = useState(true);

  const current = cards[index] as ClientCard | undefined;
  const answeredCount = cards.filter((c) => answers[c.v]).length;
  const allDone = cards.length > 0 && answeredCount === cards.length;
  /** the open card already has an answer: it is being looked at again or changed, so there is no read timer */
  const editing = !!current && !!answers[current.v];
  const revealed = useCallback((c: ClientCard) => flipped.has(c.v) || !!answers[c.v], [flipped, answers]);
  // progress counts the whole day: answers from earlier sign-ins + this sign-in's set
  const earlier = Math.max(0, answeredTodayTotal - initialAnswered.length);
  const dayDone = earlier + answeredCount;
  const dayTotal = earlier + cards.length;
  const limitReached = dayTotal >= dailyLimit;
  const stats = useMemo(() => {
    const given = cards.map((c) => answers[c.v]).filter(Boolean);
    return { knew: given.filter((a) => a !== "new").length, missed: given.filter((a) => a === "new").length, flagged: given.filter((a) => a === "incorrect").length };
  }, [cards, answers]);

  // per card, kept while you move around the deck: when it was first shown and how long it has been attended to
  const shownAt = useRef(new Map<number, string>());
  const activeMs = useRef(new Map<number, number>());
  const lastActivity = useRef(0);
  const [remainingMs, setRemainingMs] = useState(0);
  const startedRef = useRef(false);
  const shownTracked = useRef(new Set<number>());
  const summaryRef = useRef(false);

  useEffect(() => {
    startOutbox();
    const off = onPendingChange(setPending);
    const upd = () => setOnline(navigator.onLine);
    upd();
    window.addEventListener("online", upd);
    window.addEventListener("offline", upd);
    return () => {
      off();
      window.removeEventListener("online", upd);
      window.removeEventListener("offline", upd);
    };
  }, []);

  // only surface "Saving" when the outbox stays non-empty (slow / flaky network), not on every quick flush
  useEffect(() => {
    if (pending === 0) {
      setSlowSave(false);
      return;
    }
    const t = setTimeout(() => setSlowSave(true), 1500);
    return () => clearTimeout(t);
  }, [pending]);

  // a card comes to the front
  useEffect(() => {
    if (!current) return;
    if (!shownAt.current.has(current.v)) shownAt.current.set(current.v, new Date().toISOString());
    lastActivity.current = Date.now();
    setRemainingMs(!answers[current.v] && READ_LOCK_ENABLED ? Math.max(0, current.minRead * 1000 - (activeMs.current.get(current.v) ?? 0)) : 0);
    if (!startedRef.current && answeredCount === 0)
      trackEvent("deck_started", null, { size: cards.length, deck_id: deckId, deck_date: date, answered_earlier_today: earlier, daily_limit: dailyLimit });
    startedRef.current = true;
    if (!shownTracked.current.has(current.v)) {
      shownTracked.current.add(current.v);
      trackEvent("card_shown", current.v, { position: index + 1, of: cards.length, deck_id: deckId, revisit: !!answers[current.v] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.v]);

  // once a card has an answer there is no timer any more
  useEffect(() => {
    if (editing) setRemainingMs(0);
  }, [editing]);

  // the read-time clock (cards without an answer yet): runs only while the tab is visible and the user is active (input in the last 60 s)
  useEffect(() => {
    if (!current || editing) return;
    const v = current.v;
    const need = current.minRead * 1000;
    const bump = () => {
      lastActivity.current = Date.now();
    };
    const evs = ["pointermove", "pointerdown", "keydown", "scroll", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    let last = Date.now();
    const t = setInterval(() => {
      const now = Date.now();
      const d = Math.min(now - last, 1000);
      last = now;
      if (document.visibilityState === "visible" && now - lastActivity.current <= 60_000) {
        const total = (activeMs.current.get(v) ?? 0) + d;
        activeMs.current.set(v, total);
        if (READ_LOCK_ENABLED) setRemainingMs(Math.max(0, need - total));
      }
    }, 250);
    return () => {
      clearInterval(t);
      evs.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [current?.v, current?.minRead, editing]);

  useEffect(() => {
    if (allDone && !summaryRef.current) {
      summaryRef.current = true;
      trackEvent("deck_summary_viewed", null, { deck_date: date, ...stats });
    }
  }, [allDone, date, stats]);

  const summaryEl = useRef<HTMLDivElement>(null);
  const wasDone = useRef(allDone);
  useEffect(() => {
    if (allDone && !wasDone.current) summaryEl.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    wasDone.current = allDone;
  }, [allDone]);

  const go = useCallback(
    (delta: number) => {
      if (sheetOpen) return;
      setIndex((i) => Math.min(cards.length - 1, Math.max(0, i + delta)));
    },
    [cards.length, sheetOpen],
  );

  const flip = useCallback(() => {
    if (!current || revealed(current)) return;
    setFlipped((prev) => new Set(prev).add(current.v));
    const shown = shownAt.current.get(current.v);
    trackEvent("card_flipped", current.v, { ms: shown ? Date.now() - Date.parse(shown) : null });
  }, [current, revealed]);

  /** Known / New earn the card weight; Incorrect or incomplete needs a reason, goes to review and earns double. Changing an answer sends it as an edit. */
  const submitStatement = useCallback(
    (kind: StatementAnswer, fb?: FeedbackValue) => {
      if (!current) return;
      enqueue("/api/reviews", {
        clientEventId: uid(),
        versionId: current.v,
        deckDate: date,
        deckId,
        knewIt: kind !== "new",
        verdict: kind === "incorrect" ? "needs_improvement" : "correct",
        shownAt: shownAt.current.get(current.v) ?? null,
        flippedAt: null,
        answeredAt: new Date().toISOString(),
        activeMs: Math.round(activeMs.current.get(current.v) ?? 0),
        device: deviceInfo(),
        feedback: fb ? { category: fb.category, suggestedText: fb.suggestedText || null, comment: fb.comment || null } : null,
        ...(editing ? { edit: true } : {}),
      });
      setAnswers((prev) => ({ ...prev, [current.v]: kind }));
      if (editing) {
        toast.success("Answer updated", { description: current.context });
        return;
      }
      // a first answer moves on to the next card that has none (after this one, else any other)
      const next = cards.findIndex((c, i) => i > index && !answers[c.v]);
      const other = cards.findIndex((c) => c.v !== current.v && !answers[c.v]);
      const target = next >= 0 ? next : other;
      if (target >= 0) setIndex(target);
    },
    [current, date, deckId, editing, cards, index, answers],
  );

  const answerStatement = useCallback(
    (kind: StatementAnswer) => {
      if (!current || !revealed(current)) return;
      if (!editing && remainingMs > 0) return; // locked until the read time has passed (first answers only)
      if (editing && answers[current.v] === kind && kind !== "incorrect") return; // already the answer
      trackEvent("statement_answered", current.v, { answer: kind, active_ms: Math.round(activeMs.current.get(current.v) ?? 0), edit: editing });
      if (kind === "incorrect") {
        setSheetOpen(true);
        trackEvent("feedback_opened", current.v);
        return;
      }
      submitStatement(kind);
    },
    [current, revealed, editing, remainingMs, answers, submitStatement],
  );

  const cancelSheet = useCallback(() => {
    setSheetOpen(false);
    if (current) trackEvent("feedback_cancelled", current.v);
  }, [current]);

  // keyboard: Space reveals, 1 / 2 / 3 answer, ← → move along the deck
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheetOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "arrowleft") {
        e.preventDefault();
        go(-1);
        return;
      }
      if (k === "arrowright") {
        e.preventDefault();
        go(1);
        return;
      }
      if (!current) return;
      if (!revealed(current)) {
        if (k === " " || k === "enter") {
          e.preventDefault();
          flip();
        }
      } else if (k === "1") answerStatement("known");
      else if (k === "2") answerStatement("new");
      else if (k === "3") answerStatement("incorrect");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen, current, revealed, flip, go, answerStatement]);

  const progress = dayTotal ? (dayDone / dayTotal) * 100 : 0;
  // the open card and its neighbours, drawn as a stack
  const slots = ([-1, 0, 1] as Offset[]).map((off) => ({ off, card: cards[index + off] as ClientCard | undefined })).filter((s): s is { off: Offset; card: ClientCard } => !!s.card);

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem-6rem)] w-full max-w-4xl flex-col px-4 pt-3 [--card-h:clamp(288px,calc((100dvh_-_31.5rem)_/_1.18),456px)] sm:pt-4 md:-mb-10 md:h-[calc(100dvh-3.5rem)] md:[--card-h:clamp(288px,calc((100dvh_-_22rem)_/_1.18),504px)]">
      <div className="mx-auto w-full max-w-xl shrink-0">
        {/* header */}
        <div className="mb-2 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{dateLabel}</p>
            <h1 className="text-xl font-semibold tracking-tight">Today’s cards</h1>
          </div>
          <div className="flex items-center gap-1.5">
            <AnimatePresence>
              {(!online || slowSave) && (
                <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                  <Tooltip>
                    <TooltipTrigger render={<Badge variant="outline" className={cn("h-6 gap-1.5 px-2", !online && "border-warning/30 bg-warning/10 text-warning")} />}>
                      {online ? <Spinner className="size-3" /> : <CloudOff />}
                      {online ? "Saving" : "Offline"}
                    </TooltipTrigger>
                    <TooltipContent>{online ? "Saving your answers" : "Offline: answers are saved on this device and sent when you reconnect"}</TooltipContent>
                  </Tooltip>
                </motion.span>
              )}
            </AnimatePresence>
            <Tooltip>
              <TooltipTrigger render={<Badge variant="outline" className="h-6 gap-1 px-2 font-semibold tabular-nums" />}>
                <Flame className="text-warning" />
                <AnimatedNumber value={streak + (!answeredToday && answeredCount > 0 ? 1 : 0)} />
              </TooltipTrigger>
              <TooltipContent>Daily streak</TooltipContent>
            </Tooltip>
          </div>
        </div>
        {dayTotal > 0 && (
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={dayDone} aria-valuemin={0} aria-valuemax={dayTotal}>
              <motion.div className="h-full rounded-full bg-primary" initial={false} animate={{ width: `${progress}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
            </div>
            <span className="font-mono text-xs font-medium text-muted-foreground tabular-nums">
              {dayDone}/{dayTotal}
            </span>
          </div>
        )}
      </div>

      {cards.length === 0 || !current ? (
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto pb-4">
          <div className="mx-auto max-w-xl">{answeredTodayTotal >= dailyLimit ? <Summary total={dailyLimit} stats={stats} resumed limitReached /> : <EmptyState />}</div>
        </div>
      ) : (
        <>
          {/* the deck: the open card in front, the cards either side of it behind, faded and blurred */}
          <div className="thin-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="flex min-h-full flex-col justify-center py-2" data-testid="deck-stack">
          <div className="relative">
            <div className="grid items-start">
              <AnimatePresence initial={false}>
                {slots.map(({ off, card }) => (
                  <motion.div
                    key={card.v}
                    className={cn("mx-auto w-full max-w-xl [grid-area:1/1]", off !== 0 && "cursor-pointer")}
                    style={{ zIndex: off === 0 ? 20 : 10 }}
                    initial={{ opacity: 0, x: `${off * 55}%`, y: 14, scale: off === 0 ? 0.92 : 0.8, filter: "blur(6px)" }}
                    animate={SLOT[String(off) as "-1" | "0" | "1"]}
                    exit={{ opacity: 0, scale: 0.8, filter: "blur(6px)" }}
                    transition={{ type: "spring", stiffness: 260, damping: 30 }}
                    onClick={off !== 0 ? () => go(off) : undefined}
                    aria-hidden={off !== 0 || undefined}
                    data-testid={off !== 0 ? (off < 0 ? "deck-side-prev" : "deck-side-next") : "deck-current"}
                  >
                    {off === 0 ? (
                      <StatementCard card={card} position={index + 1} total={cards.length} remainingMs={remainingMs} flipped={revealed(card)} onFlip={flip} noTimer={editing} />
                    ) : (
                      <StatementCard card={card} preview noTimer position={index + off + 1} total={cards.length} remainingMs={0} flipped={revealed(card)} onFlip={() => {}} />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* move along the deck (on wide screens the arrows sit over the faded side cards) */}
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={index === 0}
              aria-label="Previous card"
              data-testid="card-prev"
              className="absolute top-1/2 left-2 z-30 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border bg-card text-foreground shadow-card transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30 lg:flex [&_svg]:size-5"
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              disabled={index === cards.length - 1}
              aria-label="Next card"
              data-testid="card-next"
              className="absolute top-1/2 right-2 z-30 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border bg-card text-foreground shadow-card transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30 lg:flex [&_svg]:size-5"
            >
              <ChevronRight />
            </button>
          </div>
          </div>
          {allDone && (
            <div ref={summaryEl} className="mx-auto max-w-xl pt-4 pb-4">
              <Summary total={dayTotal} stats={stats} resumed={initialAnswered.length > 0} limitReached={limitReached} />
            </div>
          )}
          </div>

          <div className="mx-auto min-h-[8.5rem] w-full max-w-xl shrink-0 pt-0 pb-2 mb-[calc(var(--card-h)_*_0.18)]">
            <div className="mb-3 flex items-center justify-center gap-6 lg:hidden">
              <button
                type="button"
                onClick={() => go(-1)}
                disabled={index === 0}
                aria-label="Previous card"
                className="flex size-9 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-card transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30 lg:hidden [&_svg]:size-4"
              >
                <ChevronLeft />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                disabled={index === cards.length - 1}
                aria-label="Next card"
                className="flex size-9 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-card transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30 lg:hidden [&_svg]:size-4"
              >
                <ChevronRight />
              </button>
            </div>

            {/* actions */}
            {!revealed(current) ? (
              <Button size="lg" className="mt-8 h-11 w-full text-[15px] shadow-sm" onClick={flip} data-testid="reveal">
              Reveal answer
            </Button>
            ) : (
              <>
                <StatementActions locked={!editing && remainingMs > 0} remainingMs={remainingMs} onAnswer={answerStatement} selected={answers[current.v] ?? null} weight={current.weight} />
              </>
            )}
          </div>

          <FeedbackSheet
            open={sheetOpen}
            originalText={current.back}
            onCancel={cancelSheet}
            onSubmit={(v) => {
              setSheetOpen(false);
              submitStatement("incorrect", v);
              toast.success("Suggestion sent", { description: "Reviewers will see it in their triage queue." });
            }}
          />
        </>
      )}
    </div>
  );
}

/** Check mark drawn with pathLength on completion. */
function DoneMark() {
  return (
    <div className="relative mx-auto mb-5 flex size-16 items-center justify-center">
      <motion.span
        className="absolute inset-0 rounded-full bg-success/12"
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
      />
      <svg viewBox="0 0 24 24" className="relative size-8 text-success" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }} />
      </svg>
    </div>
  );
}

function Summary({
  total,
  stats,
  resumed,
  limitReached,
}: {
  total: number;
  stats: { knew: number; missed: number; flagged: number };
  resumed: boolean;
  limitReached: boolean;
}) {
  const answeredNow = stats.knew + stats.missed;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 24 }}
      className="rounded-2xl bg-card p-6 text-center shadow-float ring-1 ring-foreground/[0.08] sm:p-8"
      data-testid="deck-complete"
    >
      <DoneMark />
      <h2 className="text-xl font-semibold tracking-tight">{limitReached ? "All done for today" : "Deck complete"}</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-pretty text-muted-foreground">
        {answeredNow > 0 && !resumed ? "Thanks! Your answers help keep the knowledge base accurate. " : ""}
        {limitReached
          ? `You’ve reached today’s limit of ${total} card${total === 1 ? "" : "s"}. Sign in tomorrow for a new random set.`
          : "No more cards are available right now. Check back later."}
        {answeredNow > 0 && " You can still move back through the cards above to change an answer."}
      </p>
      {answeredNow > 0 && (
        <dl className="mt-6 grid grid-cols-3 divide-x rounded-xl bg-muted/50 py-3 ring-1 ring-foreground/[0.05]">
          <Stat label="Knew" value={stats.knew} className="text-success" />
          <Stat label="To revisit" value={stats.missed} className="text-destructive" />
          <Stat label="Fixes sent" value={stats.flagged} className="text-warning" />
        </dl>
      )}
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <Link href="/progress" className={cn(buttonVariants({ size: "lg" }), "h-10")}>
          <BarChart3 /> See my progress
        </Link>
        <Link href="/browse" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-10")}>
          <Search /> Browse cards
        </Link>
      </div>
    </motion.div>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className: string }) {
  // counts up from zero shortly after the summary appears
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShown(value), 250);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <div className="flex flex-col-reverse px-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-2xl font-semibold tabular-nums", className)}>
        <AnimatedNumber value={shown} />
      </dd>
    </div>
  );
}

function EmptyState() {
  return (
    <Empty className="rounded-2xl border border-dashed bg-card/50 py-14">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle>No cards available yet</EmptyTitle>
        <EmptyDescription>An administrator needs to sync the knowledge base. Check back later.</EmptyDescription>
      </EmptyHeader>
      <Link href="/browse" className={buttonVariants({ variant: "outline", size: "sm" })}>
        Browse cards <ArrowRight />
      </Link>
    </Empty>
  );
}
