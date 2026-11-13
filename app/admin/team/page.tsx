import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { Download, Users } from "lucide-react";
import { getDb, query } from "@/db/client";
import { Empty, TableCard, pct, tcell, thead } from "@/components/admin/bits";
import { FadeIn } from "@/components/common/motion";
import { SectionTitle } from "@/components/common/PageHeader";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, streakFrom, todayStr } from "@/lib/dates";
import { getModuleNames } from "@/lib/deck";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Team knowledge" };

/** Heat-map tint: red (0%) → green (100%), kept light so the number stays readable. */
const heat = (k: number | null) =>
  k == null
    ? undefined
    : { background: `color-mix(in oklch, color-mix(in oklch, var(--success) ${Math.round(k * 100)}%, var(--destructive)) 18%, transparent)` };

export default async function TeamPage() {
  const db = await getDb();
  const today = todayStr();
  const [people, mods, procs, days, moduleNames] = await Promise.all([
    query<{ id: string; username: string; display_name: string; department: string | null; primary_module: string | null; role: string; reviews: number; last_review: Date | null; week: number; knew: number }>(
      db,
      sql`SELECT u.id, u.username, u.display_name, u.department, u.primary_module, u.role,
                 count(r.id)::int AS reviews, max(r.created_at) AS last_review,
                 count(r.id) FILTER (WHERE r.created_at > now() - interval '7 days')::int AS week,
                 count(r.id) FILTER (WHERE r.knew_it)::int AS knew
          FROM users u LEFT JOIN reviews r ON r.user_id = u.id
          WHERE u.status = 'active' GROUP BY u.id ORDER BY count(r.id) DESC, u.display_name`,
    ),
    query<{ user_id: string; module: string; knowledge: string | null; coverage: string | null; cards_seen: number }>(db, sql`SELECT user_id, module, knowledge, coverage, cards_seen FROM v_user_knowledge_module`),
    query<{ user_id: string; process_key: string; process_name: string; knowledge: string | null; cards_seen: number }>(db, sql`SELECT user_id, process_key, process_name, knowledge, cards_seen FROM v_user_knowledge_process`),
    query<{ user_id: string; d: unknown }>(db, sql`SELECT DISTINCT user_id, deck_date AS d FROM reviews WHERE deck_date >= ${addDays(today, -120)}::date`),
    getModuleNames(db),
  ]);

  const moduleCols = [...new Set(mods.map((m) => m.module))].sort();
  const processCols = [...new Map(procs.map((p) => [p.process_key, p.process_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const mk = new Map(mods.map((m) => [`${m.user_id}:${m.module}`, m]));
  const pk = new Map(procs.map((p) => [`${p.user_id}:${p.process_key}`, p]));
  const daysBy = new Map<string, string[]>();
  for (const r of days) {
    const d = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
    daysBy.set(r.user_id, [...(daysBy.get(r.user_id) ?? []), d]);
  }
  const active = people.filter((p) => p.reviews > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Knowledge</span> = recency-weighted share of cards the employee knew.{" "}
          <span className="font-medium text-foreground">Coverage</span> = share of an area’s cards they have seen.
        </p>
        <div className="flex items-center gap-3">
          <HeatLegend />
          <a className={buttonVariants({ variant: "outline" })} href="/api/admin/export/knowledge?format=csv">
            <Download /> Knowledge CSV
          </a>
        </div>
      </div>
      {active.length === 0 ? (
        <Empty title="No reviews yet" icon={<Users />}>
          Knowledge levels appear once employees start answering their daily decks.
        </Empty>
      ) : (
        <>
          <FadeIn>
            <TableCard>
              <Table className="min-w-[720px]">
                <TableHeader className={thead}>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Employee</TableHead>
                    <TableHead className="text-right">Answers</TableHead>
                    <TableHead className="text-right">7 days</TableHead>
                    <TableHead className="text-right">Streak</TableHead>
                    <TableHead className="text-right">Knew</TableHead>
                    {moduleCols.map((m) => (
                      <TableHead key={m} className="text-center">
                        {moduleNames.get(m) ?? m}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {people.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className={tcell}>
                        <p className="font-medium">{p.display_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.username}
                          {p.department ? ` · ${p.department}` : ""}
                          {p.primary_module ? ` · ${p.primary_module}` : ""}
                        </p>
                      </TableCell>
                      <TableCell className={cn(tcell, "text-right tabular-nums")}>{p.reviews}</TableCell>
                      <TableCell className={cn(tcell, "text-right tabular-nums")}>{p.week}</TableCell>
                      <TableCell className={cn(tcell, "text-right tabular-nums")}>{streakFrom(daysBy.get(p.id) ?? [], today)}</TableCell>
                      <TableCell className={cn(tcell, "text-right tabular-nums")}>{pct(p.reviews ? p.knew / p.reviews : null)}</TableCell>
                      {moduleCols.map((m) => {
                        const c = mk.get(`${p.id}:${m}`);
                        const k = c?.knowledge == null ? null : Number(c.knowledge);
                        return (
                          <TableCell
                            key={m}
                            className={cn(tcell, "text-center")}
                            style={heat(k)}
                            title={c ? `${c.cards_seen} cards seen · coverage ${pct(Number(c.coverage))}` : "No answers"}
                          >
                            <span className={cn("font-medium tabular-nums", k == null && "text-muted-foreground")}>{pct(k)}</span>
                            {c && <span className="block text-[10px] text-muted-foreground">{pct(Number(c.coverage))} cov.</span>}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          </FadeIn>

          {processCols.length > 0 && (
            <FadeIn delay={0.08}>
              <section>
                <SectionTitle title="By business process" />
                <TableCard>
                  <Table className="min-w-[720px]">
                    <TableHeader className={thead}>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Employee</TableHead>
                        {processCols.map(([k, name]) => (
                          <TableHead key={k} className="text-center">
                            {name}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {active.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className={cn(tcell, "font-medium")}>{p.display_name}</TableCell>
                          {processCols.map(([k]) => {
                            const c = pk.get(`${p.id}:${k}`);
                            const v = c?.knowledge == null ? null : Number(c.knowledge);
                            return (
                              <TableCell
                                key={k}
                                className={cn(tcell, "text-center tabular-nums", v == null && "text-muted-foreground")}
                                style={heat(v)}
                                title={c ? `${c.cards_seen} cards seen` : "No answers"}
                              >
                                {pct(v)}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableCard>
              </section>
            </FadeIn>
          )}
        </>
      )}
    </div>
  );
}

function HeatLegend() {
  return (
    <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:inline-flex">
      0%
      <span className="flex h-2 w-24 overflow-hidden rounded-full">
        {[0, 0.25, 0.5, 0.75, 1].map((k) => (
          <span key={k} className="flex-1" style={{ background: `color-mix(in oklch, var(--success) ${k * 100}%, var(--destructive))`, opacity: 0.55 }} />
        ))}
      </span>
      100%
    </span>
  );
}
