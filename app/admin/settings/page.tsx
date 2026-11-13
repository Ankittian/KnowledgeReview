import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { Database, Download, FileWarning, Gauge, PackageOpen } from "lucide-react";
import { getDb } from "@/db/client";
import { activityLog } from "@/db/schema";
import { saveDailyCardLimit } from "@/app/actions/admin";
import { SyncButton } from "@/components/admin/SyncButton";
import { Tag, surface } from "@/components/admin/bits";
import { Stagger, StaggerItem } from "@/components/common/motion";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireRole } from "@/lib/auth/session";
import { kbDir } from "@/lib/kb-sync";
import { DAILY_LIMIT_MAX, DAILY_LIMIT_MIN, getDailyCardLimit } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings & exports" };

const EXPORTS = [
  { name: "needs-change", label: "What needs change", desc: "One row per flagged YAML file + key + field, with linked forms, processes and suggestions.", formats: ["jsonl", "csv", "md"] },
  { name: "feedback", label: "All feedback", desc: "Every suggestion with category, text reviewed, suggested text and status.", formats: ["jsonl", "csv"] },
  { name: "reviews", label: "All reviews", desc: "Every answer: knew it, verdict, timings, device, source entity and field.", formats: ["csv", "jsonl"] },
  { name: "knowledge", label: "Employee knowledge", desc: "Knowledge and coverage per employee and area.", formats: ["csv", "jsonl"] },
  { name: "events", label: "Interaction log (30 days)", desc: "Every logged interaction: sign-ins, cards shown, flips, answers, feedback.", formats: ["csv", "jsonl"] },
];

function CardHead({ icon, title, children, tone = "default" }: { icon: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; tone?: "default" | "warning" }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
          tone === "warning" ? "bg-warning/12 text-warning" : "bg-primary/10 text-primary",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {children && <div className="mt-1 text-sm text-pretty text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

export default async function SettingsPage() {
  await requireRole(["admin"]);
  const db = await getDb();
  const [dailyLimit, syncs] = await Promise.all([
    getDailyCardLimit(db),
    db.select().from(activityLog).where(eq(activityLog.action, "kb_sync")).orderBy(desc(activityLog.createdAt)).limit(5),
  ]);

  type Finding = { type: string; key: string; yaml_file: string; field: string; issue: string; text: string };
  const quality = ((syncs[0]?.details as { quality?: Finding[] } | undefined)?.quality ?? []) as Finding[];

  return (
    <Stagger className="grid gap-4 lg:grid-cols-2">
      <StaggerItem className={cn(surface, "flex flex-col p-5")}>
        <CardHead icon={<Gauge />} title="Cards per day">
          Each sign-in gets a new random set of cards. This is the most cards an employee is shown in one day, across all their sign-ins. It applies right away; cards
          already answered today count toward it.
        </CardHead>
        <form action={saveDailyCardLimit} className="mt-5 flex items-end gap-2 border-t pt-4">
          <div className="grid gap-1.5">
            <Label htmlFor="dailyLimit">Cards per day</Label>
            <Input id="dailyLimit" name="dailyLimit" type="number" min={DAILY_LIMIT_MIN} max={DAILY_LIMIT_MAX} defaultValue={dailyLimit} className="w-28 tabular-nums" required />
          </div>
          <button className={buttonVariants()} data-testid="save-daily-limit">
            Save
          </button>
          <span className="mb-2 ml-auto text-xs text-muted-foreground tabular-nums">
            {DAILY_LIMIT_MIN}–{DAILY_LIMIT_MAX}
          </span>
        </form>
      </StaggerItem>

      <StaggerItem className={cn(surface, "flex flex-col p-5")}>
        <CardHead icon={<Database />} title="Knowledge base sync">
          Rebuilds cards from the YAML in <span className="rounded bg-muted px-1 py-0.5 font-mono text-xs break-all text-foreground">{kbDir()}</span>. Changed text
          creates a new card version; open feedback on changed cards is marked stale.
        </CardHead>
        <div className="mt-5 border-t pt-4">
          <SyncButton />
        </div>
        {syncs.length > 0 && (
          <ol className="mt-4 space-y-0 border-l pl-4 text-xs">
            {syncs.map((s, i) => {
              const d = s.details as { changed?: boolean; cards?: { inserted: number; newVersions: number; retired: number }; via?: string };
              return (
                <li key={s.id} className="relative pb-2.5 last:pb-0">
                  <span
                    className={cn(
                      "absolute top-1 -left-[21px] size-2.5 rounded-full border-2 border-card",
                      i === 0 ? "bg-primary" : d.changed ? "bg-muted-foreground/60" : "bg-border",
                    )}
                  />
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground tabular-nums">{new Date(s.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span> ·{" "}
                    {d.via} ·{" "}
                    {d.changed ? `${d.cards?.inserted ?? 0} new, ${d.cards?.newVersions ?? 0} updated, ${d.cards?.retired ?? 0} retired` : "no changes"}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </StaggerItem>

      {quality.length > 0 && (
        <StaggerItem className={cn(surface, "p-5 lg:col-span-2")}>
          <CardHead
            icon={<FileWarning />}
            tone="warning"
            title={
              <span className="inline-flex items-center gap-2">
                Data-quality findings in the YAML <Tag tone="warning">{quality.length}</Tag>
              </span>
            }
          >
            Found automatically during the last sync. The cards are still issued so employees can suggest the missing text.
          </CardHead>
          <ul className="mt-4 divide-y border-t text-sm">
            {quality.map((q, i) => (
              <li key={i} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:gap-3">
                <Tag tone={q.issue === "truncated" ? "destructive" : "warning"} className="shrink-0">
                  {q.issue === "truncated" ? "text cut off" : "quote artifact"}
                </Tag>
                <span className="font-mono text-xs break-all text-muted-foreground">
                  {q.yaml_file} → {q.key} → {q.field}
                </span>
                <span className="text-xs sm:ml-auto sm:max-w-[40%] sm:truncate">{q.text}</span>
              </li>
            ))}
          </ul>
        </StaggerItem>
      )}

      <StaggerItem className={cn(surface, "p-5 lg:col-span-2")}>
        <CardHead icon={<PackageOpen />} title="Exports">
          Every export is keyed to the source YAML (file, key, field), so it can be applied straight back to the knowledge base.
        </CardHead>
        <ul className="mt-4 divide-y border-t">
          {EXPORTS.map((e) => (
            <li key={e.name} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{e.label}</p>
                <p className="text-xs text-muted-foreground">{e.desc}</p>
              </div>
              <div className="flex gap-1.5">
                {e.formats.map((f) => (
                  <a key={f} href={`/api/admin/export/${e.name}?format=${f}`} className={cn(buttonVariants({ variant: "outline", size: "xs" }), "font-mono uppercase")}>
                    <Download /> {f}
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </StaggerItem>
    </Stagger>
  );
}
