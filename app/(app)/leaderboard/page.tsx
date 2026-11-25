import type { Metadata } from "next";
import Link from "next/link";
import { Medal, Trophy, UserRound } from "lucide-react";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/session";
import { FLAG_POINTS_MULTIPLIER, LEVELS } from "@/lib/cards/spec";
import { getModuleNames } from "@/lib/deck";
import { getLeaderboard, type LeaderboardPeriod } from "@/lib/leaderboard";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Leaderboard" };

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "all", label: "All time" },
];

/** "● 2": the card colour (as on the Browse cards) and the points it is worth. */
function PointsKey({ dot, label, points }: { dot: string; label: string; points: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-foreground" title={`${label} cards`}>
      <span className={`size-2.5 rounded-full ${dot}`} aria-hidden />
      {points}
      <span className="sr-only"> for {label} cards</span>
    </span>
  );
}

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ period?: string; module?: string }> }) {
  const { user } = await requireUser();
  const sp = await searchParams;
  const period: LeaderboardPeriod = sp.period === "all" ? "all" : "week";
  const db = await getDb();
  const moduleNames = await getModuleNames(db);
  const module = sp.module && moduleNames.has(sp.module) ? sp.module : null;
  const rows = await getLeaderboard(db, period, user.id, module);
  const me = rows.find((r) => r.isMe);
  const areaName = module ? (moduleNames.get(module) ?? module) : "All areas";

  /** Builds a link that keeps the other filter. */
  const href = (p: LeaderboardPeriod, m: string | null) => {
    const qs = new URLSearchParams();
    if (p === "all") qs.set("period", "all");
    if (m) qs.set("module", m);
    const s = qs.toString();
    return s ? `/leaderboard?${s}` : "/leaderboard";
  };
  const pill = (active: boolean) =>
    cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");

  return (
    <div className="w-full space-y-6 px-4 pt-6 sm:px-6 sm:pt-8 lg:px-8">
      <PageHeader
        title="Leaderboard"
        description={
          <>
            Points per card: <PointsKey dot="bg-success" label="easy" points={LEVELS.easy.weight} />,{" "}
            <PointsKey dot="bg-yellow-400" label="medium" points={LEVELS.medium.weight} />,{" "}
            <PointsKey dot="bg-destructive" label="hard" points={LEVELS.hard.weight} />. Reporting a card as incorrect or incomplete earns {FLAG_POINTS_MULTIPLIER}× its points.
            Each card scores once, from your first answer.
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav className="inline-flex rounded-lg bg-muted p-1" aria-label="Period">
            {PERIODS.map((p) => (
              <Link key={p.value} href={href(p.value, module)} aria-current={period === p.value ? "page" : undefined} className={pill(period === p.value)}>
                {p.label}
              </Link>
            ))}
          </nav>
        </div>
        <nav className="flex flex-wrap gap-1.5" aria-label="Area">
          <Link href={href(period, null)} aria-current={!module ? "page" : undefined} className={cn(buttonVariants({ variant: module ? "outline" : "default", size: "sm" }), "h-7 px-2.5 text-xs")}>
            All areas
          </Link>
          {[...moduleNames].map(([code, name]) => (
            <Link
              key={code}
              href={href(period, code)}
              aria-current={module === code ? "page" : undefined}
              className={cn(buttonVariants({ variant: module === code ? "default" : "outline", size: "sm" }), "h-7 px-2.5 text-xs")}
            >
              {name}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={<Trophy />}
          tone="primary"
          label="Your points"
          value={me?.points ?? 0}
          sub={`${period === "week" ? "this week" : "all time"}${module ? ` · ${areaName}` : ""}`}
        />
        <StatCard
          icon={<Medal />}
          tone="warning"
          label="Your rank"
          value={me ? `#${me.rank}` : "–"}
          sub={me ? `of ${rows.length} player${rows.length === 1 ? "" : "s"}` : "Not ranked yet"}
        />
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>
            {period === "week" ? "This week" : "All time"} · {areaName}
          </CardTitle>
          <CardDescription>
            {rows.length} player{rows.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <Empty className="border border-dashed py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Trophy />
                </EmptyMedia>
                <EmptyTitle>No points yet</EmptyTitle>
                <EmptyDescription>Answer a correct card in today’s deck to start the board.</EmptyDescription>
              </EmptyHeader>
              <Link href="/today" className={buttonVariants({ size: "sm" })}>
                Go to today’s deck
              </Link>
            </Empty>
          ) : (
            <ol className="divide-y" data-testid="leaderboard">
              {rows.map((r) => {
                const top = r.rank === 1 && r.points > 0; // the leader: a golden row that sits a little proud of the list
                return (
                <li
                  key={r.userId}
                  className={cn(
                    "flex items-center gap-3 py-2.5",
                    r.isMe && !top && "-mx-2 rounded-xl bg-primary/8 px-2",
                    top && "-mx-2 my-0.5 rounded-xl bg-[#f2c200]/20 px-2 py-3 ring-1 ring-[#f2c200]/45",
                  )}
                  data-testid={r.isMe ? "leaderboard-me" : top ? "leaderboard-top" : "leaderboard-row"}
                >
                  <span className={cn("w-8 shrink-0 text-center font-mono text-sm font-semibold tabular-nums", top ? "text-[#8a6a00] dark:text-[#f0cf3d]" : r.rank <= 3 ? "text-warning" : "text-muted-foreground")}>
                    {r.rank}
                  </span>
                  <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", top && "font-semibold")}>
                    {r.name}
                    {r.isMe && <span className="ml-1.5 text-xs font-normal text-primary">(you)</span>}
                  </span>
                  <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
                    {r.cards} card{r.cards === 1 ? "" : "s"}
                  </span>
                  <span className={cn("w-16 text-right text-sm font-semibold tabular-nums", top && "text-[#8a6a00] dark:text-[#f0cf3d]")}>{r.points} pts</span>
                </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
