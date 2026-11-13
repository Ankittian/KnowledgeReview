"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { ArrowDown, CheckCircle2, X } from "lucide-react";
import { deviceInfo, enqueue, startOutbox, trackEvent, uid } from "@/lib/client/outbox";
import type { ClientCard } from "@/lib/deck";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LevelChip } from "@/components/deck/LevelChip";
import { StatementActions, StatementCard, type StatementAnswer } from "@/components/deck/StatementCard";

export type BrowseItem = ClientCard & { viewed: boolean };

/**
 * The browse list. Clicking a card expands it across the full row into the same layout as the daily deck.
 * Answering records the answer (it scores on the leaderboard), collapses the card back into the grid and marks
 * it viewed with a green overlay.
 */
export function BrowseGrid({ cards }: { cards: BrowseItem[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [seen, setSeen] = useState<Set<number>>(() => new Set(cards.filter((c) => c.viewed).map((c) => c.v)));

  const answered = (id: number) => setSeen((prev) => new Set(prev).add(id));
  const router = useRouter();

  // Cards answered on the daily page (or elsewhere) come from the server: merge them in whenever the list changes,
  // and re-fetch once on arrival so a cached page never hides a recent answer.
  useEffect(() => {
    setSeen((prev) => {
      const next = new Set(prev);
      cards.forEach((c) => c.viewed && next.add(c.v));
      return next.size === prev.size ? prev : next;
    });
  }, [cards]);
  useEffect(() => {
    router.refresh();
  }, [router]);

  const open = cards.find((c) => c.v === openId) ?? null;

  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <li key={c.v}>
            <BrowseCardPreview card={c} viewed={seen.has(c.v)} hidden={c.v === openId} onOpen={() => setOpenId(c.v)} />
          </li>
        ))}
      </ul>
      <BrowseModal
        card={open}
        viewed={open ? seen.has(open.v) : false}
        onClose={() => setOpenId(null)}
        onAnswered={() => {
          if (open) answered(open.v);
          setOpenId(null);
        }}
      />
    </>
  );
}

/** Popup over a dimmed, blurred backdrop; the card grows from its grid position. Click outside or press Esc to close. */
function BrowseModal({
  card,
  viewed,
  onClose,
  onAnswered,
}: {
  card: BrowseItem | null;
  viewed: boolean;
  onClose: () => void;
  onAnswered: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [card, onClose]);

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {card && (
        <motion.div
          key="browse-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:items-center"
          onClick={(e) => e.target === e.currentTarget && onClose()}
          role="dialog"
          aria-modal="true"
        >
          <BrowseExpanded key={card.v} card={card} viewed={viewed} onClose={onClose} onAnswered={onAnswered} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Collapsed: the question and its tags. Viewed cards get a green overlay. */
export function BrowseCardPreview({
  card,
  viewed,
  hidden = false,
  onOpen,
}: {
  card: ClientCard;
  viewed: boolean;
  hidden?: boolean;
  onOpen: () => void;
}) {
  return (
    <motion.div layoutId={hidden ? undefined : `browse-card-${card.v}`} className={`relative h-full rounded-xl ${hidden ? "invisible" : ""}`}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open card: ${card.front.split("\n")[0]}`}
        className="group flex h-full min-h-52 w-full flex-col rounded-xl bg-card p-4 text-left shadow-card ring-1 ring-foreground/[0.07] transition-shadow outline-none hover:-translate-y-0.5 hover:shadow-float hover:ring-foreground/[0.12] focus-visible:ring-3 focus-visible:ring-ring/50"
        data-testid="browse-statement"
        data-viewed={viewed}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="max-w-[70%] truncate" title={card.context}>
            <span className="truncate">{card.context}</span>
          </Badge>
          {card.module && <Badge className="bg-primary/10 text-primary">{card.module}</Badge>}
          {card.level && <LevelChip level={card.level} weight={card.weight} />}
        </div>
        <p className="mt-3 line-clamp-4 flex-1 text-[15px] leading-snug font-semibold whitespace-pre-line">{card.front}</p>
        <span className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors group-hover:text-primary">
          <ArrowDown className="size-3" /> {viewed ? "Viewed · open to read again" : "Open to read and answer"}
        </span>
      </button>
      {viewed && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-0 rounded-xl bg-success/10 ring-2 ring-success" data-testid="viewed-overlay" />
          <span className="pointer-events-none absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-[11px] font-semibold text-background">
            <CheckCircle2 className="size-3" /> Viewed
          </span>
        </>
      )}
    </motion.div>
  );
}

/**
 * The expanded card: the same flip card, Reveal button and answer buttons as the daily deck. An answer is recorded
 * once per card (it scores like a daily answer) and then the card collapses back.
 */
export function BrowseExpanded({
  card,
  viewed,
  onClose,
  onAnswered,
}: {
  card: BrowseItem;
  viewed: boolean;
  onClose: () => void;
  onAnswered: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const shownAt = useRef(new Date().toISOString());

  const flip = () => {
    if (flipped) return;
    startOutbox();
    trackEvent("browse_flip", card.v);
    setFlipped(true);
  };

  const answer = (kind: StatementAnswer) => {
    startOutbox();
    enqueue("/api/reviews", {
      clientEventId: uid(),
      source: "browse",
      versionId: card.v,
      deckDate: null,
      deckId: null,
      knewIt: kind !== "new",
      verdict: kind === "incorrect" ? "needs_improvement" : "correct",
      shownAt: shownAt.current,
      flippedAt: null,
      answeredAt: new Date().toISOString(),
      device: deviceInfo(),
      feedback: null,
    });
    if (kind !== "incorrect" && card.weight > 0) toast.success(`+${card.weight} point${card.weight === 1 ? "" : "s"}`, { description: card.context });
    else toast("Answer saved", { description: card.context });
    onAnswered();
  };

  return (
    <motion.div
      layoutId={`browse-card-${card.v}`}
      transition={{ type: "spring", stiffness: 380, damping: 36 }}
      className="w-full max-w-xl rounded-2xl bg-background p-4 shadow-float sm:p-5"
      data-testid="browse-expanded"
    >
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
        <div className="mb-2 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close card">
            <X /> Close
          </Button>
        </div>
      <StatementCard card={card} remainingMs={0} flipped={flipped} onFlip={flip} />

      <div className="mt-9">
        {!flipped ? (
          <Button size="lg" className="h-12 w-full text-[15px] shadow-sm" onClick={flip} data-testid="reveal">
            Reveal answer
          </Button>
        ) : viewed ? (
          <p className="rounded-xl bg-success/10 px-4 py-3 text-center text-sm text-success ring-1 ring-success/30">
            You’ve already answered this card. Its points are counted.
          </p>
        ) : (
          <StatementActions locked={false} remainingMs={0} onAnswer={answer} />
        )}
      </div>
      </motion.div>
    </motion.div>
  );
}
