import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Check, CheckCheck, Download, GitCommitHorizontal, History, MessageSquareQuote, RotateCcw, X } from "lucide-react";
import { getDb, query } from "@/db/client";
import { resolveFeedback } from "@/app/actions/admin";
import { Empty, Eyebrow, Tag, TypePill, entityHref, surface } from "@/components/admin/bits";
import { Segmented } from "@/components/admin/Segmented";
import { Stagger, StaggerItem } from "@/components/common/motion";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Feedback" };

const STATUSES = ["open", "accepted", "applied", "rejected", "stale", "all"] as const;

interface Row {
  id: number;
  status: string;
  category: string;
  suggested_text: string | null;
  comment: string | null;
  created_at: Date;
  resolution_note: string | null;
  applied_commit: string | null;
  username: string;
  display_name: string;
  card_id: string;
  field: string;
  entity_type: string;
  entity_key: string;
  entity_name: string;
  yaml_file: string;
  front: string;
  reviewed_text: string;
  reviewed_version: number;
  current_version: number;
  knew_it: boolean | null;
}

const STATUS_TONE: Record<string, "neutral" | "primary" | "success" | "warning" | "destructive"> = {
  open: "primary",
  accepted: "success",
  applied: "success",
  rejected: "destructive",
  stale: "neutral",
};

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ status?: string; card?: string }> }) {
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "open";
  const card = sp.card?.slice(0, 200);
  const db = await getDb();
  const where = [sql`true`];
  if (status !== "all") where.push(sql`f.status = ${status}`);
  if (card) where.push(sql`f.card_id = ${card}`);
  const [rows, counts] = await Promise.all([
    query<Row>(
      db,
      sql`SELECT f.id, f.status, f.category, f.suggested_text, f.comment, f.created_at, f.resolution_note, f.applied_commit,
                 u.username, u.display_name, f.card_id, f.source_field AS field,
                 e.type AS entity_type, e.key AS entity_key, e.name AS entity_name, e.yaml_file,
                 cv.front, cv.source_text AS reviewed_text, cv.version AS reviewed_version, cur.version AS current_version, r.knew_it
          FROM feedback f
          JOIN users u ON u.id = f.user_id
          JOIN kb_entities e ON e.id = f.entity_id
          JOIN card_versions cv ON cv.id = f.card_version_id
          JOIN cards c ON c.id = f.card_id
          JOIN card_versions cur ON cur.id = c.current_version_id
          LEFT JOIN reviews r ON r.id = f.review_id
          WHERE ${sql.join(where, sql` AND `)}
          ORDER BY f.created_at DESC LIMIT 200`,
    ),
    query<{ status: string; n: number }>(db, sql`SELECT status::text, count(*)::int AS n FROM feedback GROUP BY 1`),
  ]);
  const count = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  count.all = counts.reduce((a, c) => a + c.n, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          id="feedback-status"
          className="min-w-0 flex-1"
          active={status}
          items={STATUSES.map((s) => ({ key: s, label: s, href: `/admin/feedback?status=${s}`, count: count[s] ?? 0 }))}
        />
        <a className={buttonVariants({ variant: "outline" })} href={`/api/admin/export/feedback?format=csv${status !== "all" ? `&status=${status}` : ""}`}>
          <Download /> CSV
        </a>
        <a className={buttonVariants({ variant: "outline" })} href={`/api/admin/export/feedback?format=jsonl${status !== "all" ? `&status=${status}` : ""}`}>
          <Download /> JSONL
        </a>
      </div>
      {card && (
        <p className="flex flex-wrap items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          Filtered to card <span className="font-mono text-xs text-foreground">{card}</span> ·
          <Link href={`/admin/feedback?status=${status}`} className="font-medium text-primary hover:underline">
            clear
          </Link>
        </p>
      )}
      {rows.length === 0 ? (
        <Empty title={`No ${status === "all" ? "" : status} feedback`} icon={<MessageSquareQuote />}>
          Suggestions from the daily decks show up here.
        </Empty>
      ) : (
        <Stagger as="ul" className="space-y-3">
          {rows.map((r) => (
            <StaggerItem as="li" key={r.id} className={cn(surface, "p-4 sm:p-5")} data-testid="feedback-item">
              <div className="flex flex-wrap items-center gap-2">
                <TypePill type={r.entity_type} />
                <Link href={entityHref(r.entity_type, r.entity_key)} className="font-medium hover:text-primary hover:underline">
                  {r.entity_name}
                </Link>
                <Tag tone="warning" className="capitalize">
                  {r.category}
                </Tag>
                {status === "all" && (
                  <Tag tone={STATUS_TONE[r.status] ?? "neutral"} className="capitalize">
                    {r.status}
                  </Tag>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {r.display_name} ({r.username}) · {new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </div>
              <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
                {r.yaml_file} → {r.entity_key} → {r.field}
              </p>
              <p className="mt-3 text-sm font-medium whitespace-pre-line">{r.front}</p>
              {r.reviewed_version !== r.current_version && (
                <p className="mt-2 flex items-center gap-2 rounded-lg bg-warning/12 px-3 py-2 text-xs text-warning">
                  <History className="size-3.5 shrink-0" />
                  Reviewed v{r.reviewed_version}; the YAML has since changed (now v{r.current_version}).
                </p>
              )}
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <Eyebrow>Current YAML text</Eyebrow>
                  <p className="rounded-lg bg-muted/60 p-3 text-sm whitespace-pre-line">{r.reviewed_text}</p>
                </div>
                <div>
                  <Eyebrow>Suggested</Eyebrow>
                  {r.suggested_text ? (
                    <p className="rounded-lg border border-success/20 bg-success/[0.06] p-3 text-sm whitespace-pre-line">{r.suggested_text}</p>
                  ) : (
                    <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No text change proposed.</p>
                  )}
                </div>
              </div>
              {r.comment && (
                <p className="mt-3 text-sm">
                  <span className="font-medium">Comment: </span>
                  {r.comment}
                </p>
              )}
              {r.knew_it !== null && <p className="mt-1 text-xs text-muted-foreground">Reviewer {r.knew_it ? "knew" : "did not know"} the card.</p>}
              {r.resolution_note && <p className="mt-2 text-xs text-muted-foreground">Note: {r.resolution_note}</p>}
              {r.applied_commit && (
                <p className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                  <GitCommitHorizontal className="size-3.5" /> Applied in {r.applied_commit}
                </p>
              )}

              <Separator className="my-4" />
              <form action={resolveFeedback} className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <input type="hidden" name="feedbackId" value={r.id} />
                <Input name="note" className="lg:flex-1" placeholder="Resolution note (optional)" maxLength={2000} aria-label="Resolution note" />
                <Input name="commit" className="font-mono lg:w-40" placeholder="Commit (if applied)" maxLength={80} aria-label="Commit" />
                <div className="flex flex-wrap gap-2">
                  {r.status !== "accepted" && (
                    <button name="status" value="accepted" className={cn(buttonVariants(), "bg-success/10 text-success hover:bg-success/20")}>
                      <Check /> Accept
                    </button>
                  )}
                  {r.status !== "applied" && (
                    <button name="status" value="applied" className={buttonVariants()}>
                      <CheckCheck /> Applied
                    </button>
                  )}
                  {r.status !== "rejected" && (
                    <button name="status" value="rejected" className={buttonVariants({ variant: "destructive" })}>
                      <X /> Reject
                    </button>
                  )}
                  {r.status !== "open" && (
                    <button name="status" value="open" className={buttonVariants({ variant: "outline" })}>
                      <RotateCcw /> Reopen
                    </button>
                  )}
                </div>
              </form>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}
