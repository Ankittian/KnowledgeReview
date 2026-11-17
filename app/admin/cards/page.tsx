import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getDb } from "@/db/client";
import { CardsTabs } from "@/components/admin/cards/bits";
import { JobsTable } from "@/components/admin/cards/JobsTable";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { requireRole } from "@/lib/auth/session";
import { listJobs } from "@/lib/cards/generate/jobs";
import { summarizeJobs } from "@/lib/cards/generate/summary";

export const metadata: Metadata = { title: "Cards" };

/** Jobs list: every generation request with its status. Refreshes itself while a job is running. */
export default async function CardJobsPage() {
  await requireRole(["admin"]);
  const db = await getDb();
  const jobs = await summarizeJobs(db, await listJobs(db));

  return (
    <div className="space-y-5">
      <CardsTabs active="jobs" />
      {jobs.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Sparkles />
            </EmptyMedia>
            <EmptyTitle>No jobs yet</EmptyTitle>
            <EmptyDescription>Generated cards will show up here for review.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link href="/admin/cards/new" className={buttonVariants()}>
              New generation
            </Link>
          </EmptyContent>
        </Empty>
      ) : (
        <JobsTable jobs={jobs} />
      )}
    </div>
  );
}
