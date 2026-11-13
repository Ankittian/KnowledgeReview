"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { ADMIN_ROOT, MAIN_NAV, isActive } from "./nav";

/** Phone tab bar (the desktop uses the sidebar). */
export function MobileTabBar({ isStaff }: { isStaff: boolean }) {
  const path = usePathname();
  const items = isStaff ? [...MAIN_NAV, ADMIN_ROOT] : MAIN_NAV;
  return (
    <nav
      className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 pt-1.5 backdrop-blur-lg supports-backdrop-filter:bg-background/75 md:hidden"
      aria-label="Main"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-2">
        {items.map(({ href, label, icon: Icon }) => {
          const on = isActive(path, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg py-1 text-[11px] font-medium transition-colors",
                  on ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="relative flex h-7 w-12 items-center justify-center">
                  {on && (
                    <motion.span
                      layoutId="tabbar-pill"
                      className="absolute inset-0 rounded-full bg-primary/12"
                      transition={{ type: "spring", stiffness: 500, damping: 38 }}
                    />
                  )}
                  <Icon className={cn("relative size-[18px]", on && "text-primary")} />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
