import { cn } from "@/lib/utils";
import { AnimatedNumber } from "./AnimatedNumber";

type Tone = "default" | "primary" | "success" | "warning" | "destructive";

const TONE_TEXT: Record<Tone, string> = {
  default: "",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};
const TONE_ICON: Record<Tone, string> = {
  default: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/12 text-warning",
  destructive: "bg-destructive/10 text-destructive",
};

/**
 * KPI tile. `value` may be a number (animated with NumberFlow; `percent` treats it as 0..1)
 * or a preformatted string (rendered as-is).
 */
export function StatCard({
  label,
  value,
  percent,
  decimals,
  sub,
  icon,
  tone = "default",
  valueTone,
  className,
}: {
  label: React.ReactNode;
  value: number | string | null;
  percent?: boolean;
  decimals?: number;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: Tone;
  /** colour only the number (keeps the icon neutral) */
  valueTone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full flex-col rounded-xl bg-card p-4 shadow-card ring-1 ring-foreground/[0.07]", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {icon && <span className={cn("inline-flex size-7 items-center justify-center rounded-md [&_svg]:size-3.5", TONE_ICON[tone])}>{icon}</span>}
      </div>
      <p className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", TONE_TEXT[valueTone ?? "default"])}>
        {typeof value === "number" ? <AnimatedNumber value={value} percent={percent} decimals={decimals} /> : (value ?? "–")}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
