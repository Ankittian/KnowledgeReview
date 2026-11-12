"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const items = [
    { href: "/admin/health", label: "What needs change" },
    { href: "/admin/feedback", label: "Feedback" },
    { href: "/admin/team", label: "Team knowledge" },
    ...(isAdmin
      ? [
          { href: "/admin/users", label: "Users" },
          { href: "/admin/settings", label: "Settings & exports" },
        ]
      : []),
  ];
  return (
    <nav className="-mx-4 overflow-x-auto px-4" aria-label="Admin">
      <ul className="flex w-max gap-1 rounded-2xl border border-border bg-surface p-1">
        {items.map((i) => {
          const active = path === i.href || path.startsWith(`${i.href}/`);
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-xl px-3.5 py-2 text-sm font-medium whitespace-nowrap transition ${
                  active ? "bg-primary text-on-primary shadow-sm" : "text-muted hover:bg-surface-2 hover:text-fg"
                }`}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
