import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { getDb } from "@/db/client";
import { StatusBadge, AutoRefresh } from "@/components/admin/cards/bits";
import { ago } from "@/lib/cards/generate/format";
import { JobActions } from "@/components/admin/cards/JobsTable";
import { ReviewClient, type ReviewCard } from "@/components/admin/cards/ReviewClient";
import { surface } from "@/components/admin/bits";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { requireRole } from "@/lib/auth/session";
import { ACTIVE_STATUSES, type JobStatus } from "@/lib/cards/generate/config";
import { getJob, loadCards } from "@/lib/cards/generate/jobs";
import { summarizeJobs } from "@/lib/cards/generate/summary";

export const metadata: Metadata = { title: "Review generated cards" };

interface Report {
  failedBatches?: { items: string[]; error: string }[];
  shortfalls?: { item: string; level: string; wanted: number; got: number }[];
  dropped?: { group: string; title: string; reason: string }[];
  previewError?: string;
}

export default async function CardJobPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = await getDb();
  const job = await getJob(db, id);
  if (!job) notFound();
  const [summary] = await summarizeJobs(db, [job]);
  const status = job.status as JobStatus;
  const report = job.report as Report;
  const reviewable = ["ready", "pushing", "pushed"].includes(status);
  const cards: ReviewCard[] = reviewable ? (await loadCards(db, id)).map((c) => ({ ...c, level: c.level, context: c.context, warnings: c.warnings })) : [];
  const issues = [
    ...(report.failedBatches ?? []).map((f) => `Could not generate ${f.items.join(", ")}: ${f.error}`),
    ...(report.shortfalls ?? []).map((s) => `${s.item}: ${s.got} of ${s.wanted} ${s.level} cards`),
    ...(report.dropped ?? []).map((d) => `Dropped a card (${d.reason}): ${d.title}`),
    ...(report.previewError ? [`The dry run failed: ${report.previewError}`] : []),
  ];

  return (
    <div className="space-y-5">
      <AutoRefresh active={ACTIVE_STATUSES.includes(status)} />
      <Link href="/admin/cards" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> All jobs
      </Link>

      <div className={`${surface} flex flex-wrap items-center gap-x-6 gap-y-2 p-4`}>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold capitalize">
            Job #{job.id} · {summary.audience} · {job.level} level <StatusBadge status={job.status} />
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {summary.itemsLabel} · {ago(summary.createdAt)}
          </p>
        </div>
        <JobActions job={summary} />
      </div>

      {(status === "queued" || status === "generating") && (
        <div className={`${surface} space-y-3 p-5`} data-testid="job-progress">
          <p className="text-sm font-medium">{status === "queued" ? "Queued" : `Step ${Math.min(job.progress.done + 1, job.progress.total || 1)} of ${job.progress.total || "…"}`}</p>
          <Progress value={job.progress.total ? (job.progress.done / job.progress.total) * 100 : 0}>
            <ProgressTrack>
              <ProgressIndicator />
            </ProgressTrack>
          </Progress>
        </div>
      )}

      {(status === "failed" || status === "cancelled") && (
        <div className={`${surface} p-6 text-sm`}>
          {status === "failed" ? <p className="text-destructive">{job.error ?? "The job failed."}</p> : <p>This job was cancelled.</p>}
          {issues.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{issues[0]}</p>}
        </div>
      )}

      {reviewable && issues.length > 0 && (
        <details className="rounded-xl bg-warning/10 p-4 text-sm text-warning">
          <summary className="flex cursor-pointer items-center gap-2 font-medium">
            <TriangleAlert className="size-4" /> {issues.length} note{issues.length === 1 ? "" : "s"} from the generation
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-xs">
            {issues.slice(0, 30).map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </details>
      )}

      {reviewable && <ReviewClient jobId={job.id} status={status} audience={summary.audience} initial={cards} />}
    </div>
  );
}
