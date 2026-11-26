"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, BarChart3, X, Layers, MessageSquare, MousePointer2, Search, Sparkles, Trophy, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const TOUR_EVENT = "kr:start-tour";

interface Step {
  icon: LucideIcon;
  title: string;
  body: string;
  tips: string[];
  href?: string;
  cta?: string;
}

const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: "Welcome to Knowledge Review",
    body: "A quick tour of every page in the app. The tour takes you to each one. It takes about a minute, and you can replay it any time from the help button in the top bar.",
    tips: ["Daily flashcards keep your SpectrumERP knowledge fresh", "Progress and the leaderboard show how you're doing", "Chat answers questions about SpectrumERP"],
  },
  {
    icon: MessageSquare,
    title: "Chat: ask anything",
    body: "Ask questions about SpectrumERP in plain language and get answers grounded in the knowledge base.",
    tips: [
      "Start from a suggested question or type your own",
      "Copy your prompt or the answer with the copy buttons",
      "Rate answers with thumbs up or down, and regenerate if needed",
      "Past conversations are in the sidebar, where you can rename or delete them",
    ],
    href: "/chat",
  },
  {
    icon: Layers,
    title: "Today: your daily flashcards",
    href: "/today",
    body: "Each day you get a short deck of cards drawn from the SpectrumERP knowledge base.",
    tips: [
      "Read the question, then tap the card to reveal the answer",
      "Say whether you knew it. Swipe the card or use the buttons",
      "Statement cards ask Known, New or Incorrect, with keyboard shortcuts",
      "Spotted a wrong answer? Suggest a correction so the knowledge base improves",
    ],
  },
  {
    icon: BarChart3,
    title: "Progress: see what you know",
    href: "/progress",
    body: "Your streak, activity and knowledge by area, weighted toward your recent answers.",
    tips: ["Switch between 7 days, 30 days and months", "Watch your knowledge grow in each area"],
  },
  {
    icon: Trophy,
    title: "Leaderboard: earn points",
    href: "/leaderboard",
    body: "Answers earn points, and reporting a card as incorrect or incomplete earns double. Each card scores once, from your first answer.",
    tips: ["Some cards are worth more than others", "Spotting a wrong or incomplete card is worth 2× its points", "See how you compare with your team"],
  },
  {
    icon: Search,
    title: "Browse cards: study any card",
    href: "/browse",
    body: "Search every card in the knowledge base and study the topics you care about, any time.",
    tips: ["Search by keyword and filter the list", "Answering a card here earns its points too"],
  },
];

const storageKey = (userId: string) => `kr_tour_v1:${userId}`;

