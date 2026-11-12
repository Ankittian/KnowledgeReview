import { sql } from "drizzle-orm";
import { query, type DB } from "@/db/client";

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : typeof v === "string" ? v.replace(/^\{|\}$/g, "").split(",").filter(Boolean) : []);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

export interface Suggestion {
  feedback_id: number;
  category: string;
  suggested_text: string | null;
  comment: string | null;
  status: string;
  username: string;
  card_version_id: number;
  created_at: string;
}

export interface NeedsChangeRow {
  entity_type: string;
  entity_key: string;
  entity_name: string;
  module: string | null;
  yaml_file: string;
  field: string;
  card_id: string;
  kind: string;
  card_version: number;
  current_text: string;
  reviewers: number;
  correct_votes: number;
  improve_votes: number;
  unsure_votes: number;
  knew_rate: number | null;
  needs_change_score: number;
  open_feedback: number;
  conflicting: boolean;
  linked_forms: string[];
  linked_processes: string[];
  linked_rules: string[];
  linked_concepts: string[];
  suggestions: Suggestion[];
}

/** The actionable "what to change in which YAML file / key / field" list, worst first. */
export async function loadNeedsChange(db: DB, filters: { module?: string; type?: string; limit?: number } = {}): Promise<NeedsChangeRow[]> {
  const where = [sql`true`];
  if (filters.module) where.push(sql`module = ${filters.module}`);
  if (filters.type) where.push(sql`entity_type = ${filters.type}`);
  const rows = await query<Record<string, unknown>>(
    db,
    sql`SELECT * FROM v_needs_change WHERE ${sql.join(where, sql` AND `)}
        ORDER BY needs_change_score DESC, improve_votes DESC, open_feedback DESC, card_id
        ${filters.limit ? sql`LIMIT ${filters.limit}` : sql``}`,
  );
  return rows.map((r) => ({
    entity_type: String(r.entity_type),
    entity_key: String(r.entity_key),
    entity_name: String(r.entity_name),
    module: (r.module as string) ?? null,
    yaml_file: String(r.yaml_file),
    field: String(r.field),
    card_id: String(r.card_id),
    kind: String(r.kind),
    card_version: Number(r.card_version),
    current_text: String(r.current_text ?? ""),
    reviewers: Number(r.reviewers),
    correct_votes: Number(r.correct_votes),
    improve_votes: Number(r.improve_votes),
    unsure_votes: Number(r.unsure_votes),
    knew_rate: num(r.knew_rate),
    needs_change_score: Number(r.needs_change_score),
    open_feedback: Number(r.open_feedback),
    conflicting: Boolean(r.conflicting),
    linked_forms: arr(r.linked_forms),
    linked_processes: arr(r.linked_processes),
    linked_rules: arr(r.linked_rules),
    linked_concepts: arr(r.linked_concepts),
    suggestions: ((typeof r.suggestions === "string" ? JSON.parse(r.suggestions) : r.suggestions) ?? []) as Suggestion[],
  }));
}

export function needsChangeMarkdown(rows: NeedsChangeRow[]): string {
  const out = [
    `# Knowledge base: items that need change`,
    ``,
    `Generated ${new Date().toISOString()} · ${rows.length} flagged item(s). Score = weighted share of "needs improvement" verdicts.`,
    ``,
  ];
  for (const r of rows) {
    out.push(`## ${r.yaml_file} → \`${r.entity_key}\` → \`${r.field}\``);
    out.push(``);
    out.push(`- **${r.entity_type}** ${r.entity_name}${r.module ? ` (${r.module})` : ""} · card \`${r.card_id}\` v${r.card_version}`);
    out.push(`- Score ${r.needs_change_score.toFixed(2)} · ✔ ${r.correct_votes} · ✎ ${r.improve_votes} · ? ${r.unsure_votes} · open feedback ${r.open_feedback}${r.conflicting ? " · **conflicting**" : ""}`);
    if (r.linked_forms.length) out.push(`- Forms: ${r.linked_forms.join(", ")}`);
    if (r.linked_processes.length) out.push(`- Processes: ${r.linked_processes.join(", ")}`);
    if (r.linked_rules.length) out.push(`- Rules: ${r.linked_rules.join(", ")}`);
    out.push(``, `Current text:`, ``, "```", r.current_text, "```");
    for (const s of r.suggestions) {
      out.push(``, `- _${s.category}_ by ${s.username} (${s.status})${s.comment ? `: ${s.comment}` : ""}`);
      if (s.suggested_text) out.push(``, "  ```", ...s.suggested_text.split("\n").map((l) => `  ${l}`), "  ```");
    }
    out.push(``);
  }
  return out.join("\n");
}

