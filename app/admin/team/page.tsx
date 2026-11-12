import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { Download } from "lucide-react";
import { getDb, query } from "@/db/client";
import { Empty, pct } from "@/components/admin/bits";
import { addDays, streakFrom, todayStr } from "@/lib/dates";
import { getModuleNames } from "@/lib/deck";

export const metadata: Metadata = { title: "Team knowledge" };

const heat = (k: number | null) =>
  k == null
    ? undefined
    : { background: `color-mix(in oklab, color-mix(in oklab, var(--success) ${Math.round(k * 100)}%, var(--danger)) 30%, transparent)` };

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Knowledge = recency-weighted share of cards the employee knew. Coverage = share of an area’s cards they have seen.
        </p>
        <a className="btn btn-outline py-2" href="/api/admin/export/knowledge?format=csv">
          <Download className="h-4 w-4" /> Knowledge CSV
        </a>
      </div>
      {active.length === 0 ? (
        <Empty title="No reviews yet">Knowledge levels appear once employees start answering their daily decks.</Empty>
      ) : (
        <>
          <section className="panel overflow-x-auto">
            <table className="tbl min-w-[720px]">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="text-right">Answers</th>
                  <th className="text-right">7 days</th>
                  <th className="text-right">Streak</th>
                  <th className="text-right">Knew</th>
                  {moduleCols.map((m) => (
                    <th key={m} className="text-center">{moduleNames.get(m) ?? m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <p className="font-semibold">{p.display_name}</p>
                      <p className="text-xs text-muted">
                        {p.username}
                        {p.department ? ` · ${p.department}` : ""}
                        {p.primary_module ? ` · ${p.primary_module}` : ""}
                      </p>
                    </td>
                    <td className="text-right tabular-nums">{p.reviews}</td>
                    <td className="text-right tabular-nums">{p.week}</td>
                    <td className="text-right tabular-nums">{streakFrom(daysBy.get(p.id) ?? [], today)}</td>
                    <td className="text-right tabular-nums">{pct(p.reviews ? p.knew / p.reviews : null)}</td>
                    {moduleCols.map((m) => {
                      const c = mk.get(`${p.id}:${m}`);
                      const k = c?.knowledge == null ? null : Number(c.knowledge);
                      return (
                        <td key={m} className="text-center" style={heat(k)} title={c ? `${c.cards_seen} cards seen · coverage ${pct(Number(c.coverage))}` : "No answers"}>
                          <span className="font-semibold tabular-nums">{pct(k)}</span>
                          {c && <span className="block text-[10px] text-muted">{pct(Number(c.coverage))} cov.</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {processCols.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">By business process</h2>
              <div className="panel overflow-x-auto">
                <table className="tbl min-w-[720px]">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      {processCols.map(([k, name]) => (
                        <th key={k} className="text-center normal-case">{name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((p) => (
                      <tr key={p.id}>
                        <td className="font-semibold">{p.display_name}</td>
                        {processCols.map(([k]) => {
                          const c = pk.get(`${p.id}:${k}`);
                          const v = c?.knowledge == null ? null : Number(c.knowledge);
                          return (
                            <td key={k} className="text-center tabular-nums" style={heat(v)} title={c ? `${c.cards_seen} cards seen` : "No answers"}>
                              {pct(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
