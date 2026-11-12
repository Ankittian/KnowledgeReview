import Link from "next/link";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import type { SessionUser } from "@/lib/auth/session";
import { Logo } from "./Logo";
import { NavLinks } from "./NavLinks";
import { ThemeToggle } from "./ThemeToggle";

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const isStaff = user.role === "admin" || user.role === "reviewer";
  const initials = user.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link href="/today" className="shrink-0" aria-label="Knowledge Review home">
            <Logo />
          </Link>
          <nav className="hidden flex-1 md:block" aria-label="Main">
            <NavLinks variant="top" isStaff={isStaff} />
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <div className="ml-1 hidden items-center gap-2 sm:flex">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary"
                title={`${user.displayName} (${user.username})`}
              >
                {initials}
              </span>
              <span className="hidden max-w-[10rem] truncate text-sm font-medium lg:inline">{user.displayName}</span>
            </div>
            <form action={logoutAction}>
              <button type="submit" className="btn btn-ghost px-2.5" aria-label="Sign out" title="Sign out">
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="flex-1 pb-24 md:pb-10">{children}</div>
      <nav
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pt-1.5 backdrop-blur-md md:hidden"
        aria-label="Main"
      >
        <NavLinks variant="bottom" isStaff={isStaff} />
      </nav>
    </div>
  );
}
