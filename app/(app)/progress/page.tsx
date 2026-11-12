import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Flame, Layers, MessageSquareText, Target } from "lucide-react";
import { getDb, query } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { addDays, todayStr } from "@/lib/dates";
import { getModuleNames } from "@/lib/deck";
import { getDailyCounts, getStreak, getUserSummary } from "@/lib/stats";

export const metadata: Metadata = { title: "Progress" };

const pct = (n: number | null | undefined) => (n == null ? "–" : `${Math.round(n * 100)}%`);

export default async function ProgressPage() {
  const { user } = await requireUser();
  const db = await getDb();
  const today = todayStr();
  const from = addDays(today, -27);
  const [summary, { streak }, daily, moduleNames, modules, revisit] = await Promise.all([
    getUserSummary(db, user.id),
    getStreak(db, user.id, today),
    getDailyCounts(db, user.id, from),
    getModuleNames(db),
    query<{ module: string; reviews: number; cards_seen: number; total_cards: number; coverage: string; knowledge: string }>(
      db,
      sql`SELECT module, reviews, cards_seen, total_cards, coverage, knowledge FROM v_user_knowledge_module
          WHERE user_id = ${user.id} ORDER BY reviews DESC`,
    ),
    query<{ v: number; context: string; front: string; back: string }>(
      db,
      sql`SELECT DISTINCT ON (r.card_id) cv.id AS v, cv.context, cv.front, cv.back
          FROM reviews r JOIN cards c ON c.id = r.card_id AND c.status = 'active'
          JOIN card_versions cv ON cv.id = c.current_version_id
          WHERE r.user_id = ${user.id} AND NOT r.knew_it
            AND NOT EXISTS (SELECT 1 FROM reviews r2 WHERE r2.user_id = r.user_id AND r2.card_id = r.card_id AND r2.knew_it AND r2.created_at > r.created_at)
          ORDER BY r.card_id, r.created_at DESC LIMIT 6`,
    ),
  ]);
  const knewRate = summary.reviews ? summary.knew / summary.reviews : null;
  const days = Array.from({ length: 28 }, (_, i) => addDays(from, i));
  const max = Math.max(1, ...days.map((d) => daily.get(d)?.n ?? 0));

  return (
    <main className="mx-auto max-w-4xl px-4 pt-6 sm:pt-8">
      <h1 className="text-2xl font-bold tracking-tight">Your progress</h1>
      <p className="mt-1 text-sm text-muted">Knowledge is weighted toward your recent answers.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<Flame className="h-4 w-4" />} tone="text-warning bg-warning-soft" label="Day streak" value={String(streak)} />
        <Tile icon={<Target className="h-4 w-4" />} tone="text-success bg-success-soft" label="Knew it" value={pct(knewRate)} sub={`${summary.knew} of ${summary.reviews} answers`} />
        <Tile icon={<Layers className="h-4 w-4" />} tone="text-primary bg-primary-soft" label="Cards seen" value={String(summary.cardsSeen)} />
        <Tile
          icon={<MessageSquareText className="h-4 w-4" />}
          tone="text-warning bg-warning-soft"
          label="Fixes suggested"
          value={String(summary.feedback.total)}
          sub={summary.feedback.applied || summary.feedback.accepted ? `${summary.feedback.accepted + summary.feedback.applied} accepted` : undefined}
        />
      </div>

      <section className="panel mt-6 p-5">
        <h2 className="text-sm font-semibold">Last 4 weeks</h2>
        <div className="mt-4 flex h-28 items-end gap-1" role="img" aria-label="Cards answered per day over the last 28 days">
          {days.map((d) => {
            const c = daily.get(d);
            const h = c ? Math.max(8, (c.n / max) * 100) : 4;
            return (
              <div key={d} className="group relative flex h-full flex-1 items-end" title={`${d}: ${c?.n ?? 0} cards${c ? `, knew ${c.knew}` : ""}`}>
                <div className={`w-full rounded-md ${c ? "bg-primary" : "bg-surface-2"} ${d === today ? "ring-2 ring-primary/40 ring-offset-1 ring-offset-surface" : ""}`} style={{ height: `${h}%` }} />
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-muted">
          <span>4 weeks ago</span>
          <span>Today</span>
        </div>
      </section>

      <section className="panel mt-6 p-5">
        <h2 className="text-sm font-semibold">Knowledge by area</h2>
        {modules.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Answer a few cards to see your knowledge by area.{" "}
            <Link href="/today" className="font-semibold text-primary hover:underline">
              Start today’s deck
            </Link>
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {modules.map((m) => {
              const k = Number(m.knowledge);
              return (
                <li key={m.module}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{moduleNames.get(m.module) ?? m.module}</span>
                    <span className="font-semibold tabular-nums">{pct(k)}</span>
                  </div>
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-gradient-to-r from-primary to-success" style={{ width: `${Math.round(k * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {m.cards_seen} of {m.total_cards} cards seen · {pct(Number(m.coverage))} coverage
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {revisit.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold">Worth revisiting</h2>
          <p className="text-xs text-muted">Cards you didn’t know yet. They come back in your deck automatically.</p>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {revisit.map((c) => (
              <li key={c.v} className="panel p-4">
                <p className="truncate text-xs font-medium text-muted">{c.context}</p>
                <p className="mt-1 text-[15px] font-semibold whitespace-pre-line">{c.front}</p>
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer font-medium text-primary">Show answer</summary>
                  <p className="mt-2 leading-relaxed whitespace-pre-line text-muted">{c.back}</p>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Tile({ icon, tone, label, value, sub }: { icon: React.ReactNode; tone: string; label: string; value: string; sub?: string }) {
  return (
    <div className="panel p-4">
      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <p className="mt-3 text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs font-medium text-muted">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}
