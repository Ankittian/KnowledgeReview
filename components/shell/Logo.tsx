import { cn } from "@/lib/utils";

/** Brand mark: two stacked cards with a check. Uses the primary token so it follows the theme. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8 shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <rect x="7" y="9.5" width="14" height="10.5" rx="2" className="fill-primary-foreground" opacity=".4" transform="rotate(-8 14 14.75)" />
      <rect x="10.5" y="11.5" width="14.5" height="11" rx="2.2" className="fill-primary-foreground" />
      <path d="m14.5 17.2 2 2 4-4" fill="none" className="stroke-primary" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={size === "lg" ? "size-10" : "size-7"} />
      <span className={cn("leading-none font-semibold tracking-tight", size === "lg" ? "text-lg" : "text-sm")}>Knowledge Review</span>
    </span>
  );
}
