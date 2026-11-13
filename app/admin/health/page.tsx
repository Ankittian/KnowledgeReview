import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Download } from "lucide-react";
import { getDb, query } from "@/db/client";
import { Empty, Kpi, ScoreBar, TypePill, Votes, entityHref, pct } from "@/components/admin/bits";
import { getModuleNames } from "@/lib/deck";
import { loadNeedsChange } from "@/lib/reports";

export const metadata: Metadata = { title: "What needs change" };

const VIEWS = [
  { key: "flagged", label: "Flagged items" },
  { key: "forms", label: "By form" },
  { key: "processes", label: "By process" },
  { key: "rules", label: "By rule" },
  { key: "concepts", label: "By concept" },
] as const;
type View = (typeof VIEWS)[number]["key"];

interface RollupRow {
  type: string;
  key: string;
  name: string;
  module: string | null;
  yaml_file: string;
  cards: number;
  cards_reviewed: number;
  verdicts: number;
  correct_votes: number;
  improve_votes: number;
  unsure_votes: number;
  open_feedback: number;
  cards_flagged?: number;
  knew_rate: string | null;
  needs_change_score: string;
}

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ view?: string; module?: string }> }) {
  const sp = await searchParams;
  const view: View = (VIEWS.find((v) => v.key === sp.view)?.key ?? "flagged") as View;
  const module = sp.module?.slice(0, 10) || "";
  const db = await getDb();
  const moduleNames = await getModuleNames(db);
  const modFilter = module ? sql`AND module = ${module}` : sql``;

  const [[k], [{ active7 }], coverage] = await Promise.all([
    query<Record<string, string>>(
      db,
      sql`SELECT count(*) AS active_cards,
                 count(*) FILTER (WHERE reviewers > 0) AS reviewed,
                 count(*) FILTER (WHERE reviewers >= 3 AND improve_votes = 0) AS verified,
                 count(*) FILTER (WHERE improve_votes > 0) AS flagged,
                 coalesce(sum(open_feedback), 0) AS open_feedback
          FROM card_health WHERE status = 'active' ${modFilter}`,
    ),
    query<{ active7: number }>(db, sql`SELECT count(DISTINCT user_id)::int AS active7 FROM card_reviews WHERE created_at > now() - interval '7 days'`),
    query<{ module: string | null; cards: string; reviewed: string; verified: string; flagged: string }>(
      db,
      sql`SELECT module, count(*) AS cards, count(*) FILTER (WHERE reviewers > 0) AS reviewed,
                 count(*) FILTER (WHERE reviewers >= 3 AND improve_votes = 0) AS verified,
                 count(*) FILTER (WHERE improve_votes > 0) AS flagged
          FROM card_health WHERE status = 'active' GROUP BY module ORDER BY count(*) DESC`,
    ),
  ]);
  const n = (s: string | number | undefined) => Number(s ?? 0);

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(module ? { module } : {}), view, ...over });
    for (const [key, val] of [...p.entries()]) if (!val) p.delete(key);
    return `?${p}`;
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Active cards" value={n(k.active_cards).toLocaleString()} />
        <Kpi label="Reviewed at least once" value={pct(n(k.reviewed) / Math.max(1, n(k.active_cards)))} sub={`${n(k.reviewed).toLocaleString()} cards`} />
        <Kpi label="Verified (3+ correct, 0 flags)" value={n(k.verified).toLocaleString()} tone="text-success" />
        <Kpi label="Flagged for change" value={n(k.flagged).toLocaleString()} sub={`${n(k.open_feedback)} open suggestions`} tone="text-warning" />
        <Kpi label="Active reviewers (7 days)" value={String(active7)} />
      </div>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Verification coverage by area</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {coverage.map((c) => {
            const cards = n(c.cards);
            return (
              <li key={c.module ?? "-"}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{c.module ? (moduleNames.get(c.module) ?? c.module) : "General"}</span>
                  <span className="text-xs text-muted tabular-nums">
                    {n(c.reviewed)} / {cards} reviewed · {n(c.flagged)} flagged
                  </span>
                </div>
                <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-surface-2" title={`${n(c.verified)} verified, ${n(c.reviewed)} reviewed of ${cards}`}>
                  <div className="h-full bg-success" style={{ width: `${(n(c.verified) / cards) * 100}%` }} />
                  <div className="h-full bg-primary/60" style={{ width: `${((n(c.reviewed) - n(c.verified)) / cards) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 flex items-center gap-4 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" /> verified</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary/60" /> reviewed</span>
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-4 flex-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex w-max gap-1">
            {VIEWS.map((v) => (
              <Link key={v.key} href={qs({ view: v.key })} className={`chip px-3 py-1.5 text-sm ${view === v.key ? "bg-primary text-on-primary" : "hover:bg-border"}`}>
                {v.label}
              </Link>
            ))}
          </div>
        </div>
        <form className="flex items-center gap-2">
          <input type="hidden" name="view" value={view} />
          <select name="module" defaultValue={module} className="input w-auto py-2 text-sm" aria-label="Area">
            <option value="">All areas</option>
            {[...moduleNames].map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
          <button className="btn btn-outline py-2">Filter</button>
        </form>
        <a className="btn btn-outline py-2" href="/api/admin/export/needs-change?format=jsonl">
          <Download className="h-4 w-4" /> JSONL
        </a>
        <a className="btn btn-outline py-2" href="/api/admin/export/needs-change?format=md">
          <Download className="h-4 w-4" /> Report
        </a>
      </div>

      {view === "flagged" ? <FlaggedTable module={module} /> : <RollupTable view={view} module={module} />}
    </div>
  );
}

async function FlaggedTable({ module }: { module: string }) {
  const db = await getDb();
  const rows = await loadNeedsChange(db, { module: module || undefined, limit: 300 });
  if (!rows.length) return <Empty title="Nothing flagged yet">Cards marked “Needs fix” by employees appear here, worst first.</Empty>;
  return (
    <div className="panel overflow-x-auto">
      <table className="tbl min-w-[860px]">
        <thead>
          <tr>
            <th>Item · YAML location</th>
            <th>Verdicts</th>
            <th>Score</th>
            <th>Linked forms / processes</th>
            <th>Suggestions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.card_id}>
              <td className="max-w-[340px]">
                <div className="flex items-center gap-2">
                  <TypePill type={r.entity_type} />
                  <Link href={entityHref(r.entity_type, r.entity_key)} className="truncate font-semibold hover:text-primary hover:underline">
                    {r.entity_name}
                  </Link>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-muted" title={`${r.yaml_file} → ${r.entity_key} → ${r.field}`}>
                  {r.yaml_file} → {r.field}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{r.current_text}</p>
              </td>
              <td>
                <Votes correct={r.correct_votes} improve={r.improve_votes} unsure={r.unsure_votes} />
                {r.conflicting && <p className="mt-1 text-[11px] font-semibold text-danger">conflicting</p>}
              </td>
              <td>
                <ScoreBar score={r.needs_change_score} />
              </td>
              <td className="max-w-[240px]">
                <div className="flex flex-wrap gap-1">
                  {r.linked_forms.slice(0, 4).map((f) => (
                    <Link key={f} href={entityHref("form", f)} className="chip bg-success-soft text-success hover:underline">{f}</Link>
                  ))}
                  {r.linked_processes.slice(0, 3).map((p) => (
                    <Link key={p} href={entityHref("process", p)} className="chip bg-warning-soft text-warning hover:underline">{p}</Link>
                  ))}
                  {r.linked_forms.length + r.linked_processes.length === 0 && <span className="text-xs text-muted">–</span>}
                </div>
              </td>
              <td className="max-w-[260px]">
                {r.suggestions.slice(0, 2).map((s) => (
                  <p key={s.feedback_id} className="mb-1 line-clamp-2 text-xs">
                    <span className="font-semibold capitalize">{s.category}</span>
                    <span className="text-muted"> · {s.username}</span>
                    {s.comment ? <span className="text-muted">: {s.comment}</span> : null}
                  </p>
                ))}
                {r.suggestions.length > 2 && <p className="text-[11px] text-muted">+{r.suggestions.length - 2} more</p>}
                {r.open_feedback > 0 && (
                  <Link href={`/admin/feedback?card=${encodeURIComponent(r.card_id)}`} className="text-xs font-semibold text-primary hover:underline">
                    Triage {r.open_feedback}
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function RollupTable({ view, module }: { view: Exclude<View, "flagged">; module: string }) {
  const db = await getDb();
  const types = { forms: sql`type IN ('form','usercontrol')`, processes: sql`type = 'process'`, rules: sql`type = 'rule'`, concepts: sql`type = 'concept'` }[view];
  const rows = await query<RollupRow>(
    db,
    sql`SELECT * FROM kb_item_health WHERE ${types} AND verdicts > 0 ${module ? sql`AND module = ${module}` : sql``}
        ORDER BY needs_change_score DESC, improve_votes DESC, verdicts DESC LIMIT 300`,
  );
  if (!rows.length) return <Empty title="No verdicts yet">Rows appear once employees have reviewed related cards.</Empty>;
  return (
    <div className="panel overflow-x-auto">
      <table className="tbl min-w-[760px]">
        <thead>
          <tr>
            <th>{view === "rules" ? "Rule" : view === "forms" ? "Form" : view === "processes" ? "Process" : "Concept"}</th>
            <th className="text-right">Cards</th>
            <th className="text-right">Reviewed</th>
            <th>Verdicts</th>
            <th className="text-right">Open fixes</th>
            <th className="text-right">Knew</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.type}:${r.key}`}>
              <td className="max-w-[320px]">
                <Link href={entityHref(r.type, r.key)} className="font-semibold hover:text-primary hover:underline">
                  {r.name}
                </Link>
                <p className="truncate font-mono text-[11px] text-muted">{r.yaml_file}{view === "rules" ? ` → ${r.key}` : ""}</p>
              </td>
              <td className="text-right tabular-nums">{r.cards}</td>
              <td className="text-right tabular-nums">{r.cards_reviewed}</td>
              <td>
                <Votes correct={Number(r.correct_votes)} improve={Number(r.improve_votes)} unsure={Number(r.unsure_votes)} />
              </td>
              <td className="text-right tabular-nums">{Number(r.open_feedback)}</td>
              <td className="text-right tabular-nums">{pct(r.knew_rate == null ? null : Number(r.knew_rate))}</td>
              <td>
                <ScoreBar score={Number(r.needs_change_score)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
