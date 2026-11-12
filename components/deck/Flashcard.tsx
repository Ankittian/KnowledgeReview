"use client";

import { motion, useMotionValue, useReducedMotion, useTransform, type PanInfo } from "motion/react";
import { RotateCcw } from "lucide-react";
import type { ClientCard } from "@/lib/deck";

interface Props {
  card: ClientCard;
  flipped: boolean;
  canSwipe: boolean;
  onFlip: () => void;
  onSwipe: (knew: boolean) => void;
  position: number;
  total: number;
}

const SWIPE_DISTANCE = 90;
const SWIPE_VELOCITY = 600;

export function Flashcard({ card, flipped, canSwipe, onFlip, onSwipe, position, total }: Props) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 0, 220], [-10, 0, 10]);
  const knewOpacity = useTransform(x, [20, SWIPE_DISTANCE], [0, 1]);
  const missOpacity = useTransform(x, [-SWIPE_DISTANCE, -20], [1, 0]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > SWIPE_DISTANCE || info.velocity.x > SWIPE_VELOCITY) onSwipe(true);
    else if (info.offset.x < -SWIPE_DISTANCE || info.velocity.x < -SWIPE_VELOCITY) onSwipe(false);
  };

  const face =
    "backface-hidden [grid-area:1/1] flex min-h-[300px] flex-col rounded-3xl border border-border bg-surface p-5 shadow-card sm:min-h-[340px] sm:p-7";

  const Chips = () => (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="chip max-w-full truncate">{card.context}</span>
      {card.module && <span className="chip bg-primary-soft text-primary">{card.module}</span>}
      <span className="ml-auto text-xs font-medium text-muted tabular-nums">
        {position}/{total}
      </span>
    </div>
  );

  return (
    <motion.div
      className="relative touch-pan-y select-none"
      style={{ x, rotate }}
      drag={canSwipe ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.65}
      onDragEnd={onDragEnd}
      data-testid="flashcard"
    >
      {canSwipe && (
        <>
          <motion.div
            style={{ opacity: knewOpacity }}
            className="pointer-events-none absolute top-6 left-6 z-10 -rotate-12 rounded-xl border-2 border-success px-3 py-1 text-sm font-black tracking-widest text-success uppercase"
          >
            Knew it
          </motion.div>
          <motion.div
            style={{ opacity: missOpacity }}
            className="pointer-events-none absolute top-6 right-6 z-10 rotate-12 rounded-xl border-2 border-danger px-3 py-1 text-sm font-black tracking-widest text-danger uppercase"
          >
            Not yet
          </motion.div>
        </>
      )}
      <div className="perspective">
        <motion.div
          className="preserve-3d grid cursor-pointer"
          animate={reduce ? undefined : { rotateY: flipped ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 26 }}
          onClick={() => !flipped && onFlip()}
          role="button"
          tabIndex={-1}
          aria-label={flipped ? "Answer side" : "Question side. Reveal the answer"}
        >
          {/* front */}
          <div className={face} style={reduce ? { visibility: flipped ? "hidden" : "visible" } : undefined} aria-hidden={flipped}>
            <Chips />
            <div className="flex flex-1 items-center py-6">
              <p className="text-xl leading-snug font-semibold tracking-tight whitespace-pre-line text-balance sm:text-2xl">{card.front}</p>
            </div>
            <p className="flex items-center gap-2 text-sm text-muted">
              <RotateCcw className="h-4 w-4" />
              <span className="hide-mouse">Tap the card to reveal the answer</span>
              <span className="hide-touch">
                Click or press <kbd className="kbd">Space</kbd> to reveal
              </span>
            </p>
          </div>
          {/* back */}
          <div
            className={face}
            style={reduce ? { visibility: flipped ? "visible" : "hidden" } : { transform: "rotateY(180deg)" }}
            aria-hidden={!flipped}
          >
            <Chips />
            <p className="mt-4 text-xs font-semibold tracking-wider text-primary uppercase">Answer</p>
            <p className="mt-1 line-clamp-2 text-sm font-medium text-muted">{card.front.split("\n")[0]}</p>
            <div className="mt-3 max-h-[42dvh] flex-1 overflow-y-auto pr-1 sm:max-h-[46vh]" data-testid="card-back">
              <p className="text-[15px] leading-relaxed whitespace-pre-line sm:text-base">{card.back}</p>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
