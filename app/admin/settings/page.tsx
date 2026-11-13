import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { Download } from "lucide-react";
import { getDb } from "@/db/client";
import { activityLog } from "@/db/schema";
import { saveDailyCardLimit } from "@/app/actions/admin";
import { SyncButton } from "@/components/admin/SyncButton";
import { requireRole } from "@/lib/auth/session";
import { kbDir } from "@/lib/kb-sync";
import { DAILY_LIMIT_MAX, DAILY_LIMIT_MIN, getDailyCardLimit } from "@/lib/settings";

export const metadata: Metadata = { title: "Settings & exports" };

const EXPORTS = [
  { name: "needs-change", label: "What needs change", desc: "One row per flagged YAML file + key + field, with linked forms, processes and suggestions.", formats: ["jsonl", "csv", "md"] },
  { name: "feedback", label: "All feedback", desc: "Every suggestion with category, text reviewed, suggested text and status.", formats: ["jsonl", "csv"] },
  { name: "reviews", label: "All reviews", desc: "Every answer: knew it, verdict, timings, device, source entity and field.", formats: ["csv", "jsonl"] },
  { name: "knowledge", label: "Employee knowledge", desc: "Knowledge and coverage per employee and area.", formats: ["csv", "jsonl"] },
  { name: "events", label: "Interaction log (30 days)", desc: "Every logged interaction: sign-ins, cards shown, flips, answers, feedback.", formats: ["csv", "jsonl"] },
];

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
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="panel p-5">
        <h2 className="font-semibold">Cards per day</h2>
        <p className="mt-1 text-sm text-muted">
          Each sign-in gets a new random set of cards. This is the most cards an employee is shown in one day, across all
          their sign-ins. It applies right away; cards already answered today count toward it.
        </p>
        <form action={saveDailyCardLimit} className="mt-4 flex items-end gap-2">
          <div>
            <label className="label" htmlFor="dailyLimit">Cards per day</label>
            <input id="dailyLimit" name="dailyLimit" type="number" min={DAILY_LIMIT_MIN} max={DAILY_LIMIT_MAX} defaultValue={dailyLimit} className="input w-28" required />
          </div>
          <button className="btn btn-primary" data-testid="save-daily-limit">Save</button>
        </form>
      </section>

      <section className="panel p-5">
        <h2 className="font-semibold">Knowledge base sync</h2>
        <p className="mt-1 text-sm text-muted">
          Rebuilds cards from the YAML in <span className="font-mono text-xs break-all">{kbDir()}</span>. Changed text creates a new card version; open
          feedback on changed cards is marked stale.
        </p>
        <SyncButton />
        {syncs.length > 0 && (
          <ul className="mt-4 space-y-1.5 text-xs text-muted">
            {syncs.map((s) => {
              const d = s.details as { changed?: boolean; cards?: { inserted: number; newVersions: number; retired: number }; via?: string };
              return (
                <li key={s.id}>
                  {new Date(s.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {d.via} ·{" "}
                  {d.changed ? `${d.cards?.inserted ?? 0} new, ${d.cards?.newVersions ?? 0} updated, ${d.cards?.retired ?? 0} retired` : "no changes"}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {quality.length > 0 && (
        <section className="panel p-5 lg:col-span-2">
          <h2 className="font-semibold">
            Data-quality findings in the YAML <span className="chip ml-1 bg-warning-soft text-warning">{quality.length}</span>
          </h2>
          <p className="mt-1 text-sm text-muted">
            Found automatically during the last sync. The cards are still issued so employees can suggest the missing text.
          </p>
          <ul className="mt-3 divide-y divide-border text-sm">
            {quality.map((q, i) => (
              <li key={i} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:gap-3">
                <span className={`chip shrink-0 ${q.issue === "truncated" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"}`}>
                  {q.issue === "truncated" ? "text cut off" : "quote artifact"}
                </span>
                <span className="font-mono text-xs break-all text-muted">
                  {q.yaml_file} → {q.key} → {q.field}
                </span>
                <span className="text-xs sm:ml-auto sm:max-w-[40%] sm:truncate">{q.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel p-5 lg:col-span-2">
        <h2 className="font-semibold">Exports</h2>
        <p className="mt-1 text-sm text-muted">Every export is keyed to the source YAML (file, key, field), so it can be applied straight back to the knowledge base.</p>
        <ul className="mt-4 divide-y divide-border">
          {EXPORTS.map((e) => (
            <li key={e.name} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="font-medium">{e.label}</p>
                <p className="text-xs text-muted">{e.desc}</p>
              </div>
              <div className="flex gap-2">
                {e.formats.map((f) => (
                  <a key={f} href={`/api/admin/export/${e.name}?format=${f}`} className="btn btn-outline py-1.5 text-xs uppercase">
                    <Download className="h-3.5 w-3.5" /> {f}
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
