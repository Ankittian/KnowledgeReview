import { sql } from "drizzle-orm";
import { FileText, ShieldCheck, TriangleAlert } from "lucide-react";
import { getDb, query } from "@/db/client";
import { surface } from "@/components/admin/bits";
import { GrowBar, Stagger, StaggerItem } from "@/components/common/motion";
import { SectionTitle } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { getModuleNames } from "@/lib/deck";
import { cn } from "@/lib/utils";

const n = (s: string | number | undefined) => Number(s ?? 0);

/** Card Feedbacks > Overview: how much of the knowledge base has been checked, and by area. */
export async function OverviewTab({ module }: { module: string }) {
  const db = await getDb();
  const moduleNames = await getModuleNames(db);
  const modFilter = module ? sql`AND module = ${module}` : sql``;
  const [[k], coverage] = await Promise.all([
    query<Record<string, string>>(
      db,
      sql`SELECT count(*) AS active_cards,
                 count(*) FILTER (WHERE reviewers > 0) AS reviewed,
                 count(*) FILTER (WHERE reviewers >= 3 AND improve_votes = 0) AS verified,
                 count(*) FILTER (WHERE improve_votes > 0) AS flagged,
                 coalesce(sum(open_feedback), 0) AS open_feedback
          FROM card_health WHERE status = 'active' ${modFilter}`,
    ),
    query<{ module: string | null; cards: string; reviewed: string; verified: string; flagged: string }>(
      db,
      sql`SELECT module, count(*) AS cards, count(*) FILTER (WHERE reviewers > 0) AS reviewed,
                 count(*) FILTER (WHERE reviewers >= 3 AND improve_votes = 0) AS verified,
                 count(*) FILTER (WHERE improve_votes > 0) AS flagged
          FROM card_health WHERE status = 'active' GROUP BY module ORDER BY count(*) DESC`,
    ),
  ]);
  const reviewedShare = n(k.reviewed) / Math.max(1, n(k.active_cards));

  return (
    <div className="space-y-6">
      <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StaggerItem>
          <StatCard
            label="Reviewed"
            value={reviewedShare}
            percent
            decimals={reviewedShare > 0 && reviewedShare < 0.1 ? 1 : 0}
            sub={`${n(k.reviewed).toLocaleString()} of ${n(k.active_cards).toLocaleString()} cards`}
            icon={<FileText />}
            tone="primary"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Verified" value={n(k.verified)} sub="3+ correct, 0 flags" valueTone="success" icon={<ShieldCheck />} tone="success" />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Flagged" value={n(k.flagged)} sub={`${n(k.open_feedback)} open suggestions`} valueTone="warning" icon={<TriangleAlert />} tone="warning" />
        </StaggerItem>
      </Stagger>

      <section className={cn(surface, "p-5")}>
        <SectionTitle
          title="Coverage by area"
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
    </div>
  );
}
