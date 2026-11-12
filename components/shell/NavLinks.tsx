"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Layers, Search, ShieldCheck } from "lucide-react";

const ITEMS = [
  { href: "/today", label: "Today", icon: Layers },
  { href: "/progress", label: "Progress", icon: BarChart3 },
  { href: "/browse", label: "Browse", icon: Search },
];

export function NavLinks({ variant, isStaff }: { variant: "top" | "bottom"; isStaff: boolean }) {
  const path = usePathname();
  const items = isStaff ? [...ITEMS, { href: "/admin", label: "Admin", icon: ShieldCheck }] : ITEMS;
  const active = (href: string) => path === href || path.startsWith(`${href}/`);

  if (variant === "top")
    return (
      <ul className="flex items-center gap-1">
        {items.map(({ href, label }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                active(href) ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    );

  return (
    <ul className="mx-auto flex max-w-md items-stretch justify-around px-2">
      {items.map(({ href, label, icon: Icon }) => (
        <li key={href} className="flex-1">
          <Link
            href={href}
            aria-current={active(href) ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold transition ${
              active(href) ? "text-primary" : "text-muted"
            }`}
          >
            <span className={`flex h-7 w-12 items-center justify-center rounded-full transition ${active(href) ? "bg-primary-soft" : ""}`}>
              <Icon className="h-[18px] w-[18px]" />
            </span>
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
