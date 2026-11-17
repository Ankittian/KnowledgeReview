"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cancelGenerationJob, retryGenerationJob } from "@/app/actions/card-generation";
import { TableCard, tcell, thead } from "@/components/admin/bits";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ACTIVE_STATUSES, type JobStatus } from "@/lib/cards/generate/config";
import type { JobSummary } from "@/lib/cards/generate/summary";
import { cn } from "@/lib/utils";
import { AutoRefresh, StatusBadge, ago } from "./bits";


export function JobActions({ job }: { job: JobSummary }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        router.refresh();
      } else toast.error(r.error ?? "Failed");
    });
  const s = job.status as JobStatus;
  return (
    <div className="flex justify-end gap-1.5">
      {(s === "queued" || s === "generating") && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => cancelGenerationJob(job.id), s === "queued" ? "Job cancelled." : "Stopping after the current step.")}>
          Cancel
        </Button>
      )}
      {(s === "failed" || s === "cancelled") && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryGenerationJob(job.id), "Job queued again.")}>
          Retry
        </Button>
      )}
      {s === "ready" ? (
        <Link href={`/admin/cards/${job.id}`} className={buttonVariants({ size: "sm" })} data-testid={`review-${job.id}`}>
          Review
        </Link>
      ) : (
        <Link href={`/admin/cards/${job.id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
          View
        </Link>
      )}
    </div>
  );
}

export function JobsTable({ jobs }: { jobs: JobSummary[] }) {
  return (
    <>
      <AutoRefresh active={jobs.some((j) => ACTIVE_STATUSES.includes(j.status as JobStatus))} />
      <TableCard>
        <Table>
          <TableHeader className={thead}>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Items</TableHead>
              <TableHead className="text-right">Cards</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((j) => (
              <TableRow key={j.id} data-testid={`job-${j.id}`}>
                <TableCell className={tcell}>
                  <p className="font-medium capitalize">{j.level} level · {j.audience}</p>
                  <p className="text-xs text-muted-foreground">
                    #{j.id} · {j.modules.join(", ")}
                  </p>
                </TableCell>
                <TableCell className={cn(tcell, "max-w-64 text-muted-foreground")}>{j.itemsLabel}</TableCell>
                <TableCell className={cn(tcell, "text-right tabular-nums")}>{j.generated ?? j.requested}</TableCell>
                <TableCell className={tcell}>
                  <StatusBadge status={j.status} />
                  {j.status === "generating" && j.progress.total > 0 && (
                    <div className="mt-1.5 w-28">
                      <Progress value={(j.progress.done / j.progress.total) * 100}>
                        <ProgressTrack>
                          <ProgressIndicator />
                        </ProgressTrack>
                      </Progress>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Step {Math.min(j.progress.done + 1, j.progress.total)} of {j.progress.total}
                      </p>
                    </div>
                  )}
                  {j.status === "pushed" && j.pushed && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {j.pushed.inserted} new, {j.pushed.updated} updated
                    </p>
                  )}
                  {j.status === "failed" && j.error && <p className="mt-1 max-w-56 text-xs text-destructive">{j.error.slice(0, 120)}</p>}
                </TableCell>
                <TableCell className={cn(tcell, "text-muted-foreground")} suppressHydrationWarning>
                  {ago(j.createdAt)}
                </TableCell>
                <TableCell className={tcell}>
                  <JobActions job={j} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </>
  );
}
