import { sql } from "drizzle-orm";
import { query, type DB } from "@/db/client";
import { audienceOf, jobParamsSchema, type Audience } from "./config";
import type { JobRow } from "./jobs";

/** What the jobs list shows for one job. Plain data (no Date objects), so a server page can hand it to a client table. */
export interface JobSummary {
  id: number;
  level: string;
  audience: Audience;
  status: string;
  modules: string[];
  itemsLabel: string;
  requested: number;
  generated: number | null;
  progress: { done: number; total: number };
  createdAt: string;
  error: string | null;
  pushed: { inserted: number; updated: number } | null;
}

export async function summarizeJobs(db: DB, jobs: JobRow[]): Promise<JobSummary[]> {
  const counts = new Map<number, number>();
  if (jobs.length) {
    const rows = await query<{ job_id: number; n: number }>(
      db,
      sql`SELECT job_id, count(*)::int AS n FROM generated_cards WHERE status = 'draft' AND job_id IN (${sql.join(jobs.map((j) => sql`${j.id}`), sql`, `)}) GROUP BY job_id`,
    );
    for (const r of rows) counts.set(r.job_id, Number(r.n));
  }
  return jobs.map((j) => {
    const p = jobParamsSchema.safeParse(j.params);
    const items = p.success ? p.data.items : [];
    const names = items.map((i) => i.title);
    const push = (j.report as { push?: { previews?: { inserted: number; newVersion: number }[] } }).push;
    return {
      id: j.id,
      level: j.level,
      audience: audienceOf(j.params),
      status: j.status,
      modules: [...new Set(items.map((i) => i.module))],
      itemsLabel: names.length > 3 ? `${names.slice(0, 3).join(", ")}, +${names.length - 3}` : names.join(", "),
      requested: items.reduce((n, i) => n + i.easy + i.medium + i.hard, 0),
      generated: counts.has(j.id) ? counts.get(j.id)! : null,
      progress: j.progress,
      createdAt: j.createdAt.toISOString(),
      error: j.error,
      pushed: push?.previews ? { inserted: push.previews.reduce((n, x) => n + x.inserted, 0), updated: push.previews.reduce((n, x) => n + x.newVersion, 0) } : null,
    };
  });
}
