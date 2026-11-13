import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { getDb, query } from "@/db/client";
import { Empty, Kpi, ScoreBar, TypePill, Votes, entityHref, pct } from "@/components/admin/bits";

export const metadata: Metadata = { title: "Knowledge item" };

interface CardRow {
  card_id: string;
  kind: string;
  source_field: string;
  context: string;
  front: string;
  source_text: string;
  version: number;
  reviewers: number;
  correct_votes: number;
  improve_votes: number;
  unsure_votes: number;
  knew_rate: string | null;
  needs_change_score: string;
  open_feedback: number;
  entity_type?: string;
  entity_key?: string;
  entity_name?: string;
  yaml_file?: string;
  relations?: string[];
}

export default async function EntityPage({ params }: { params: Promise<{ type: string; key: string }> }) {
  const { type, key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);
  const types = type === "form" ? ["form", "usercontrol"] : [type];
  const db = await getDb();
  const [entity] = await query<{ id: number; type: string; key: string; name: string; module: string | null; yaml_file: string; active: boolean; meta: Record<string, unknown> }>(
    db,
    sql`SELECT * FROM kb_items WHERE key = ${key} AND type::text IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)}) LIMIT 1`,
  );
  if (!entity) notFound();

  const cardCols = sql`ch.card_id, ch.kind, ch.source_field, cv.context, cv.front, cv.source_text, cv.version, ch.reviewers, ch.correct_votes,
                       ch.improve_votes, ch.unsure_votes, ch.knew_rate, ch.needs_change_score, ch.open_feedback`;
  const [[roll], own, linked, outgoing, fb] = await Promise.all([
    query<Record<string, string>>(db, sql`SELECT * FROM kb_item_health WHERE kb_item_id = ${entity.id}`),
    query<CardRow>(
      db,
      sql`SELECT ${cardCols} FROM card_health ch JOIN card_versions cv ON cv.id = ch.current_version_id
          WHERE ch.kb_item_id = ${entity.id} AND ch.status = 'active'
          ORDER BY ch.needs_change_score DESC, ch.reviewers DESC, ch.kind, ch.card_id LIMIT 200`,
    ),
    query<CardRow>(
      db,
      sql`SELECT ${cardCols}, e.type AS entity_type, e.key AS entity_key, e.name AS entity_name, e.yaml_file,
                 array_agg(DISTINCT l.relation) AS relations
          FROM card_related_items l JOIN card_health ch ON ch.card_id = l.card_id AND ch.status = 'active'
          JOIN card_versions cv ON cv.id = ch.current_version_id JOIN kb_items e ON e.id = ch.kb_item_id
          WHERE l.kb_item_id = ${entity.id} AND ch.reviewers > 0
          GROUP BY ch.card_id, ch.kind, ch.source_field, cv.context, cv.front, cv.source_text, cv.version, ch.reviewers, ch.correct_votes,
                   ch.improve_votes, ch.unsure_votes, ch.knew_rate, ch.needs_change_score, ch.open_feedback, e.type, e.key, e.name, e.yaml_file
          ORDER BY ch.needs_change_score DESC, ch.improve_votes DESC LIMIT 100`,
    ),
    query<{ type: string; key: string; name: string; relation: string }>(
      db,
      sql`SELECT DISTINCT e.type, e.key, e.name, l.relation FROM cards c JOIN card_related_items l ON l.card_id = c.id
          JOIN kb_items e ON e.id = l.kb_item_id WHERE c.kb_item_id = ${entity.id} ORDER BY l.relation, e.name LIMIT 200`,
    ),
    query<{ id: number; card_id: string; field: string; category: string; suggested_text: string | null; comment: string | null; status: string; username: string; created_at: Date; own: boolean }>(
      db,
      sql`SELECT f.id, fc.id AS card_id, fc.source_field AS field, f.category, f.suggested_text, f.comment, f.status, u.username, f.created_at,
                 (fc.kb_item_id = ${entity.id}) AS own
          FROM card_feedback f JOIN card_versions fv ON fv.id = f.card_version_id JOIN cards fc ON fc.id = fv.card_id
          JOIN users u ON u.id = f.user_id
          WHERE f.status IN ('open','accepted') AND (fc.kb_item_id = ${entity.id}
                OR fc.id IN (SELECT card_id FROM card_related_items WHERE kb_item_id = ${entity.id}))
          ORDER BY f.created_at DESC LIMIT 50`,
    ),
  ]);

  const meta = entity.meta ?? {};
  return (
    <div className="space-y-6">
      <Link href="/admin/health" className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <header className="panel p-5">
        <div className="flex flex-wrap items-center gap-2">
          <TypePill type={entity.type} />
          {!entity.active && <span className="chip bg-danger-soft text-danger">removed from YAML</span>}
          {entity.module && <span className="chip">{entity.module}</span>}
        </div>
        <h2 className="mt-2 text-xl font-bold">{entity.name}</h2>
        <p className="mt-1 font-mono text-xs break-all text-muted">
          {entity.yaml_file} → {entity.key}
        </p>
        {typeof meta.source_ref === "string" && <p className="mt-1 text-xs text-muted">Source: {meta.source_ref}</p>}
        {Array.isArray(meta.implemented_by) && meta.implemented_by.length > 0 && (
          <p className="mt-1 font-mono text-[11px] break-all text-muted">Implemented by: {(meta.implemented_by as string[]).join(", ")}</p>
        )}
      </header>

      {roll && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Related cards" value={roll.cards} sub="own + linked" />
          <Kpi label="Reviewed" value={roll.cards_reviewed} />
          <Kpi label="Flagged cards" value={roll.cards_flagged} tone="text-warning" />
          <Kpi label="Employees knew it" value={pct(roll.knew_rate == null ? null : Number(roll.knew_rate))} />
          <Kpi label="Needs-change score" value={Number(roll.needs_change_score).toFixed(2)} tone={Number(roll.needs_change_score) >= 0.25 ? "text-danger" : ""} />
        </div>
      )}

      {fb.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Open suggestions</h3>
          <ul className="grid gap-3 lg:grid-cols-2">
            {fb.map((f) => (
              <li key={f.id} className="panel p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="chip bg-warning-soft font-semibold text-warning capitalize">{f.category}</span>
                  <span className="text-muted">{f.username}</span>
                  <span className="font-mono text-muted">{f.field}</span>
                  {!f.own && <span className="chip">via linked card</span>}
                  <span className="ml-auto text-muted capitalize">{f.status}</span>
                </div>
                {f.comment && <p className="mt-2 text-sm">{f.comment}</p>}
                {f.suggested_text && <p className="mt-2 rounded-xl bg-success-soft p-3 text-sm whitespace-pre-line">{f.suggested_text}</p>}
              </li>
            ))}
          </ul>
          <Link href="/admin/feedback" className="mt-2 inline-block text-sm font-semibold text-primary hover:underline">
            Go to triage →
          </Link>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">Cards from this item ({own.length})</h3>
        {own.length === 0 ? <Empty title="No cards are generated from this item." /> : <CardTable rows={own} />}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Reviewed cards linked to this item ({linked.length})</h3>
        <p className="mb-2 text-xs text-muted">Rules, steps and concepts whose cards reference this {entity.type}. Flags here may mean this item needs a change too.</p>
        {linked.length === 0 ? <Empty title="No reviewed linked cards yet." /> : <CardTable rows={linked} showEntity />}
      </section>

      {outgoing.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">This item’s cards link to</h3>
          <div className="flex flex-wrap gap-1.5">
            {outgoing.map((o) => (
              <Link key={`${o.type}:${o.key}:${o.relation}`} href={entityHref(o.type, o.key)} className="chip hover:bg-border" title={o.relation}>
                <TypePill type={o.type} /> {o.name}
                <span className="text-[10px] text-muted">{o.relation.replace(/_/g, " ")}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CardTable({ rows, showEntity = false }: { rows: CardRow[]; showEntity?: boolean }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="tbl min-w-[760px]">
        <thead>
          <tr>
            <th>Card</th>
            <th>Current YAML text</th>
            <th>Verdicts</th>
            <th className="text-right">Knew</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.card_id}>
              <td className="max-w-[300px]">
                {showEntity && r.entity_type && r.entity_key && (
                  <Link href={entityHref(r.entity_type, r.entity_key)} className="mb-1 flex items-center gap-1.5 text-xs font-semibold hover:underline">
                    <TypePill type={r.entity_type} /> <span className="truncate">{r.entity_name}</span>
                  </Link>
                )}
                <p className="font-medium whitespace-pre-line">{r.front}</p>
                <p className="mt-1 font-mono text-[11px] text-muted">
                  {r.source_field} · v{r.version}
                  {r.relations ? ` · ${r.relations.join(", ")}` : ""}
                </p>
              </td>
              <td className="max-w-[360px]">
                <p className="line-clamp-4 text-xs whitespace-pre-line text-muted">{r.source_text}</p>
              </td>
              <td>
                <Votes correct={Number(r.correct_votes)} improve={Number(r.improve_votes)} unsure={Number(r.unsure_votes)} />
                {Number(r.open_feedback) > 0 && <p className="mt-1 text-[11px] font-semibold text-warning">{r.open_feedback} open</p>}
              </td>
              <td className="text-right tabular-nums">{pct(r.knew_rate == null ? null : Number(r.knew_rate))}</td>
              <td>
                <ScoreBar score={Number(r.needs_change_score)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
