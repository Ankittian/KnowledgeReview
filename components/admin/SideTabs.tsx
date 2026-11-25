"use client";

import { useId } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export interface SideTabItem {
  key: string;
  label: string;
  href: string;
  icon?: React.ReactNode;
  /** Small count shown on the right (for example open items). */
  count?: number;
}

/**
 * Sub-navigation for a page with several sections: a vertical list on the left (like Discord's settings), a
 * scrollable row on phones. Tabs are plain links (`?tab=`), so they work with the back button and can be shared.
 * Changing tab slides the highlight to the new tab and fades the new section in.
 */
export function SideTabs({ title, items, active, children, className }: { title?: string; items: SideTabItem[]; active: string; children: React.ReactNode; className?: string }) {
  const group = useId();
  return (
    <div className={cn("flex flex-col gap-5 md:flex-row md:items-start md:gap-8", className)}>
      <nav aria-label={title ?? "Sections"} className="md:sticky md:top-20 md:w-52 md:shrink-0">
        {title && <p className="mb-2 hidden px-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase md:block">{title}</p>}
        <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0" role="tablist" aria-orientation="vertical">
          {items.map((i) => {
            const on = i.key === active;
            return (
              <li key={i.key} className="shrink-0">
                <Link
                  href={i.href}
                  role="tab"
                  aria-selected={on}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
                    on ? "text-success" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  {on && (
                    <motion.span layoutId={`${group}-pill`} className="absolute inset-0 rounded-md bg-accent" transition={{ type: "spring", stiffness: 500, damping: 40 }}>
                      <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 hidden w-0.5 rounded-full bg-success md:block" />
                    </motion.span>
                  )}
                  <span className={cn("relative", on ? "text-success" : "opacity-70")}>{i.icon}</span>
                  <span className="relative flex-1">{i.label}</span>
                  {i.count != null && i.count > 0 && <span className="relative rounded-full bg-primary/10 px-1.5 font-mono text-[11px] text-primary tabular-nums">{i.count}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {/* the section that changes: keyed by the active tab, so every switch plays the entrance */}
      <motion.div key={active} className="min-w-0 flex-1" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
        {children}
      </motion.div>
    </div>
  );
}