/** First-login walkthrough of the whole app. Shown once per user per browser; replay by dispatching TOUR_EVENT. */
export function WelcomeTour({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(storageKey(userId)) === "1";
    } catch {}
    const t = setTimeout(() => {
      if (!seen) setOpen(true);
    }, 600);
    const replay = () => {
      setI(0);
      setOpen(true);
    };
    window.addEventListener(TOUR_EVENT, replay);
    return () => {
      clearTimeout(t);
      window.removeEventListener(TOUR_EVENT, replay);
    };
  }, [userId]);

  const go = useCallback(
    (n: number) => {
      setI(n);
      const href = STEPS[n].href;
      if (href) router.push(href);
    },
    [router],
  );

  const close = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(storageKey(userId), "1");
    } catch {}
  }, [userId]);

  const step = STEPS[i];
  const cardRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ rect: DOMRect; desktop: boolean; top: number } | null>(null);

  // Find the visible menu item for this step (sidebar on desktop, tab bar on phones) and place the card next to it.
  useLayoutEffect(() => {
    if (!open) return;
    const href = STEPS[i].href;
    const measure = () => {
      const el = href ? Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${href}"]`)).find((e) => e.getClientRects().length > 0) : undefined;
      if (!el) return setAnchor(null);
      const rect = el.getBoundingClientRect();
      const h = cardRef.current?.offsetHeight ?? 320;
      const desktop = window.matchMedia("(min-width: 768px)").matches;
      const top = Math.min(Math.max(rect.top + rect.height / 2 - h / 2, 12), window.innerHeight - h - 12);
      setAnchor({ rect, desktop, top });
    };
    measure();
    const t = setTimeout(measure, 250); // after the sidebar/card settle
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, [open, i]);

  const last = i === STEPS.length - 1;
  const Icon = step.icon;
  const title = i === 0 ? `Welcome, ${name.split(/\s+/)[0]}` : step.title;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        if (i === STEPS.length - 1) close();
        else go(i + 1);
      } else if (e.key === "ArrowLeft" && i > 0) go(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, go, i]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div key="tour" exit={{ opacity: 0 }}>
        {i === 0 && (
          <motion.div
            aria-hidden
            className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
        {anchor && (
          <motion.div
            aria-hidden
            className="pointer-events-none fixed z-50 rounded-lg ring-2 ring-success"
            initial={false}
            animate={{ top: anchor.rect.top - 3, left: anchor.rect.left - 3, width: anchor.rect.width + 6, height: anchor.rect.height + 6 }}
            transition={{ type: "spring", stiffness: 400, damping: 36 }}
          />
        )}
        {anchor && (
          <motion.div
            aria-hidden
            className="pointer-events-none fixed top-0 left-0 z-[60]"
            initial={{ opacity: 0, x: anchor.rect.left + anchor.rect.width * 0.6 + 40, y: anchor.rect.top + anchor.rect.height * 0.5 + 40 }}
            animate={{ opacity: 1, x: anchor.rect.left + anchor.rect.width * 0.6, y: anchor.rect.top + anchor.rect.height * 0.5 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
          >
            <motion.span
              key={i}
              className="absolute -top-3 -left-3 size-6 rounded-full bg-success/40"
              initial={{ scale: 0.3, opacity: 0.9 }}
              animate={{ scale: 1.8, opacity: 0 }}
              transition={{ delay: 0.45, duration: 0.6 }}
            />
            <MousePointer2 className="size-6 fill-foreground text-background drop-shadow-md" />
          </motion.div>
        )}
        <motion.div
          ref={cardRef}
          role="dialog"
          aria-label="App walkthrough"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0, ...(i > 0 && anchor?.desktop ? { top: anchor.top, left: anchor.rect.right + 16 } : {}) }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.2, top: { type: "spring", stiffness: 400, damping: 36 }, left: { type: "spring", stiffness: 400, damping: 36 } }}
          className={cn(
            "fixed z-50 rounded-xl bg-popover text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/10",
            i === 0
              ? "top-1/2 left-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2"
              : anchor?.desktop
                ? "w-[22rem]"
                : "right-4 bottom-24 left-4 sm:left-auto sm:w-[22rem] md:right-6 md:bottom-6",
          )}
        >
          {i > 0 && anchor?.desktop && (
            <span
              aria-hidden
              className="absolute -left-1.5 size-3 rotate-45 bg-popover ring-1 ring-foreground/10 [clip-path:polygon(0_0,0_100%,100%_100%)]"
              style={{ top: Math.min(Math.max(anchor.rect.top + anchor.rect.height / 2 - anchor.top - 6, 16), 280) }}
            />
          )}
          <button
            type="button"
            onClick={close}
            aria-label="Close walkthrough"
            className="absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
          <div className="overflow-hidden rounded-t-xl p-5 pb-4">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={i} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.12 }} className="space-y-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-success/10 text-success">
                  <Icon className="size-5" />
                </span>
                <div className="space-y-1">
                  <h2 className="pr-6 text-base font-semibold">{title}</h2>
                  <p className="text-muted-foreground">{step.body}</p>
                </div>
                <ul className="space-y-1.5 text-[13px] text-muted-foreground">
                  {step.tips.map((t) => (
                    <li key={t} className="flex gap-2">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-b-xl border-t bg-muted/30 px-5 py-3">
            <div className="flex items-center gap-1.5" role="group" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
              {STEPS.map((_, n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`Go to step ${n + 1}`}
                  onClick={() => go(n)}
                  className={cn("h-1.5 rounded-full transition-all", n === i ? "w-5 bg-success" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50")}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {i === 0 ? (
                <Button variant="ghost" size="sm" onClick={close}>
                  Skip
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => go(i - 1)}>
                  <ArrowLeft /> Back
                </Button>
              )}
              {last ? (
                <Button size="sm" onClick={close}>
                  Done
                </Button>
              ) : (
                <Button size="sm" onClick={() => go(i + 1)}>
                  Next <ArrowRight className="order-last" />
                </Button>
              )}
            </div>
          </div>
        </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
