export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-11 w-11" : "h-8 w-8";
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className={box} aria-hidden>
        <rect width="64" height="64" rx="14" fill="var(--primary)" />
        <rect x="14" y="18" width="30" height="22" rx="4" fill="var(--on-primary)" opacity=".45" transform="rotate(-8 29 29)" />
        <rect x="20" y="22" width="30" height="22" rx="4" fill="var(--on-primary)" />
        <path d="m28 33 4 4 8-8" fill="none" stroke="var(--primary)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={`font-semibold tracking-tight ${size === "lg" ? "text-xl" : "text-[15px]"}`}>
        Knowledge <span className="text-primary">Review</span>
      </span>
    </span>
  );
}
