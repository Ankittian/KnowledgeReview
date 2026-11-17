"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Tag, type Tone } from "@/components/admin/bits";
import { Segmented } from "@/components/admin/Segmented";
export { ago } from "@/lib/cards/generate/format";
import { JOB_STATUS_LABEL, type JobStatus } from "@/lib/cards/generate/config";

const STATUS_TONE: Record<JobStatus, Tone> = {
  queued: "neutral",
  generating: "primary",
  ready: "success",
  pushing: "primary",
  pushed: "success",
  failed: "destructive",
  cancelled: "outline",
};

export const StatusBadge = ({ status }: { status: string }) => <Tag tone={STATUS_TONE[status as JobStatus] ?? "neutral"}>{JOB_STATUS_LABEL[status as JobStatus] ?? status}</Tag>;

/** New generation | Jobs, shown at the top of every Cards page. */
export const CardsTabs = ({ active }: { active: "new" | "jobs" }) => (
  <Segmented
    id="cards-tabs"
    active={active}
    items={[
      { key: "new", label: "New generation", href: "/admin/cards/new" },
      { key: "jobs", label: "Jobs", href: "/admin/cards" },
    ]}
  />
);

/** Re-reads the page from the server every few seconds while `active`, so progress and new jobs show up by themselves. */
export function AutoRefresh({ active, every = 4000 }: { active: boolean; every?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, every);
    return () => clearInterval(t);
  }, [active, every, router]);
  return null;
}
