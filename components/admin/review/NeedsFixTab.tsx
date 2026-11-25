import Link from "next/link";
import { sql } from "drizzle-orm";
import { Check, GitCommitHorizontal, History, MessageSquareQuote, RotateCcw, X } from "lucide-react";
import { getDb, query } from "@/db/client";
import { resolveFeedback, resolveFlag } from "@/app/actions/admin";
import { Empty, Eyebrow, Tag, TypePill, Votes, entityHref, surface } from "@/components/admin/bits";
import { ExportMenu } from "@/components/admin/ExportMenu";
import { Segmented } from "@/components/admin/Segmented";
import { Stagger, StaggerItem } from "@/components/common/motion";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { loadFlaggers, loadNeedsChange, type NeedsChangeRow } from "@/lib/reports";
import { cn } from "@/lib/utils";

/** What an admin works with. (`applied` and `stale` still exist in the database: older rows and the knowledge-base sync use them; they show under "all".) */
export const FIX_STATUSES = ["open", "accepted", "rejected", "all"] as const;

interface Fb {
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
  reviewed_text: string;
  reviewed_version: number;
  current_version: number;
  knew_it: boolean | null;
}

interface Group {
  card_id: string;
  entity_type: string;
  entity_key: string;
  entity_name: string;
  yaml_file: string;
  field: string;
  text: string;
  flagged: NeedsChangeRow | null;
  fb: Fb[];
  rank: number;
}

const STATUS_TONE: Record<string, "neutral" | "primary" | "success" | "warning" | "destructive"> = {
  open: "primary",
  accepted: "success",
  applied: "success",
  rejected: "destructive",
  stale: "neutral",
};

const href = (status: string, card?: string) => `/admin/review?tab=fix&status=${status}${card ? `&card=${encodeURIComponent(card)}` : ""}`;

/**
 * Card Feedbacks > Suggestions: one row per card that employees flagged or wrote a suggestion for. It shows the votes, the
 * current text and every suggestion on the card, with Accept / Reject right there.
 */
