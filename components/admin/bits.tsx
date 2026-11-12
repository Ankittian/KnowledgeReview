export const entityHref = (type: string, key: string) => `/admin/health/${type === "usercontrol" ? "form" : type}/${encodeURIComponent(key)}`;
export const pct = (n: number | null | undefined) =>
  n == null || Number.isNaN(n) ? "–" : n > 0 && n < 0.1 ? `${(n * 100).toFixed(1)}%` : `${Math.round(n * 100)}%`;

export function Kpi({ label, value, sub, tone = "" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

/** 0..1 needs-change score as a small bar: amber when moderate, red when high. */
export function ScoreBar({ score }: { score: number }) {
  const s = Math.max(0, Math.min(1, score));
  const color = s >= 0.5 ? "bg-danger" : s >= 0.25 ? "bg-warning" : "bg-success";
  return (
    <div className="flex items-center gap-2" title={`Needs-change score ${s.toFixed(2)}`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(4, s * 100)}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums">{s.toFixed(2)}</span>
    </div>
  );
}

const TYPE_TONE: Record<string, string> = {
  rule: "bg-primary-soft text-primary",
  form: "bg-success-soft text-success",
  usercontrol: "bg-success-soft text-success",
  process: "bg-warning-soft text-warning",
  concept: "bg-surface-2 text-muted",
  module: "bg-surface-2 text-muted",
};

export function TypePill({ type }: { type: string }) {
  return <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase ${TYPE_TONE[type] ?? "bg-surface-2"}`}>{type === "usercontrol" ? "control" : type}</span>;
}

export function Votes({ correct, improve, unsure }: { correct: number; improve: number; unsure: number }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold tabular-nums">
      <span className="text-success" title="Correct">✔ {correct}</span>
      <span className="text-warning" title="Needs improvement">✎ {improve}</span>
      <span className="text-muted" title="Not sure">? {unsure}</span>
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="panel px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}
