"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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
  }, [open, originalText]);

  const changed = text.trim() !== originalText.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent
        initialFocus={firstRef}
        className={cn(
          "safe-bottom max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-lg",
          // bottom sheet on phones
          "max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:data-closed:slide-out-to-bottom max-sm:data-closed:zoom-out-100 max-sm:data-open:slide-in-from-bottom max-sm:data-open:zoom-in-100 max-sm:data-open:duration-300",
        )}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (category) onSubmit({ category, suggestedText: changed ? text : "", comment });
          }}
        >
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-border sm:hidden" />
          <DialogHeader className="px-5 pt-4 sm:px-6 sm:pt-6">
            <DialogTitle className="text-lg font-semibold">What needs improving?</DialogTitle>
            <DialogDescription>Your suggestion goes to the knowledge-base reviewers.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-5 py-5 sm:px-6">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Issue</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup">
                {CATEGORIES.map((c, i) => {
                  const on = category === c.value;
                  return (
                    <button
                      key={c.value}
                      ref={i === 0 ? firstRef : undefined}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setCategory(c.value)}
                      className={cn(
                        "relative rounded-lg border px-3 py-2.5 text-left transition-[border-color,background-color,box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        on ? "border-primary bg-primary/[0.06]" : "bg-card hover:border-foreground/20 hover:bg-accent/60",
                      )}
                    >
                      {on && (
                        <motion.span
                          layoutId="fb-cat-dot"
                          className="absolute top-2.5 right-2.5 size-1.5 rounded-full bg-primary"
                          transition={{ type: "spring", stiffness: 600, damping: 40 }}
                        />
                      )}
                      <span className={cn("block text-sm font-medium", on && "text-primary")}>{c.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">{c.hint}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="fb-text">
                  Suggested correction <span className="font-normal text-muted-foreground">(edit the text)</span>
                </Label>
                {changed && (
                  <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setText(originalText)}>
                    <RotateCcw /> Reset to original
                  </Button>
                )}
              </div>
              <Textarea
                id="fb-text"
                className={cn("min-h-32 resize-y leading-relaxed", changed && "border-primary/50")}
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={5000}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fb-comment">
                Comment <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="fb-comment"
                className="min-h-16 resize-y"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={2000}
                placeholder="Why is it wrong? Where did you see the right behaviour?"
              />
            </div>
          </div>

          <DialogFooter className="mx-0 mb-0 px-5 sm:px-6">
            <Button type="button" variant="outline" size="lg" className="h-10 sm:w-28" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="lg" className="h-10 sm:w-36" disabled={!category}>
              <Send />
              Submit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