export async function NeedsFixTab({ status, card, module }: { status: string; card?: string; module: string }) {
  const db = await getDb();
  const where = [sql`true`];
  if (module) where.push(sql`e.module = ${module}`);
  if (card) where.push(sql`c.id = ${card}`);
  const [flagged, fbRows] = await Promise.all([
    loadNeedsChange(db, { module: module || undefined, limit: 300 }),
    query<Fb>(
      db,
      sql`SELECT f.id, f.status, f.category, f.suggested_text, f.comment, f.created_at, f.resolution_note, f.applied_commit,
                 u.username, u.display_name, c.id AS card_id, c.source_field AS field,
                 e.type AS entity_type, e.key AS entity_key, e.name AS entity_name, e.yaml_file,
                 cv.source_text AS reviewed_text, cv.version AS reviewed_version, cur.version AS current_version, r.knew_it
          FROM card_feedback f
          JOIN users u ON u.id = f.user_id
          JOIN card_versions cv ON cv.id = f.card_version_id
          JOIN cards c ON c.id = cv.card_id
          JOIN kb_items e ON e.id = c.kb_item_id
          JOIN card_versions cur ON cur.id = c.current_version_id
          LEFT JOIN card_reviews r ON r.id = f.review_id
          WHERE ${sql.join(where, sql` AND `)}
          ORDER BY f.created_at DESC LIMIT 600`,
    ),
  ]);

  // one group per card: flagged cards first (worst first), then cards that only have suggestions (newest first)
  const groups = new Map<string, Group>();
  flagged.forEach((r, i) =>
    groups.set(r.card_id, { card_id: r.card_id, entity_type: r.entity_type, entity_key: r.entity_key, entity_name: r.entity_name, yaml_file: r.yaml_file, field: r.field, text: r.current_text, flagged: r, fb: [], rank: i }),
  );
  fbRows.forEach((f, i) => {
    let g = groups.get(f.card_id);
    if (!g) {
      g = { card_id: f.card_id, entity_type: f.entity_type, entity_key: f.entity_key, entity_name: f.entity_name, yaml_file: f.yaml_file, field: f.field, text: f.reviewed_text, flagged: null, fb: [], rank: 100_000 + i };
      groups.set(f.card_id, g);
    }
    g.fb.push(f);
  });
  // cards flagged by votes alone have no suggestion rows: look up who flagged them
  const flagOnly = [...groups.values()].filter((g) => g.flagged && g.fb.length === 0).map((g) => g.card_id);
  const flaggerRows = await loadFlaggers(db, flagOnly);
  const flaggers = new Map<string, typeof flaggerRows>();
  for (const f of flaggerRows) if (!f.has_feedback) flaggers.set(f.card_id, [...(flaggers.get(f.card_id) ?? []), f]);
  let all = [...groups.values()].filter((g) => !card || g.card_id === card).sort((a, b) => a.rank - b.rank);

  // a card is "open" while it has an open suggestion, or is flagged and nobody wrote a suggestion for it
  const inStatus = (g: Group, s: string) => (s === "all" ? true : s === "open" ? g.fb.some((f) => f.status === "open") || (!!g.flagged && g.fb.length === 0) : g.fb.some((f) => f.status === s));
  const count = Object.fromEntries(FIX_STATUSES.map((s) => [s, all.filter((g) => inStatus(g, s)).length]));
  all = all.filter((g) => inStatus(g, status));
  const shown = (g: Group) => (status === "all" ? g.fb : g.fb.filter((f) => f.status === status));
  const q = status !== "all" ? `&status=${status}` : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented id="fix-status" className="min-w-0 flex-1" active={status} items={FIX_STATUSES.map((s) => ({ key: s, label: s, href: href(s, card), count: count[s] }))} />
        <ExportMenu
          items={[
            { label: "Flagged cards (JSONL)", href: "/api/admin/export/needs-change?format=jsonl" },
            { label: "Flagged cards (report)", href: "/api/admin/export/needs-change?format=md" },
            { label: "Suggestions (CSV)", href: `/api/admin/export/feedback?format=csv${q}` },
            { label: "Suggestions (JSONL)", href: `/api/admin/export/feedback?format=jsonl${q}` },
          ]}
        />
      </div>
      {card && (
        <p className="flex flex-wrap items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          Filtered to card <span className="font-mono text-xs text-foreground">{card}</span> ·
          <Link href={href(status)} className="font-medium text-primary hover:underline">
            clear
          </Link>
        </p>
      )}
      {all.length === 0 ? (
        <Empty title={status === "open" ? "No open suggestions" : `No ${status === "all" ? "" : status} suggestions`} icon={<MessageSquareQuote />}>
          Cards marked “Needs fix” and suggestions from the daily decks and Browse cards show up here, worst first.
        </Empty>
      ) : (
        <Stagger as="ul" className="space-y-3">
          {all.map((g) => {
            const list = shown(g);
            const r = g.flagged;
            return (
              <StaggerItem as="li" key={g.card_id} className={cn(surface, "p-4 sm:p-5")} data-testid="feedback-item">
                <div className="flex flex-wrap items-center gap-2">
                  <TypePill type={g.entity_type} />
                  <Link href={entityHref(g.entity_type, g.entity_key)} className="font-medium hover:text-primary hover:underline">
                    {g.entity_name}
                  </Link>
                  {r && <Votes correct={r.correct_votes} improve={r.improve_votes} unsure={r.unsure_votes} />}
                  {r?.conflicting && <Tag tone="destructive">conflicting</Tag>}
                </div>
                <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
                  {g.yaml_file} → {g.entity_key} → {g.field}
                </p>
                {r && r.linked_forms.length + r.linked_processes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {r.linked_forms.slice(0, 6).map((f) => (
                      <Link key={f} href={entityHref("form", f)} className="hover:opacity-80">
                        <Tag tone="success">{f}</Tag>
                      </Link>
                    ))}
                    {r.linked_processes.slice(0, 4).map((p) => (
                      <Link key={p} href={entityHref("process", p)} className="hover:opacity-80">
                        <Tag tone="warning">{p}</Tag>
                      </Link>
                    ))}
                  </div>
                )}
                <div className="mt-3">
                  <Eyebrow>Current YAML text</Eyebrow>
                  <p className="rounded-lg bg-muted/60 p-3 text-sm whitespace-pre-line">{g.text}</p>
                </div>

                {list.length === 0 ? (
                  <div className="mt-3 rounded-lg border p-3 sm:p-4">
                    <p className="text-sm">
                      <span className="font-medium">Flagged by </span>
                      {(flaggers.get(g.card_id) ?? []).map((f) => `${f.display_name} (${f.username})`).join(", ") || "employees"}
                      <span className="text-muted-foreground"> · marked “Needs fix” without writing a suggestion.</span>
                    </p>
                    {(flaggers.get(g.card_id) ?? []).length > 0 && (
                      <>
                        <Separator className="my-3" />
                        <form action={resolveFlag} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <input type="hidden" name="cardId" value={g.card_id} />
                          <Input name="note" className="sm:flex-1" placeholder="Resolution note (optional)" maxLength={2000} aria-label="Resolution note" />
                          <div className="flex flex-wrap items-center gap-2">
                            <button name="status" value="accepted" className={cn(buttonVariants(), "bg-success/10 text-success hover:bg-success/20")}>
                              <Check /> Accept
                            </button>
                            <button name="status" value="rejected" className={buttonVariants({ variant: "destructive" })}>
                              <X /> Reject
                            </button>
                          </div>
                        </form>
                      </>
                    )}
                  </div>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {list.map((f) => (
                      <li key={f.id} className="rounded-lg border p-3 sm:p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Tag tone="warning" className="capitalize">
                            {f.category}
                          </Tag>
                          {status === "all" && (
                            <Tag tone={STATUS_TONE[f.status] ?? "neutral"} className="capitalize">
                              {f.status}
                            </Tag>
                          )}
                          <span className="ml-auto text-xs text-muted-foreground">
                            {f.display_name} ({f.username}) · {new Date(f.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                          </span>
                        </div>
                        {f.reviewed_version !== f.current_version && (
                          <p className="mt-2 flex items-center gap-2 rounded-lg bg-warning/12 px-3 py-2 text-xs text-warning">
                            <History className="size-3.5 shrink-0" />
                            Reviewed v{f.reviewed_version}; the YAML has since changed (now v{f.current_version}).
                          </p>
                        )}
                        {f.suggested_text ? (
                          <div className="mt-3">
                            <Eyebrow>Suggested</Eyebrow>
                            <p className="rounded-lg border border-success/20 bg-success/[0.06] p-3 text-sm whitespace-pre-line">{f.suggested_text}</p>
                          </div>
                        ) : (
                          <p className="mt-3 text-sm text-muted-foreground">No text change proposed.</p>
                        )}
                        {f.comment && (
                          <p className="mt-3 text-sm">
                            <span className="font-medium">Comment: </span>
                            {f.comment}
                          </p>
                        )}
                        {f.knew_it !== null && <p className="mt-1 text-xs text-muted-foreground">Reviewer {f.knew_it ? "knew" : "did not know"} the card.</p>}
                        {f.resolution_note && <p className="mt-2 text-xs text-muted-foreground">Note: {f.resolution_note}</p>}
                        {f.applied_commit && (
                          <p className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                            <GitCommitHorizontal className="size-3.5" /> Applied in {f.applied_commit}
                          </p>
                        )}

                        <Separator className="my-3" />
                        <form action={resolveFeedback} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <input type="hidden" name="feedbackId" value={f.id} />
                          <Input name="note" className="sm:flex-1" placeholder="Resolution note (optional)" maxLength={2000} aria-label="Resolution note" />
                          <div className="flex flex-wrap items-center gap-2">
                          {f.status !== "accepted" && (
                            <button name="status" value="accepted" className={cn(buttonVariants(), "bg-success/10 text-success hover:bg-success/20")}>
                              <Check /> Accept
                            </button>
                          )}
                          {f.status !== "rejected" && (
                            <button name="status" value="rejected" className={buttonVariants({ variant: "destructive" })}>
                              <X /> Reject
                            </button>
                          )}
                          {f.status !== "open" && (
                            <button name="status" value="open" className={buttonVariants({ variant: "outline" })}>
                              <RotateCcw /> Reopen
                            </button>
                          )}
                          </div>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </div>
  );
}
