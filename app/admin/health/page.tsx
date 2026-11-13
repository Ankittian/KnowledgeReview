import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Download, FileText, Filter, Layers, ShieldCheck, TriangleAlert, Users } from "lucide-react";
import { getDb, query } from "@/db/client";
import { Empty, ScoreBar, TableCard, Tag, TypePill, Votes, entityHref, pct, surface, tcell, thead } from "@/components/admin/bits";
import { Segmented } from "@/components/admin/Segmented";
import { GrowBar, Stagger, StaggerItem } from "@/components/common/motion";
import { StatCard } from "@/components/common/StatCard";
import { SectionTitle } from "@/components/common/PageHeader";
import { buttonVariants } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getModuleNames } from "@/lib/deck";
import { loadNeedsChange } from "@/lib/reports";
import { cn } from "@/lib/utils";

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
          FROM v_card_health WHERE status = 'active' ${modFilter}`,
    ),
    query<{ active7: number }>(db, sql`SELECT count(DISTINCT user_id)::int AS active7 FROM reviews WHERE created_at > now() - interval '7 days'`),
    query<{ module: string | null; cards: string; reviewed: string; verified: string; flagged: string }>(
      db,
      sql`SELECT module, count(*) AS cards, count(*) FILTER (WHERE reviewers > 0) AS reviewed,
                 count(*) FILTER (WHERE reviewers >= 3 AND improve_votes = 0) AS verified,
                 count(*) FILTER (WHERE improve_votes > 0) AS flagged
          FROM v_card_health WHERE status = 'active' GROUP BY module ORDER BY count(*) DESC`,
    ),
  ]);
  const n = (s: string | number | undefined) => Number(s ?? 0);

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(module ? { module } : {}), view, ...over });
    for (const [key, val] of [...p.entries()]) if (!val) p.delete(key);
    return `?${p}`;
  };
  const reviewedShare = n(k.reviewed) / Math.max(1, n(k.active_cards));

  return (
    <div className="space-y-6">
      <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StaggerItem>
          <StatCard label="Active cards" value={n(k.active_cards)} icon={<Layers />} />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Reviewed at least once"
            value={reviewedShare}
            percent
            decimals={reviewedShare > 0 && reviewedShare < 0.1 ? 1 : 0}
            sub={`${n(k.reviewed).toLocaleString()} cards`}
            icon={<FileText />}
            tone="primary"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Verified (3+ correct, 0 flags)" value={n(k.verified)} valueTone="success" icon={<ShieldCheck />} tone="success" />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Flagged for change" value={n(k.flagged)} sub={`${n(k.open_feedback)} open suggestions`} valueTone="warning" icon={<TriangleAlert />} tone="warning" />
        </StaggerItem>
        <StaggerItem className="col-span-2 lg:col-span-1">
          <StatCard label="Active reviewers (7 days)" value={Number(active7)} icon={<Users />} />
        </StaggerItem>
      </Stagger>

      <section className={cn(surface, "p-5")}>
        <SectionTitle
          title="Verification coverage by area"
          actions={
            <p className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-success" /> verified
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-primary/60" /> reviewed
              </span>
            </p>
          }
        />
        <ul className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {coverage.map((c, i) => {
            const cards = n(c.cards);
            return (
              <li key={c.module ?? "-"}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{c.module ? (moduleNames.get(c.module) ?? c.module) : "General"}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {n(c.reviewed)} / {cards} reviewed · {n(c.flagged)} flagged
                  </span>
                </div>
                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted" title={`${n(c.verified)} verified, ${n(c.reviewed)} reviewed of ${cards}`}>
                  <GrowBar value={n(c.verified) / cards} className="h-full bg-success" delay={i * 0.04} />
                  <GrowBar value={(n(c.reviewed) - n(c.verified)) / cards} className="h-full bg-primary/60" delay={i * 0.04 + 0.1} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented id="health-view" className="min-w-0 flex-1" active={view} items={VIEWS.map((v) => ({ key: v.key, label: v.label, href: qs({ view: v.key }) }))} />
        <form className="flex items-center gap-2">
          <input type="hidden" name="view" value={view} />
          <NativeSelect name="module" defaultValue={module} aria-label="Area" className="w-44">
            <NativeSelectOption value="">All areas</NativeSelectOption>
            {[...moduleNames].map(([code, name]) => (
              <NativeSelectOption key={code} value={code}>
                {name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <button className={buttonVariants({ variant: "outline" })}>
            <Filter /> Filter
          </button>
        </form>
        <a className={buttonVariants({ variant: "outline" })} href="/api/admin/export/needs-change?format=jsonl">
          <Download /> JSONL
        </a>
        <a className={buttonVariants({ variant: "outline" })} href="/api/admin/export/needs-change?format=md">
          <Download /> Report
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
    <TableCard>
      <Table className="min-w-[860px]">
        <TableHeader className={thead}>
          <TableRow className="hover:bg-transparent">
            <TableHead>Item · YAML location</TableHead>
            <TableHead>Verdicts</TableHead>
            <TableHead>Score</TableHead>
            <TableHead>Linked forms / processes</TableHead>
            <TableHead>Suggestions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.card_id}>
              <TableCell className={cn(tcell, "max-w-[340px]")}>
                <div className="flex min-w-0 items-center gap-2">
                  <TypePill type={r.entity_type} />
                  <Link href={entityHref(r.entity_type, r.entity_key)} className="truncate font-medium hover:text-primary hover:underline">
                    {r.entity_name}
                  </Link>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={`${r.yaml_file} → ${r.entity_key} → ${r.field}`}>
                  {r.yaml_file} → {r.field}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.current_text}</p>
              </TableCell>
              <TableCell className={tcell}>
                <Votes correct={r.correct_votes} improve={r.improve_votes} unsure={r.unsure_votes} />
                {r.conflicting && (
                  <div className="mt-1.5">
                    <Tag tone="destructive">conflicting</Tag>
                  </div>
                )}
              </TableCell>
              <TableCell className={tcell}>
                <ScoreBar score={r.needs_change_score} />
              </TableCell>
              <TableCell className={cn(tcell, "max-w-[240px]")}>
                <div className="flex flex-wrap gap-1">
                  {r.linked_forms.slice(0, 4).map((f) => (
                    <Link key={f} href={entityHref("form", f)} className="hover:opacity-80">
                      <Tag tone="success">{f}</Tag>
                    </Link>
                  ))}
                  {r.linked_processes.slice(0, 3).map((p) => (
                    <Link key={p} href={entityHref("process", p)} className="hover:opacity-80">
                      <Tag tone="warning">{p}</Tag>
                    </Link>
                  ))}
                  {r.linked_forms.length + r.linked_processes.length === 0 && <span className="text-xs text-muted-foreground">–</span>}
                </div>
              </TableCell>
              <TableCell className={cn(tcell, "max-w-[260px]")}>
                {r.suggestions.slice(0, 2).map((s) => (
                  <p key={s.feedback_id} className="mb-1 line-clamp-2 text-xs">
                    <span className="font-medium capitalize">{s.category}</span>
                    <span className="text-muted-foreground"> · {s.username}</span>
                    {s.comment ? <span className="text-muted-foreground">: {s.comment}</span> : null}
                  </p>
                ))}
                {r.suggestions.length > 2 && <p className="text-[11px] text-muted-foreground">+{r.suggestions.length - 2} more</p>}
                {r.open_feedback > 0 && (
                  <Link href={`/admin/feedback?card=${encodeURIComponent(r.card_id)}`} className="mt-1 inline-flex text-xs font-medium text-primary hover:underline">
                    Triage {r.open_feedback} →
                  </Link>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}

async function RollupTable({ view, module }: { view: Exclude<View, "flagged">; module: string }) {
  const db = await getDb();
  const source = view === "rules" ? sql`v_entity_health` : sql`v_rollup_health`;
  const types = { forms: sql`type IN ('form','usercontrol')`, processes: sql`type = 'process'`, rules: sql`type = 'rule'`, concepts: sql`type = 'concept'` }[view];
  const rows = await query<RollupRow>(
    db,
    sql`SELECT * FROM ${source} WHERE ${types} AND verdicts > 0 ${module ? sql`AND module = ${module}` : sql``}
        ORDER BY needs_change_score DESC, improve_votes DESC, verdicts DESC LIMIT 300`,
  );
  if (!rows.length) return <Empty title="No verdicts yet">Rows appear once employees have reviewed related cards.</Empty>;
  return (
    <TableCard>
      <Table className="min-w-[760px]">
        <TableHeader className={thead}>
          <TableRow className="hover:bg-transparent">
            <TableHead>{view === "rules" ? "Rule" : view === "forms" ? "Form" : view === "processes" ? "Process" : "Concept"}</TableHead>
            <TableHead className="text-right">Cards</TableHead>
            <TableHead className="text-right">Reviewed</TableHead>
            <TableHead>Verdicts</TableHead>
            <TableHead className="text-right">Open fixes</TableHead>
            <TableHead className="text-right">Knew</TableHead>
            <TableHead>Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.type}:${r.key}`}>
              <TableCell className={cn(tcell, "max-w-[320px]")}>
                <Link href={entityHref(r.type, r.key)} className="font-medium hover:text-primary hover:underline">
                  {r.name}
                </Link>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {r.yaml_file}
                  {view === "rules" ? ` → ${r.key}` : ""}
                </p>
              </TableCell>
              <TableCell className={cn(tcell, "text-right tabular-nums")}>{r.cards}</TableCell>
              <TableCell className={cn(tcell, "text-right tabular-nums")}>{r.cards_reviewed}</TableCell>
              <TableCell className={tcell}>
                <Votes correct={Number(r.correct_votes)} improve={Number(r.improve_votes)} unsure={Number(r.unsure_votes)} />
              </TableCell>
              <TableCell className={cn(tcell, "text-right tabular-nums", Number(r.open_feedback) > 0 && "font-medium text-warning")}>{Number(r.open_feedback)}</TableCell>
              <TableCell className={cn(tcell, "text-right tabular-nums")}>{pct(r.knew_rate == null ? null : Number(r.knew_rate))}</TableCell>
              <TableCell className={tcell}>
                <ScoreBar score={Number(r.needs_change_score)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}
