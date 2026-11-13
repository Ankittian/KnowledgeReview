"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export interface SegmentedItem {
  key: string;
  label: React.ReactNode;
  href: string;
  count?: number;
}

/** Segmented control made of links, with an animated active pill. Hrefs are passed in as-is. */
export function Segmented({ id, items, active, className }: { id: string; items: SegmentedItem[]; active: string; className?: string }) {
  return (
    <div className={cn("-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 [scrollbar-width:none]", className)}>
      <div className="inline-flex w-max items-center gap-0.5 rounded-lg bg-muted p-0.5" role="tablist">
        {items.map((i) => {
          const on = i.key === active;
          return (
            <Link
              key={i.key}
              href={i.href}
              role="tab"
              aria-selected={on}
              className={cn(
                "relative inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium whitespace-nowrap capitalize transition-colors",
                on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {on && (
                <motion.span
                  layoutId={`seg-${id}`}
                  className="absolute inset-0 rounded-md bg-background shadow-sm ring-1 ring-foreground/[0.06] dark:bg-accent"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <span className="relative">{i.label}</span>
              {i.count != null && <span className="relative font-mono text-[11px] text-muted-foreground tabular-nums">{i.count}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
