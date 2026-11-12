"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Check, CheckCircle2, CloudOff, Flame, HelpCircle, Loader2, PencilLine, PartyPopper, Search, X } from "lucide-react";
import type { ClientCard } from "@/lib/deck";
import { deviceInfo, enqueue, onPendingChange, startOutbox, trackEvent, uid } from "@/lib/client/outbox";
import { Flashcard } from "./Flashcard";
import { FeedbackSheet, type FeedbackValue } from "./FeedbackSheet";

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
    setPhase("front");
    setKnew(null);
    if (!startedRef.current && doneCount === 0)
      trackEvent("deck_started", null, { size: cards.length, deck_id: deckId, deck_date: date, answered_earlier_today: earlier, daily_limit: dailyLimit });
    startedRef.current = true;
    trackEvent("card_shown", current.v, { position: dayDone + 1, of: dayTotal, deck_id: deckId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.v]);

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
  }, [phase, knew, sheetOpen, flip, answerKnew, submit, openSheet]);

  const progress = dayTotal ? (dayDone / dayTotal) * 100 : 0;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-4 sm:pt-8">
      {/* header */}
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wider text-muted uppercase">{dateLabel}</p>
          <h1 className="text-2xl font-bold tracking-tight">Today’s cards</h1>
        </div>
        <div className="flex items-center gap-2">
          {(!online || slowSave) && (
            <span className="chip" title={online ? "Saving your answers" : "Offline: answers are saved on this device and sent when you reconnect"}>
              {online ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudOff className="h-3.5 w-3.5" />}
              {online ? "Saving" : "Offline"}
            </span>
          )}
          <span className="chip bg-warning-soft text-warning" title="Daily streak">
            <Flame className="h-3.5 w-3.5" />
            {streak + (!answeredToday && doneCount > 0 ? 1 : 0)}
          </span>
        </div>
      </div>
      {dayTotal > 0 && (
        <div className="mb-5 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={dayDone} aria-valuemin={0} aria-valuemax={dayTotal}>
            <motion.div className="h-full rounded-full bg-primary" initial={false} animate={{ width: `${progress}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
          </div>
          <span className="text-sm font-semibold text-muted tabular-nums">
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
            {queue.length > 1 && <div aria-hidden className="absolute inset-x-5 -bottom-2.5 h-full rounded-3xl border border-border bg-surface/70" />}
            {queue.length > 2 && <div aria-hidden className="absolute inset-x-10 -bottom-5 h-full rounded-3xl border border-border bg-surface/40" />}
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
                <Flashcard
                  card={current}
                  flipped={phase === "back"}
                  canSwipe={phase === "back"}
                  onFlip={flip}
                  onSwipe={answerKnew}
                  position={dayDone + 1}
                  total={dayTotal}
                />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* actions */}
          <div className="mt-8 space-y-4">
            {phase === "front" ? (
              <button className="btn btn-primary btn-lg w-full" onClick={flip} data-testid="reveal">
                Reveal answer
              </button>
            ) : (
              <>
                <section aria-labelledby="q-knew">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 id="q-knew" className="text-sm font-semibold">
                      Did you know it?
                    </h2>
                    <span className="hide-touch text-xs text-muted">
                      <kbd className="kbd">←</kbd> / <kbd className="kbd">→</kbd>
                    </span>
                    <span className="hide-mouse text-xs text-muted">or swipe the card</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <ChoiceButton active={knew === false} tone="danger" onClick={() => answerKnew(false)} testId="knew-no">
                      <X className="h-5 w-5" /> Not yet
                    </ChoiceButton>
                    <ChoiceButton active={knew === true} tone="success" onClick={() => answerKnew(true)} testId="knew-yes">
                      <Check className="h-5 w-5" /> Knew it
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
                      transition={{ duration: 0.18 }}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <h2 id="q-verdict" className="text-sm font-semibold">
                          Is the card content correct?
                        </h2>
                        <span className="hide-touch text-xs text-muted">
                          <kbd className="kbd">C</kbd> <kbd className="kbd">I</kbd> <kbd className="kbd">U</kbd>
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <button className="btn btn-success btn-lg flex-col gap-1 py-2.5 sm:flex-row" onClick={() => submit("correct")} data-testid="verdict-correct">
                          <CheckCircle2 className="h-5 w-5" />
                          Correct
                        </button>
                        <button className="btn btn-warning btn-lg flex-col gap-1 py-2.5 sm:flex-row" onClick={openSheet} data-testid="verdict-improve">
                          <PencilLine className="h-5 w-5" />
                          <span className="leading-tight">Needs fix</span>
                        </button>
                        <button className="btn btn-outline btn-lg flex-col gap-1 py-2.5 sm:flex-row" onClick={() => submit("unsure")} data-testid="verdict-unsure">
                          <HelpCircle className="h-5 w-5" />
                          Not sure
                        </button>
                      </div>
                    </motion.section>
                  )}
                </AnimatePresence>
              </>
            )}
          </div>
          <FeedbackSheet
            open={sheetOpen}
            originalText={current.back}
            onCancel={cancelSheet}
            onSubmit={(v) => {
              setSheetOpen(false);
              submit("needs_improvement", v);
            }}
          />
        </>
      )}
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
  const on = tone === "success" ? "bg-success text-on-primary ring-success" : "bg-danger text-on-primary ring-danger";
  const off = tone === "success" ? "btn-success" : "btn-danger";
  return (
    <button className={`btn btn-lg ${active ? `${on} ring-2 ring-offset-2 ring-offset-bg` : off}`} onClick={onClick} aria-pressed={active} data-testid={testId}>
      {children}
    </button>
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
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="panel p-6 text-center shadow-card sm:p-8" data-testid="deck-complete">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-success-soft text-success">
        <PartyPopper className="h-8 w-8" />
      </div>
      <h2 className="text-xl font-bold">{limitReached ? "All done for today" : "Deck complete"}</h2>
      <p className="mt-1 text-sm text-muted">
        {answeredNow > 0 && !resumed ? "Thanks! Your answers help keep the knowledge base accurate. " : ""}
        {limitReached
          ? `You’ve reached today’s limit of ${total} card${total === 1 ? "" : "s"}. Sign in tomorrow for a new random set.`
          : "No more cards are available right now. Check back later."}
      </p>
      {answeredNow > 0 && (
        <dl className="mt-6 grid grid-cols-3 gap-3">
          <Stat label="Knew" value={stats.knew} className="text-success" />
          <Stat label="To revisit" value={stats.missed} className="text-danger" />
          <Stat label="Fixes sent" value={stats.flagged} className="text-warning" />
        </dl>
      )}
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <Link href="/progress" className="btn btn-primary btn-lg">
          See my progress
        </Link>
        <Link href="/browse" className="btn btn-outline btn-lg">
          <Search className="h-4 w-4" /> Browse cards
        </Link>
      </div>
    </motion.div>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-2 py-3">
      <dd className={`text-2xl font-bold tabular-nums ${className}`}>{value}</dd>
      <dt className="text-xs font-medium text-muted">{label}</dt>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="panel p-8 text-center">
      <p className="text-lg font-semibold">No cards available yet</p>
      <p className="mt-1 text-sm text-muted">An administrator needs to sync the knowledge base. Check back later.</p>
    </div>
  );
}
