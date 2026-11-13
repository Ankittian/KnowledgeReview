import { Check, CircleHelp, PencilLine, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { GrowBar } from "@/components/common/motion";

export const entityHref = (type: string, key: string) => `/admin/health/${type === "usercontrol" ? "form" : type}/${encodeURIComponent(key)}`;
export const pct = (n: number | null | undefined) =>
  n == null || Number.isNaN(n) ? "–" : n > 0 && n < 0.1 ? `${(n * 100).toFixed(1)}%` : `${Math.round(n * 100)}%`;

export type Tone = "neutral" | "primary" | "success" | "warning" | "destructive" | "outline";

const TAG_TONE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/12 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  outline: "border-border bg-transparent text-muted-foreground",
};

/** Server-safe badge (same look as <Badge>, plain <span>). */
export function Tag({ tone = "neutral", className, children, title }: { tone?: Tone; className?: string; children: React.ReactNode; title?: string }) {
  return (
    <Badge variant="secondary" title={title} className={cn(TAG_TONE[tone], className)}>
      {children}
    </Badge>
  );
}

/** Shared surface for tables and lists. */
export const surface = "rounded-xl bg-card shadow-card ring-1 ring-foreground/[0.07]";

/** Table wrapper: card surface + horizontal scroll on phones. */
export function TableCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn(surface, "overflow-hidden", className)}>{children}</div>;
}

/** Class for <TableHeader> rows / <TableHead> cells. */
export const thead = "bg-muted/40 [&_th]:h-9 [&_th]:px-3 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground";
export const tcell = "px-3 py-3 align-top whitespace-normal";

/** 0..1 needs-change score as a small animated bar: amber when moderate, red when high. */
export function ScoreBar({ score }: { score: number }) {
  const s = Math.max(0, Math.min(1, score));
  const color = s >= 0.5 ? "bg-destructive" : s >= 0.25 ? "bg-warning" : "bg-success";
  const text = s >= 0.5 ? "text-destructive" : s >= 0.25 ? "text-warning" : "text-muted-foreground";
  return (
    <div className="flex items-center gap-2" title={`Needs-change score ${s.toFixed(2)}`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <GrowBar value={Math.max(0.04, s)} className={cn("h-full rounded-full", color)} />
      </div>
      <span className={cn("font-mono text-xs font-medium tabular-nums", text)}>{s.toFixed(2)}</span>
    </div>
  );
}

const TYPE_TONE: Record<string, Tone> = {
  rule: "primary",
  form: "success",
  usercontrol: "success",
  process: "warning",
  concept: "neutral",
  module: "neutral",
};

export function TypePill({ type }: { type: string }) {
  return (
    <Tag tone={TYPE_TONE[type] ?? "neutral"} className="h-[18px] rounded-md px-1.5 text-[10px] font-semibold tracking-wide uppercase">
      {type === "usercontrol" ? "control" : type}
    </Tag>
  );
}

export function Votes({ correct, improve, unsure }: { correct: number; improve: number; unsure: number }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-xs font-medium tabular-nums">
      <span className="inline-flex items-center gap-1 text-success" title="Correct">
        <Check className="size-3.5" /> {correct}
      </span>
      <span className="inline-flex items-center gap-1 text-warning" title="Needs improvement">
        <PencilLine className="size-3.5" /> {improve}
      </span>
      <span className="inline-flex items-center gap-1 text-muted-foreground" title="Not sure">
        <CircleHelp className="size-3.5" /> {unsure}
      </span>
    </span>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card/50 px-6 py-12 text-center">
      <span className="mb-1 flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">{icon ?? <Inbox />}</span>
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

/** Small uppercase label used above text blocks. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase", className)}>{children}</p>;
}
