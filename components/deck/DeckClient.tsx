"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { ArrowRight, BarChart3, Check, CheckCircle2, CloudOff, Flame, HelpCircle, Inbox, PencilLine, Search, X } from "lucide-react";
import type { ClientCard } from "@/lib/deck";
import { deviceInfo, enqueue, onPendingChange, startOutbox, trackEvent, uid } from "@/lib/client/outbox";
import { AnimatedNumber } from "@/components/common/AnimatedNumber";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Flashcard } from "./Flashcard";
import { FeedbackSheet, type FeedbackValue } from "./FeedbackSheet";
import { READ_LOCK_ENABLED } from "@/lib/cards/spec";
import { StatementActions, StatementCard, type StatementAnswer } from "./StatementCard";

type Phase = "front" | "back";
type Verdict = "correct" | "needs_improvement" | "unsure";

interface Props {
  deckId: number | null;
  date: string;
  dateLabel: string;
  cards: ClientCard[];
  answered: number[];
  /** answers given today across all sign-ins (including this deck's) */
  answeredTodayTotal: number;
  dailyLimit: number;
  streak: number;
  answeredToday: boolean;
}

export function DeckClient({ deckId, date, dateLabel, cards, answered: initialAnswered, answeredTodayTotal, dailyLimit, streak, answeredToday }: Props) {
  const [answered, setAnswered] = useState(() => new Set(initialAnswered));
  const queue = useMemo(() => cards.filter((c) => !answered.has(c.v)), [cards, answered]);
  const current = queue[0] as ClientCard | undefined;
  const doneCount = cards.length - queue.length;
  // progress counts the whole day: answers from earlier sign-ins + this sign-in's random set
  const earlier = Math.max(0, answeredTodayTotal - initialAnswered.length);
  const dayDone = earlier + doneCount;
  const dayTotal = earlier + cards.length;
  const limitReached = dayTotal >= dailyLimit;

  const [phase, setPhase] = useState<Phase>("front");
  const [knew, setKnew] = useState<boolean | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [exitDir, setExitDir] = useState(1);
  const [stats, setStats] = useState({ knew: 0, missed: 0, flagged: 0 });
  const [pending, setPending] = useState(0);
  const [slowSave, setSlowSave] = useState(false);
  const [online, setOnline] = useState(true);
  const shownAt = useRef<string | null>(null);
  const flippedAt = useRef<string | null>(null);
  // read-time lock (statement cards): attended time since the card was shown, without hidden-tab and idle time
  const activeMs = useRef(0);
  const lastActivity = useRef(0);
  const [remainingMs, setRemainingMs] = useState(0);
  const startedRef = useRef(false);
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

  // a new card is on screen
  useEffect(() => {
    if (!current) return;
    shownAt.current = new Date().toISOString();
    flippedAt.current = null;
    activeMs.current = 0;
    lastActivity.current = Date.now();
    setRemainingMs(current.statement && READ_LOCK_ENABLED ? current.minRead * 1000 : 0);
    setPhase("front");
    setKnew(null);
    if (!startedRef.current && doneCount === 0)
      trackEvent("deck_started", null, { size: cards.length, deck_id: deckId, deck_date: date, answered_earlier_today: earlier, daily_limit: dailyLimit });
    startedRef.current = true;
    trackEvent("card_shown", current.v, { position: dayDone + 1, of: dayTotal, deck_id: deckId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.v]);

  // the read-time clock: runs only while the tab is visible and the user is active (input in the last 60 s)
  useEffect(() => {
    if (!current?.statement) return;
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
        activeMs.current += d;
        if (READ_LOCK_ENABLED) setRemainingMs(Math.max(0, need - activeMs.current));
      }
    }, 250);
    return () => {
      clearInterval(t);
      evs.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [current?.v, current?.statement, current?.minRead]);

  useEffect(() => {
    if (!current && cards.length && !summaryRef.current) {
      summaryRef.current = true;
      trackEvent("deck_summary_viewed", null, { deck_date: date, ...stats });
    }
  }, [current, cards.length, date, stats]);

  const flip = useCallback(() => {
    if (!current || phase !== "front") return;
    flippedAt.current = new Date().toISOString();
    setPhase("back");
    trackEvent("card_flipped", current.v, { ms: shownAt.current ? Date.now() - Date.parse(shownAt.current) : null });
  }, [current, phase]);

  const answerKnew = useCallback(
    (k: boolean) => {
      if (!current || phase !== "back") return;
      setKnew(k);
      trackEvent("knew_answered", current.v, { knew_it: k });
    },
    [current, phase],
  );

  const submit = useCallback(
    (verdict: Verdict, fb?: FeedbackValue) => {
      if (!current || knew === null) return;
      enqueue("/api/reviews", {
        clientEventId: uid(),
        versionId: current.v,
        deckDate: date,
        deckId,
        knewIt: knew,
        verdict,
        shownAt: shownAt.current,
        flippedAt: flippedAt.current,
        answeredAt: new Date().toISOString(),
        device: deviceInfo(),
        feedback: fb ? { category: fb.category, suggestedText: fb.suggestedText || null, comment: fb.comment || null } : null,
      });
      setStats((s) => ({ knew: s.knew + (knew ? 1 : 0), missed: s.missed + (knew ? 0 : 1), flagged: s.flagged + (verdict === "needs_improvement" ? 1 : 0) }));
      setExitDir(knew ? 1 : -1);
      setAnswered((prev) => new Set(prev).add(current.v));
    },
    [current, knew, date, deckId],
  );

  /** Statement cards: Known / New earn the card's weight; Incorrect needs a reason and goes to review. */
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
        shownAt: shownAt.current,
        flippedAt: null,
        answeredAt: new Date().toISOString(),
        activeMs: Math.round(activeMs.current),
        device: deviceInfo(),
        feedback: fb ? { category: fb.category, suggestedText: fb.suggestedText || null, comment: fb.comment || null } : null,
      });
      setStats((s) => ({ knew: s.knew + (kind === "new" ? 0 : 1), missed: s.missed + (kind === "new" ? 1 : 0), flagged: s.flagged + (kind === "incorrect" ? 1 : 0) }));
      setExitDir(kind === "new" ? -1 : 1);
      setAnswered((prev) => new Set(prev).add(current.v));
    },
    [current, date, deckId],
  );

  const answerStatement = useCallback(
    (kind: StatementAnswer) => {
      if (!current?.statement || remainingMs > 0) return; // locked until the read time has passed
      trackEvent("statement_answered", current.v, { answer: kind, active_ms: Math.round(activeMs.current) });
      if (kind === "incorrect") {
        setSheetOpen(true);
        trackEvent("feedback_opened", current.v);
        return;
      }
      submitStatement(kind);
    },
    [current, remainingMs, submitStatement],
  );

  const openSheet = useCallback(() => {
    if (!current || knew === null) return;
    setSheetOpen(true);
    trackEvent("feedback_opened", current.v);
  }, [current, knew]);
  const cancelSheet = useCallback(() => {
    setSheetOpen(false);
    if (current) trackEvent("feedback_cancelled", current.v);
  }, [current]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheetOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (current?.statement) {
        if (phase === "front" && (k === " " || k === "enter")) {
          e.preventDefault();
          flip();
        } else if (phase === "back") {
          if (k === "1") answerStatement("known");
          else if (k === "2") answerStatement("new");
          else if (k === "3") answerStatement("incorrect");
        }
        return;
      }
      if (phase === "front" && (k === " " || k === "enter")) {
        e.preventDefault();
        flip();
      } else if (phase === "back") {
        if (k === "arrowright" || k === "y" || k === "1") answerKnew(true);
        else if (k === "arrowleft" || k === "n" || k === "2") answerKnew(false);
        else if (knew !== null && k === "c") submit("correct");
        else if (knew !== null && k === "u") submit("unsure");
        else if (knew !== null && k === "i") openSheet();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, knew, sheetOpen, flip, answerKnew, submit, openSheet, current, answerStatement]);

  const progress = dayTotal ? (dayDone / dayTotal) * 100 : 0;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-5 sm:pt-8">
      {/* header */}
      <div className="mb-5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{dateLabel}</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">Today’s cards</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <AnimatePresence>
            {(!online || slowSave) && (
              <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                <Tooltip>
                  <TooltipTrigger
                    render={<Badge variant="outline" className={cn("h-6 gap-1.5 px-2", !online && "border-warning/30 bg-warning/10 text-warning")} />}
                  >
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
              <AnimatedNumber value={streak + (!answeredToday && doneCount > 0 ? 1 : 0)} />
            </TooltipTrigger>
            <TooltipContent>Daily streak</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {dayTotal > 0 && (
        <div className="mb-6 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={dayDone} aria-valuemin={0} aria-valuemax={dayTotal}>
            <motion.div
              className="h-full rounded-full bg-primary"
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />
          </div>
          <span className="font-mono text-xs font-medium text-muted-foreground tabular-nums">
            {dayDone}/{dayTotal}
          </span>
        </div>
      )}

      {cards.length === 0 ? (
        answeredTodayTotal >= dailyLimit ? <Summary total={dailyLimit} stats={stats} resumed limitReached /> : <EmptyState />
      ) : !current ? (
        <Summary total={dayTotal} stats={stats} resumed={initialAnswered.length > 0} limitReached={limitReached} />
      ) : (
        <>
          <div className="relative">
            {queue.length > 1 && (
              <div aria-hidden className="absolute inset-x-4 -bottom-2 h-full rounded-2xl bg-card/80 shadow-card ring-1 ring-foreground/[0.06]" />
            )}
            {queue.length > 2 && <div aria-hidden className="absolute inset-x-8 -bottom-4 h-full rounded-2xl bg-card/50 ring-1 ring-foreground/[0.05]" />}
            <AnimatePresence mode="popLayout" initial={false} custom={exitDir}>
              <motion.div
                key={current.v}
                custom={exitDir}
                variants={{
                  enter: { opacity: 0, y: 28, scale: 0.96 },
                  center: { opacity: 1, y: 0, scale: 1 },
                  exit: (d: number) => ({ opacity: 0, x: d * 360, rotate: d * 10, transition: { duration: 0.32 } }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="relative"
              >
                {current.statement ? (
                  <StatementCard card={current} position={dayDone + 1} total={dayTotal} remainingMs={remainingMs} flipped={phase === "back"} onFlip={flip} />
                ) : (
                  <Flashcard
                    card={current}
                    flipped={phase === "back"}
                    canSwipe={phase === "back"}
                    onFlip={flip}
                    onSwipe={answerKnew}
                    position={dayDone + 1}
                    total={dayTotal}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* actions */}
          <div className="mt-9">
            {current.statement && phase === "back" ? (
              <StatementActions locked={remainingMs > 0} remainingMs={remainingMs} onAnswer={answerStatement} />
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                {phase === "front" ? (
                  <motion.div key="reveal" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                    <Button size="lg" className="h-12 w-full text-[15px] shadow-sm" onClick={flip} data-testid="reveal">
                      Reveal answer
                      <Kbd className="hide-touch ml-1 bg-primary-foreground/15 text-primary-foreground">Space</Kbd>
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="answer"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-5"
                  >
                    <section aria-labelledby="q-knew">
                      <StepHeading id="q-knew" step={1} title="Did you know it?">
                        <span className="hide-touch">
                          <KbdGroup>
                            <Kbd>←</Kbd>
                            <Kbd>→</Kbd>
                          </KbdGroup>
                        </span>
                        <span className="hide-mouse">or swipe the card</span>
                      </StepHeading>
                      <div className="grid grid-cols-2 gap-2.5">
                        <ChoiceButton active={knew === false} tone="danger" onClick={() => answerKnew(false)} testId="knew-no">
                          <X /> Not yet
                        </ChoiceButton>
                        <ChoiceButton active={knew === true} tone="success" onClick={() => answerKnew(true)} testId="knew-yes">
                          <Check /> Knew it
                        </ChoiceButton>
                      </div>
                    </section>
                    <AnimatePresence>
                      {knew !== null && (
                        <motion.section
                          aria-labelledby="q-verdict"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <StepHeading id="q-verdict" step={2} title="Is the card content correct?">
                            <span className="hide-touch">
                              <KbdGroup>
                                <Kbd>C</Kbd>
                                <Kbd>I</Kbd>
                                <Kbd>U</Kbd>
                              </KbdGroup>
                            </span>
                          </StepHeading>
                          <div className="grid grid-cols-3 gap-2">
                            <VerdictButton tone="success" onClick={() => submit("correct")} testId="verdict-correct" icon={<CheckCircle2 />}>
                              Correct
                            </VerdictButton>
                            <VerdictButton tone="warning" onClick={openSheet} testId="verdict-improve" icon={<PencilLine />}>
                              Needs fix
                            </VerdictButton>
                            <VerdictButton tone="neutral" onClick={() => submit("unsure")} testId="verdict-unsure" icon={<HelpCircle />}>
                              Not sure
                            </VerdictButton>
                          </div>
                        </motion.section>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
          <FeedbackSheet
            open={sheetOpen}
            originalText={current.back}
            onCancel={cancelSheet}
            onSubmit={(v) => {
              setSheetOpen(false);
              if (current.statement) submitStatement("incorrect", v);
              else submit("needs_improvement", v);
              toast.success("Suggestion sent", { description: "Reviewers will see it in their triage queue." });
            }}
          />
        </>
      )}
    </div>
  );
}

function StepHeading({ id, step, title, children }: { id: string; step: number; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <h2 id={id} className="flex items-center gap-2 text-sm font-medium">
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted font-mono text-[11px] text-muted-foreground">{step}</span>
        {title}
      </h2>
      <span className="text-xs text-muted-foreground">{children}</span>
    </div>
  );
}

function ChoiceButton({
  active,
  tone,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  tone: "success" | "danger";
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  const idle =
    tone === "success"
      ? "bg-card hover:border-success/40 hover:bg-success/[0.06] [&_svg]:text-success"
      : "bg-card hover:border-destructive/40 hover:bg-destructive/[0.06] [&_svg]:text-destructive";
  const on = tone === "success" ? "border-success bg-success text-background" : "border-destructive bg-destructive text-background";
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      className={cn(
        "inline-flex h-12 items-center justify-center gap-2 rounded-lg border text-[15px] font-medium shadow-card transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-[18px]",
        active ? on : idle,
      )}
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
    >
      {children}
    </motion.button>
  );
}

function VerdictButton({
  tone,
  onClick,
  icon,
  children,
  testId,
}: {
  tone: "success" | "warning" | "neutral";
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  testId: string;
}) {
  const t = {
    success: "hover:border-success/40 hover:bg-success/[0.06] [&_svg]:text-success",
    warning: "hover:border-warning/50 hover:bg-warning/[0.08] [&_svg]:text-warning",
    neutral: "hover:border-foreground/20 hover:bg-accent [&_svg]:text-muted-foreground",
  }[tone];
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      className={cn(
        "inline-flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg border bg-card px-2 py-2.5 text-sm font-medium shadow-card transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-row sm:gap-2 [&_svg]:size-[18px]",
        t,
      )}
      onClick={onClick}
      data-testid={testId}
    >
      {icon}
      <span className="leading-tight">{children}</span>
    </motion.button>
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
