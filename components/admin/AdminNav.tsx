"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/common/PageHeader";
import { ADMIN_NAV, adminItems, isActive } from "@/components/shell/nav";

/** Underline tab bar for the admin sections, with a sliding indicator. */
export function AdminNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const items = adminItems(isAdmin);
  return (
    <nav className="-mx-4 overflow-x-auto border-b px-4 sm:-mx-6 sm:px-6 [scrollbar-width:none]" aria-label="Admin">
      <ul className="flex w-max gap-1">
        {items.map((i) => {
          const active = isActive(path, i.href);
          return (
            <li key={i.href} className="relative">
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 pt-1.5 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors md:text-[13px]",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <i.icon className={cn("size-4 md:size-3.5", active ? "text-primary" : "opacity-70")} />
                {i.label}
              </Link>
              {active && (
                <motion.span
                  layoutId="admin-tab-underline"
                  className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-primary"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Page title for the current admin section. */
export function AdminHeader() {
  const path = usePathname();
  const item = ADMIN_NAV.find((i) => isActive(path, i.href));
  return <PageHeader eyebrow="Administration" title={item?.label ?? "Administration"} description={item?.description} />;
}
