import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { ArrowRight, Flame, Layers, MessageSquareText, Target } from "lucide-react";
import { getDb, query } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { addDays, todayStr } from "@/lib/dates";
import { getModuleNames } from "@/lib/deck";
import { getDailyCounts, getStreak, getUserSummary } from "@/lib/stats";
import { GrowBar, Stagger, StaggerItem } from "@/components/common/motion";
import { PageHeader, SectionTitle } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { ActivityChart, type DayPoint } from "@/components/progress/ActivityChart";
import { RevisitCard } from "@/components/progress/RevisitCard";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export const metadata: Metadata = { title: "Progress" };

const pct = (n: number | null | undefined) => (n == null ? "–" : `${Math.round(n * 100)}%`);
const dayLabel = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

const RANGES = {
  week: { label: "7 days", title: "Last 7 days" },
  month: { label: "30 days", title: "Last 30 days" },
  months: { label: "By month", title: "Last 6 months" },
} as const;
type Range = keyof typeof RANGES;
const monthLabel = (ym: string) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${ym}-01T00:00:00Z`));

export default async function ProgressPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const sp = await searchParams;
  const range: Range = sp.range === "week" || sp.range === "months" ? sp.range : "month";
  const { user } = await requireUser();
  const db = await getDb();
  const today = todayStr();
  const monthStart = (() => {
    const [y, m] = today.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 - 5, 1));
    return d.toISOString().slice(0, 10);
  })();
  const from = range === "week" ? addDays(today, -6) : range === "month" ? addDays(today, -29) : monthStart;
  const [summary, { streak }, daily, moduleNames, modules, revisit] = await Promise.all([
    getUserSummary(db, user.id),
    getStreak(db, user.id, today),
    getDailyCounts(db, user.id, from),
    getModuleNames(db),
    query<{ module: string; reviews: number; cards_seen: number; total_cards: number; coverage: string; knowledge: string }>(
      db,
      sql`SELECT scope_key AS module, reviews, cards_seen, total_cards, coverage, knowledge FROM user_knowledge
          WHERE user_id = ${user.id} AND scope = 'module' ORDER BY reviews DESC`,
    ),
    query<{ v: number; context: string; front: string; back: string }>(
      db,
      sql`SELECT DISTINCT ON (c.id) cv.id AS v, cv.context, cv.front, cv.back
          FROM card_reviews r JOIN card_versions rv ON rv.id = r.card_version_id
          JOIN cards c ON c.id = rv.card_id AND c.status = 'active'
          JOIN card_versions cv ON cv.id = c.current_version_id
          WHERE r.user_id = ${user.id} AND NOT r.knew_it
            AND NOT EXISTS (SELECT 1 FROM card_reviews r2 JOIN card_versions v2 ON v2.id = r2.card_version_id
                            WHERE r2.user_id = r.user_id AND v2.card_id = c.id AND r2.knew_it AND r2.created_at > r.created_at)
          ORDER BY c.id, r.created_at DESC LIMIT 6`,
    ),
  ]);
  const knewRate = summary.reviews ? summary.knew / summary.reviews : null;
  let chart: DayPoint[];
  if (range === "months") {
    const buckets = new Map<string, DayPoint>();
    for (let d = from; d <= today; d = addDays(d, 1)) {
      const ym = d.slice(0, 7);
      if (!buckets.has(ym)) buckets.set(ym, { date: ym, label: monthLabel(ym), knew: 0, missed: 0 });
      const c = daily.get(d);
      if (c) {
        const b = buckets.get(ym)!;
        b.knew += c.knew;
        b.missed += c.n - c.knew;
      }
    }
    chart = [...buckets.values()];
  } else {
    const n = range === "week" ? 7 : 30;
    chart = Array.from({ length: n }, (_, i) => addDays(from, i)).map((d) => {
      const c = daily.get(d);
      return { date: d, label: d === today ? "Today" : dayLabel(d), knew: c?.knew ?? 0, missed: c ? c.n - c.knew : 0 };
    });
  }
  const total = chart.reduce((a, d) => a + d.knew + d.missed, 0);
  const activeDays = [...daily.entries()].filter(([d, c]) => d >= from && c.n > 0).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-8">
      <PageHeader
        title="Your progress"
        description="Knowledge is weighted toward your recent answers."
        actions={
          <Link href="/today" className={buttonVariants({ variant: "outline" })}>
            Today’s deck <ArrowRight />
          </Link>
        }
      />

      <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StaggerItem>
          <StatCard icon={<Flame />} tone="warning" label="Day streak" value={streak} sub={streak === 1 ? "day in a row" : "days in a row"} />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon={<Target />}
            tone="success"
            label="Knew it"
            value={knewRate}
            percent
            sub={`${summary.knew} of ${summary.reviews} answers`}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard icon={<Layers />} tone="primary" label="Cards seen" value={summary.cardsSeen} />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            icon={<MessageSquareText />}
            tone="default"
            label="Fixes suggested"
            value={summary.feedback.total}
            sub={summary.feedback.applied || summary.feedback.accepted ? `${summary.feedback.accepted + summary.feedback.applied} accepted` : undefined}
          />
        </StaggerItem>
      </Stagger>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>{RANGES[range].title}</CardTitle>
          <CardDescription>
            {total.toLocaleString()} answer{total === 1 ? "" : "s"} across {activeDays} active day{activeDays === 1 ? "" : "s"}
          </CardDescription>
          <CardAction>
            <nav className="flex gap-1" aria-label="Time range">
              {(Object.keys(RANGES) as Range[]).map((r) => (
                <Link
                  key={r}
                  href={`/progress?range=${r}`}
                  scroll={false}
                  aria-current={r === range ? "page" : undefined}
                  className={buttonVariants({ size: "sm", variant: r === range ? "default" : "outline" })}
                >
                  {RANGES[r].label}
                </Link>
              ))}
            </nav>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ActivityChart data={chart} />
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>Knowledge by area</CardTitle>
          <CardDescription>The bar shows how much of each module you have mastered: the share of its cards you have seen and knew.</CardDescription>
        </CardHeader>
        <CardContent>
          {modules.length === 0 ? (
            <Empty className="border border-dashed py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Layers />
                </EmptyMedia>
                <EmptyTitle>No answers yet</EmptyTitle>
                <EmptyDescription>Answer a few cards to see your knowledge by area.</EmptyDescription>
              </EmptyHeader>
              <Link href="/today" className={buttonVariants({ size: "sm" })}>
                Start today’s deck <ArrowRight />
              </Link>
            </Empty>
          ) : (
            <ul className="grid gap-x-10 gap-y-5 md:grid-cols-2">
              {modules.map((m, i) => {
                const acc = Number(m.knowledge);
                const k = acc * Number(m.coverage); // mastery: accuracy on what you saw × how much of the module you saw
                return (
                  <li key={m.module}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{moduleNames.get(m.module) ?? m.module}</span>
                      <span className="font-semibold tabular-nums">{pct(k)}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <GrowBar value={k} delay={0.1 + i * 0.05} className="h-full rounded-full bg-primary" />
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                      {m.cards_seen} of {m.total_cards} cards seen · {pct(acc)} known
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {revisit.length > 0 && (
        <section>
          <SectionTitle title="Worth revisiting" description="Cards you didn’t know yet. They come back in your deck automatically." />
          <Stagger as="ul" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {revisit.map((c) => (
              <StaggerItem as="li" key={c.v}>
                <RevisitCard context={c.context} front={c.front} back={c.back} />
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      )}
    </div>
  );
}
