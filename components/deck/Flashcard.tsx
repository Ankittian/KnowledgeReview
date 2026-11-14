"use client";

import { useEffect, useState } from "react";
import { motion, useMotionValue, useReducedMotion, useTransform, type PanInfo } from "motion/react";
import { Check, MousePointerClick, X } from "lucide-react";
import type { ClientCard } from "@/lib/deck";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";

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

export function Flashcard({ card, flipped: revealed, canSwipe, onFlip, onSwipe, position, total }: Props) {
  const reduce = useReducedMotion();
  // After the reveal, clicking the card turns it back and forth; visual only (the answer flow follows `revealed`).
  const [showFront, setShowFront] = useState(false);
  useEffect(() => setShowFront(false), [revealed, card.v]);
  const flipped = revealed && !showFront;
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 0, 220], [-10, 0, 10]);
  const knewOpacity = useTransform(x, [20, SWIPE_DISTANCE], [0, 1]);
  const missOpacity = useTransform(x, [-SWIPE_DISTANCE, -20], [1, 0]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > SWIPE_DISTANCE || info.velocity.x > SWIPE_VELOCITY) onSwipe(true);
    else if (info.offset.x < -SWIPE_DISTANCE || info.velocity.x < -SWIPE_VELOCITY) onSwipe(false);
  };

  const face =
    "backface-hidden [grid-area:1/1] flex min-h-[300px] flex-col rounded-2xl bg-card p-5 shadow-float ring-1 ring-foreground/[0.08] sm:min-h-[340px] sm:p-7";

  const Meta = () => (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Badge variant="secondary" className="max-w-[70%] truncate font-normal text-muted-foreground">
        <span className="truncate">{card.context}</span>
      </Badge>
      {card.module && <Badge className="bg-primary/10 text-primary">{card.module}</Badge>}
      <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
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
            className="pointer-events-none absolute top-5 left-5 z-10 flex -rotate-6 items-center gap-1.5 rounded-lg bg-success px-2.5 py-1 text-xs font-semibold tracking-wide text-background uppercase shadow-lg"
          >
            <Check className="size-3.5" /> Knew it
          </motion.div>
          <motion.div
            style={{ opacity: missOpacity }}
            className="pointer-events-none absolute top-5 right-5 z-10 flex rotate-6 items-center gap-1.5 rounded-lg bg-destructive px-2.5 py-1 text-xs font-semibold tracking-wide text-background uppercase shadow-lg"
          >
            <X className="size-3.5" /> Not yet
          </motion.div>
        </>
      )}
      <div className="perspective">
        <motion.div
          className="preserve-3d grid cursor-pointer"
          animate={reduce ? undefined : { rotateY: flipped ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 26 }}
          onClick={() => (revealed ? setShowFront((v) => !v) : onFlip())}
          role="button"
          tabIndex={-1}
          aria-label={flipped ? "Answer side" : "Question side. Reveal the answer"}
        >
          {/* front */}
          <div className={`${face} group`} style={reduce ? { visibility: flipped ? "hidden" : "visible" } : undefined} aria-hidden={flipped}>
            <Meta />
            <div className="flex flex-1 items-center py-8">
              <p className="text-xl leading-snug font-semibold tracking-tight whitespace-pre-line text-balance sm:text-[1.6rem] sm:leading-[1.3]">{card.front}</p>
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <MousePointerClick className="size-3.5 transition-transform group-hover:-rotate-12" />
              <span className="hide-mouse">Tap the card to reveal the answer</span>
              <span className="hide-touch inline-flex items-center gap-1.5">
                Click or press <Kbd>Space</Kbd> to reveal
              </span>
            </p>
          </div>
          {/* back */}
          <div
            className={face}
            style={reduce ? { visibility: flipped ? "visible" : "hidden" } : { transform: "rotateY(180deg)" }}
            aria-hidden={!flipped}
          >
            <Meta />
            <div className="mt-5 border-l-2 border-primary/40 pl-3">
              <p className="text-[11px] font-medium tracking-wider text-primary uppercase">Answer</p>
              <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{card.front.split("\n")[0]}</p>
            </div>
            <div className="mt-4 max-h-[42dvh] flex-1 overflow-y-auto pr-1 sm:max-h-[46vh]" data-testid="card-back">
              <p className="text-[15px] leading-relaxed whitespace-pre-line sm:text-base">{card.back}</p>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
