"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Send, X } from "lucide-react";

export type FeedbackCategory = "incorrect" | "incomplete" | "outdated" | "unclear" | "other";

const CATEGORIES: { value: FeedbackCategory; label: string; hint: string }[] = [
  { value: "incorrect", label: "Incorrect", hint: "States something wrong" },
  { value: "incomplete", label: "Incomplete", hint: "Missing an important part" },
  { value: "outdated", label: "Outdated", hint: "Was true, has changed" },
  { value: "unclear", label: "Unclear", hint: "Hard to understand" },
  { value: "other", label: "Other", hint: "Something else" },
];

export interface FeedbackValue {
  category: FeedbackCategory;
  suggestedText: string;
  comment: string;
}

interface Props {
  open: boolean;
  originalText: string;
  onCancel: () => void;
  onSubmit: (v: FeedbackValue) => void;
}

export function FeedbackSheet({ open, originalText, onCancel, onSubmit }: Props) {
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [text, setText] = useState(originalText);
  const [comment, setComment] = useState("");
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setCategory(null);
    setText(originalText);
    setComment("");
    const t = setTimeout(() => firstRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, originalText, onCancel]);

  const changed = text.trim() !== originalText.trim();

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="fb-title">
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
          />
          <motion.form
            className="safe-bottom relative max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl border border-border bg-surface px-5 pt-3 shadow-card sm:max-w-lg sm:rounded-3xl sm:p-6"
            initial={{ y: "100%", opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (category) onSubmit({ category, suggestedText: changed ? text : "", comment });
            }}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border sm:hidden" />
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <h2 id="fb-title" className="text-lg font-semibold">
                  What needs improving?
                </h2>
                <p className="mt-0.5 text-sm text-muted">Your suggestion goes to the knowledge-base reviewers.</p>
              </div>
              <button type="button" className="btn btn-ghost -mt-1 -mr-2 px-2" onClick={onCancel} aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <fieldset className="mt-4">
              <legend className="label">Issue</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CATEGORIES.map((c, i) => (
                  <button
                    key={c.value}
                    ref={i === 0 ? firstRef : undefined}
                    type="button"
                    role="radio"
                    aria-checked={category === c.value}
                    onClick={() => setCategory(c.value)}
                    className={`rounded-xl border px-3 py-2 text-left transition ${
                      category === c.value
                        ? "border-primary bg-primary-soft ring-2 ring-[var(--ring)]"
                        : "border-border bg-surface hover:bg-surface-2"
                    }`}
                  >
                    <span className={`block text-sm font-semibold ${category === c.value ? "text-primary" : ""}`}>{c.label}</span>
                    <span className="block text-[11px] leading-tight text-muted">{c.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mt-4">
              <label className="label" htmlFor="fb-text">
                Suggested correction <span className="font-normal text-muted">(edit the text)</span>
              </label>
              <textarea id="fb-text" className="input min-h-32 resize-y leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} />
              {changed && (
                <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline" onClick={() => setText(originalText)}>
                  Reset to original
                </button>
              )}
            </div>
            <div className="mt-3">
              <label className="label" htmlFor="fb-comment">
                Comment <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id="fb-comment"
                className="input min-h-16 resize-y"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={2000}
                placeholder="Why is it wrong? Where did you see the right behaviour?"
              />
            </div>
            <div className="mt-5 flex gap-2 pb-2 sm:pb-0">
              <button type="button" className="btn btn-outline btn-lg flex-1" onClick={onCancel}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-lg flex-[2]" disabled={!category}>
                <Send className="h-4 w-4" />
                Submit
              </button>
            </div>
          </motion.form>
        </div>
      )}
    </AnimatePresence>
  );
}
