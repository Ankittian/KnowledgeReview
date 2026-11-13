import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { Check, Download, RotateCcw, X } from "lucide-react";
import { getDb, query } from "@/db/client";
import { resolveFeedback } from "@/app/actions/admin";
import { Empty, TypePill, entityHref } from "@/components/admin/bits";

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

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ status?: string; card?: string }> }) {
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "open";
  const card = sp.card?.slice(0, 200);
  const db = await getDb();
  const where = [sql`true`];
  if (status !== "all") where.push(sql`f.status = ${status}`);
  if (card) where.push(sql`c.id = ${card}`);
  const [rows, counts] = await Promise.all([
    query<Row>(
      db,
      sql`SELECT f.id, f.status, f.category, f.suggested_text, f.comment, f.created_at, f.resolution_note, f.applied_commit,
                 u.username, u.display_name, c.id AS card_id, c.source_field AS field,
                 e.type AS entity_type, e.key AS entity_key, e.name AS entity_name, e.yaml_file,
                 cv.front, cv.source_text AS reviewed_text, cv.version AS reviewed_version, cur.version AS current_version, r.knew_it
          FROM card_feedback f
          JOIN users u ON u.id = f.user_id
          JOIN card_versions cv ON cv.id = f.card_version_id
          JOIN cards c ON c.id = cv.card_id
          JOIN kb_items e ON e.id = c.kb_item_id
          JOIN card_versions cur ON cur.id = c.current_version_id
          LEFT JOIN card_reviews r ON r.id = f.review_id
          WHERE ${sql.join(where, sql` AND `)}
          ORDER BY f.created_at DESC LIMIT 200`,
    ),
    query<{ status: string; n: number }>(db, sql`SELECT status::text, count(*)::int AS n FROM card_feedback GROUP BY 1`),
  ]);
  const count = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  count.all = counts.reduce((a, c) => a + c.n, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/feedback?status=${s}`} className={`chip px-3 py-1.5 text-sm capitalize ${status === s ? "bg-primary text-on-primary" : "hover:bg-border"}`}>
            {s} <span className="opacity-70 tabular-nums">{count[s] ?? 0}</span>
          </Link>
        ))}
        <a className="btn btn-outline ml-auto py-2" href={`/api/admin/export/feedback?format=csv${status !== "all" ? `&status=${status}` : ""}`}>
          <Download className="h-4 w-4" /> CSV
        </a>
        <a className="btn btn-outline py-2" href={`/api/admin/export/feedback?format=jsonl${status !== "all" ? `&status=${status}` : ""}`}>
          <Download className="h-4 w-4" /> JSONL
        </a>
      </div>
      {card && (
        <p className="text-sm text-muted">
          Filtered to card <span className="font-mono">{card}</span> ·{" "}
          <Link href={`/admin/feedback?status=${status}`} className="font-semibold text-primary hover:underline">clear</Link>
        </p>
      )}
      {rows.length === 0 ? (
        <Empty title={`No ${status === "all" ? "" : status} feedback`}>Suggestions from the daily decks show up here.</Empty>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => (
            <li key={r.id} className="panel p-4 sm:p-5" data-testid="feedback-item">
              <div className="flex flex-wrap items-center gap-2">
                <TypePill type={r.entity_type} />
                <Link href={entityHref(r.entity_type, r.entity_key)} className="font-semibold hover:text-primary hover:underline">
                  {r.entity_name}
                </Link>
                <span className="chip bg-warning-soft font-semibold text-warning capitalize">{r.category}</span>
                <span className="ml-auto text-xs text-muted">
                  {r.display_name} ({r.username}) · {new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </div>
              <p className="mt-1 font-mono text-[11px] break-all text-muted">
                {r.yaml_file} → {r.entity_key} → {r.field}
              </p>
              <p className="mt-3 text-sm font-medium whitespace-pre-line">{r.front}</p>
              {r.reviewed_version !== r.current_version && (
                <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
                  Reviewed v{r.reviewed_version}; the YAML has since changed (now v{r.current_version}).
                </p>
              )}
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Current YAML text</p>
                  <p className="rounded-xl bg-surface-2 p-3 text-sm whitespace-pre-line">{r.reviewed_text}</p>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Suggested</p>
                  {r.suggested_text ? (
                    <p className="rounded-xl bg-success-soft p-3 text-sm whitespace-pre-line">{r.suggested_text}</p>
                  ) : (
                    <p className="rounded-xl border border-dashed border-border p-3 text-sm text-muted">No text change proposed.</p>
                  )}
                </div>
              </div>
              {r.comment && (
                <p className="mt-3 text-sm">
                  <span className="font-semibold">Comment: </span>
                  {r.comment}
                </p>
              )}
              {r.knew_it !== null && <p className="mt-1 text-xs text-muted">Reviewer {r.knew_it ? "knew" : "did not know"} the card.</p>}
              {r.resolution_note && <p className="mt-2 text-xs text-muted">Note: {r.resolution_note}</p>}
              {r.applied_commit && <p className="mt-1 font-mono text-xs text-muted">Applied in {r.applied_commit}</p>}

              <form action={resolveFeedback} className="mt-4 flex flex-col gap-2 border-t border-border pt-4 lg:flex-row lg:items-center">
                <input type="hidden" name="feedbackId" value={r.id} />
                <input name="note" className="input py-2 text-sm lg:flex-1" placeholder="Resolution note (optional)" maxLength={2000} />
                <input name="commit" className="input py-2 font-mono text-sm lg:w-40" placeholder="Commit (if applied)" maxLength={80} />
                <div className="flex flex-wrap gap-2">
                  {r.status !== "accepted" && (
                    <button name="status" value="accepted" className="btn btn-success py-2">
                      <Check className="h-4 w-4" /> Accept
                    </button>
                  )}
                  {r.status !== "applied" && (
                    <button name="status" value="applied" className="btn btn-primary py-2">
                      Applied
                    </button>
                  )}
                  {r.status !== "rejected" && (
                    <button name="status" value="rejected" className="btn btn-danger py-2">
                      <X className="h-4 w-4" /> Reject
                    </button>
                  )}
                  {r.status !== "open" && (
                    <button name="status" value="open" className="btn btn-outline py-2">
                      <RotateCcw className="h-4 w-4" /> Reopen
                    </button>
                  )}
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