export async function loadFeedbackExport(db: DB, status?: string) {
  const rows = await query<Record<string, unknown>>(
    db,
    sql`SELECT f.id AS feedback_id, f.status, f.category,
               e.type AS entity_type, e.key AS entity_key, e.name AS entity_name, e.module, e.yaml_file, f.source_field AS field,
               f.card_id, cv.version AS card_version, cur.version AS current_version,
               cv.source_text AS text_reviewed, cur.source_text AS text_now, f.suggested_text, f.comment,
               u.username, u.department, f.created_at, f.resolution_note, f.applied_commit, f.resolved_at,
               coalesce((SELECT array_agg(DISTINCT le.key ORDER BY le.key) FROM card_links l JOIN kb_entities le ON le.id = l.entity_id
                         WHERE l.card_id = f.card_id AND le.type IN ('form','usercontrol')), '{}') AS linked_forms,
               coalesce((SELECT array_agg(DISTINCT le.key ORDER BY le.key) FROM card_links l JOIN kb_entities le ON le.id = l.entity_id
                         WHERE l.card_id = f.card_id AND le.type = 'process'), '{}') AS linked_processes,
               coalesce((SELECT array_agg(DISTINCT le.key ORDER BY le.key) FROM card_links l JOIN kb_entities le ON le.id = l.entity_id
                         WHERE l.card_id = f.card_id AND le.type = 'rule'), '{}') AS linked_rules
        FROM feedback f
        JOIN kb_entities e ON e.id = f.entity_id
        JOIN card_versions cv ON cv.id = f.card_version_id
        JOIN cards c ON c.id = f.card_id
        JOIN card_versions cur ON cur.id = c.current_version_id
        JOIN users u ON u.id = f.user_id
        ${status ? sql`WHERE f.status = ${status}` : sql``}
        ORDER BY f.created_at DESC`,
  );
  return rows.map((r) => ({
    ...r,
    card_version: Number(r.card_version),
    current_version: Number(r.current_version),
    linked_forms: arr(r.linked_forms),
    linked_processes: arr(r.linked_processes),
    linked_rules: arr(r.linked_rules),
    created_at: iso(r.created_at),
    resolved_at: iso(r.resolved_at),
  }));
}

export async function loadReviewsExport(db: DB) {
  const rows = await query<Record<string, unknown>>(
    db,
    sql`SELECT r.id AS review_id, u.username, u.department, r.deck_date, r.card_id, cv.version AS card_version,
               e.type AS entity_type, e.key AS entity_key, e.yaml_file, r.source_field AS field, c.module,
               r.knew_it, r.verdict, r.time_to_flip_ms, r.time_to_answer_ms, r.device, r.created_at
        FROM reviews r JOIN users u ON u.id = r.user_id JOIN kb_entities e ON e.id = r.entity_id
        JOIN card_versions cv ON cv.id = r.card_version_id JOIN cards c ON c.id = r.card_id
        ORDER BY r.created_at DESC`,
  );
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at), deck_date: iso(r.deck_date)?.slice(0, 10) ?? null }));
}

export async function loadKnowledgeExport(db: DB) {
  const rows = await query<Record<string, unknown>>(
    db,
    sql`SELECT username, display_name, department, primary_module, module, reviews, cards_seen, total_cards, coverage, knowledge,
               knew_rate_all_time, last_review_at
        FROM v_user_knowledge_module ORDER BY username, module`,
  );
  return rows.map((r) => ({
    ...r,
    reviews: Number(r.reviews),
    cards_seen: Number(r.cards_seen),
    total_cards: num(r.total_cards),
    coverage: num(r.coverage),
    knowledge: num(r.knowledge),
    knew_rate_all_time: num(r.knew_rate_all_time),
    last_review_at: iso(r.last_review_at),
  }));
}

/** Raw interaction log (newest first). */
export async function loadEventsExport(db: DB, opts: { days?: number; limit?: number } = {}) {
  const days = Math.min(Math.max(opts.days ?? 30, 1), 3650);
  const limit = Math.min(Math.max(opts.limit ?? 100_000, 1), 500_000);
  const rows = await query<Record<string, unknown>>(
    db,
    sql`SELECT ev.id, ev.created_at, ev.occurred_at, ev.event_type, u.username, ev.card_id, ev.payload, ev.session_id, ev.ip, ev.user_agent
        FROM interaction_events ev LEFT JOIN users u ON u.id = ev.user_id
        WHERE ev.created_at > now() - make_interval(days => ${days})
        ORDER BY ev.id DESC LIMIT ${limit}`,
  );
  return rows.map((r) => ({ ...r, id: Number(r.id), created_at: iso(r.created_at), occurred_at: iso(r.occurred_at) }));
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    const s = v == null ? "" : Array.isArray(v) ? v.join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

export const toJsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
