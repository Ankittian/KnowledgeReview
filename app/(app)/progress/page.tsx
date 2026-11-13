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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export const metadata: Metadata = { title: "Progress" };

const pct = (n: number | null | undefined) => (n == null ? "–" : `${Math.round(n * 100)}%`);
const dayLabel = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

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
  const chart: DayPoint[] = days.map((d) => {
    const c = daily.get(d);
    return { date: d, label: d === today ? "Today" : dayLabel(d), knew: c?.knew ?? 0, missed: c ? c.n - c.knew : 0 };
  });
  const last28 = chart.reduce((a, d) => a + d.knew + d.missed, 0);
  const activeDays = chart.filter((d) => d.knew + d.missed > 0).length;

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
          <CardTitle>Last 4 weeks</CardTitle>
          <CardDescription>
            {last28.toLocaleString()} answer{last28 === 1 ? "" : "s"} across {activeDays} active day{activeDays === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityChart data={chart} />
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>Knowledge by area</CardTitle>
          <CardDescription>How well you know each module, and how much of it you have seen.</CardDescription>
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
                const k = Number(m.knowledge);
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
                      {m.cards_seen} of {m.total_cards} cards seen · {pct(Number(m.coverage))} coverage
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
