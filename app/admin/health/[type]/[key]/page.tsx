import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { ArrowLeft, ArrowRight, Gauge, Layers, ShieldAlert, Sparkles, UserCheck } from "lucide-react";
import { getDb, query } from "@/db/client";
import { Empty, ScoreBar, TableCard, Tag, TypePill, Votes, entityHref, pct, surface, tcell, thead } from "@/components/admin/bits";
import { FadeIn, Stagger, StaggerItem } from "@/components/common/motion";
import { SectionTitle } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

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
    sql`SELECT * FROM kb_entities WHERE key = ${key} AND type::text IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)}) LIMIT 1`,
  );
  if (!entity) notFound();

  const cardCols = sql`ch.card_id, ch.kind, ch.source_field, cv.context, cv.front, cv.source_text, cv.version, ch.reviewers, ch.correct_votes,
                       ch.improve_votes, ch.unsure_votes, ch.knew_rate, ch.needs_change_score, ch.open_feedback`;
  const [[roll], own, linked, outgoing, fb] = await Promise.all([
    query<Record<string, string>>(db, sql`SELECT * FROM v_rollup_health WHERE entity_id = ${entity.id}`),
    query<CardRow>(
      db,
      sql`SELECT ${cardCols} FROM v_card_health ch JOIN card_versions cv ON cv.id = ch.current_version_id
          WHERE ch.entity_id = ${entity.id} AND ch.status = 'active'
          ORDER BY ch.needs_change_score DESC, ch.reviewers DESC, ch.kind, ch.card_id LIMIT 200`,
    ),
    query<CardRow>(
      db,
      sql`SELECT ${cardCols}, e.type AS entity_type, e.key AS entity_key, e.name AS entity_name, e.yaml_file,
                 array_agg(DISTINCT l.relation) AS relations
          FROM card_links l JOIN v_card_health ch ON ch.card_id = l.card_id AND ch.status = 'active'
          JOIN card_versions cv ON cv.id = ch.current_version_id JOIN kb_entities e ON e.id = ch.entity_id
          WHERE l.entity_id = ${entity.id} AND ch.reviewers > 0
          GROUP BY ch.card_id, ch.kind, ch.source_field, cv.context, cv.front, cv.source_text, cv.version, ch.reviewers, ch.correct_votes,
                   ch.improve_votes, ch.unsure_votes, ch.knew_rate, ch.needs_change_score, ch.open_feedback, e.type, e.key, e.name, e.yaml_file
          ORDER BY ch.needs_change_score DESC, ch.improve_votes DESC LIMIT 100`,
    ),
    query<{ type: string; key: string; name: string; relation: string }>(
      db,
      sql`SELECT DISTINCT e.type, e.key, e.name, l.relation FROM cards c JOIN card_links l ON l.card_id = c.id
          JOIN kb_entities e ON e.id = l.entity_id WHERE c.entity_id = ${entity.id} ORDER BY l.relation, e.name LIMIT 200`,
    ),
    query<{ id: number; card_id: string; field: string; category: string; suggested_text: string | null; comment: string | null; status: string; username: string; created_at: Date; own: boolean }>(
      db,
      sql`SELECT f.id, f.card_id, f.source_field AS field, f.category, f.suggested_text, f.comment, f.status, u.username, f.created_at,
                 (f.entity_id = ${entity.id}) AS own
          FROM feedback f JOIN users u ON u.id = f.user_id
          WHERE f.status IN ('open','accepted') AND (f.entity_id = ${entity.id}
                OR f.card_id IN (SELECT card_id FROM card_links WHERE entity_id = ${entity.id}))
          ORDER BY f.created_at DESC LIMIT 50`,
    ),
  ]);

  const meta = entity.meta ?? {};
  const score = roll ? Number(roll.needs_change_score) : 0;
  return (
    <div className="space-y-6">
      <Link href="/admin/health" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> Back
      </Link>
      <FadeIn>
        <header className={cn(surface, "p-5")}>
          <div className="flex flex-wrap items-center gap-2">
            <TypePill type={entity.type} />
            {!entity.active && <Tag tone="destructive">removed from YAML</Tag>}
            {entity.module && <Tag tone="outline">{entity.module}</Tag>}
          </div>
          <h2 className="mt-2.5 text-xl font-semibold tracking-tight">{entity.name}</h2>
          <p className="mt-1 font-mono text-xs break-all text-muted-foreground">
            {entity.yaml_file} → {entity.key}
          </p>
          {typeof meta.source_ref === "string" && <p className="mt-1 text-xs text-muted-foreground">Source: {meta.source_ref}</p>}
          {Array.isArray(meta.implemented_by) && meta.implemented_by.length > 0 && (
            <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">Implemented by: {(meta.implemented_by as string[]).join(", ")}</p>
          )}
        </header>
      </FadeIn>

      {roll && (
        <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StaggerItem>
            <StatCard label="Related cards" value={Number(roll.cards)} sub="own + linked" icon={<Layers />} />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Reviewed" value={Number(roll.cards_reviewed)} icon={<UserCheck />} tone="primary" />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Flagged cards" value={Number(roll.cards_flagged)} valueTone="warning" icon={<ShieldAlert />} tone="warning" />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Employees knew it" value={roll.knew_rate == null ? null : Number(roll.knew_rate)} percent icon={<Sparkles />} tone="success" />
          </StaggerItem>
          <StaggerItem className="col-span-2 lg:col-span-1">
            <StatCard label="Needs-change score" value={score} decimals={2} valueTone={score >= 0.25 ? "destructive" : "default"} icon={<Gauge />} tone={score >= 0.25 ? "destructive" : "default"} />
          </StaggerItem>
        </Stagger>
      )}

      {fb.length > 0 && (
        <section>
          <SectionTitle
            title="Open suggestions"
            actions={
              <Link href="/admin/feedback" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Go to triage <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          <Stagger as="ul" className="grid gap-3 lg:grid-cols-2">
            {fb.map((f) => (
              <StaggerItem as="li" key={f.id} className={cn(surface, "p-4")}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Tag tone="warning" className="capitalize">
                    {f.category}
                  </Tag>
                  <span className="text-muted-foreground">{f.username}</span>
                  <span className="font-mono text-muted-foreground">{f.field}</span>
                  {!f.own && <Tag tone="outline">via linked card</Tag>}
                  <span className="ml-auto text-muted-foreground capitalize">{f.status}</span>
                </div>
                {f.comment && <p className="mt-2.5 text-sm">{f.comment}</p>}
                {f.suggested_text && <p className="mt-2.5 rounded-lg border border-success/20 bg-success/[0.06] p-3 text-sm whitespace-pre-line">{f.suggested_text}</p>}
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      )}

      <section>
        <SectionTitle title={`Cards from this item (${own.length})`} />
        {own.length === 0 ? <Empty title="No cards are generated from this item." /> : <CardTable rows={own} />}
      </section>

      <section>
        <SectionTitle
          title={`Reviewed cards linked to this item (${linked.length})`}
          description={`Rules, steps and concepts whose cards reference this ${entity.type}. Flags here may mean this item needs a change too.`}
        />
        {linked.length === 0 ? <Empty title="No reviewed linked cards yet." /> : <CardTable rows={linked} showEntity />}
      </section>

      {outgoing.length > 0 && (
        <section>
          <SectionTitle title="This item’s cards link to" />
          <div className="flex flex-wrap gap-1.5">
            {outgoing.map((o) => (
              <Link
                key={`${o.type}:${o.key}:${o.relation}`}
                href={entityHref(o.type, o.key)}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-2 py-1 text-xs font-medium shadow-card transition-colors hover:border-primary/40 hover:bg-accent"
                title={o.relation}
              >
                <TypePill type={o.type} /> {o.name}
                <span className="text-[10px] font-normal text-muted-foreground">{o.relation.replace(/_/g, " ")}</span>
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
    <TableCard>
      <Table className="min-w-[760px]">
        <TableHeader className={thead}>
          <TableRow className="hover:bg-transparent">
            <TableHead>Card</TableHead>
            <TableHead>Current YAML text</TableHead>
            <TableHead>Verdicts</TableHead>
            <TableHead className="text-right">Knew</TableHead>
            <TableHead>Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.card_id}>
              <TableCell className={cn(tcell, "max-w-[300px]")}>
                {showEntity && r.entity_type && r.entity_key && (
                  <Link href={entityHref(r.entity_type, r.entity_key)} className="mb-1.5 flex items-center gap-1.5 text-xs font-medium hover:text-primary hover:underline">
                    <TypePill type={r.entity_type} /> <span className="truncate">{r.entity_name}</span>
                  </Link>
                )}
                <p className="font-medium whitespace-pre-line">{r.front}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {r.source_field} · v{r.version}
                  {r.relations ? ` · ${r.relations.join(", ")}` : ""}
                </p>
              </TableCell>
              <TableCell className={cn(tcell, "max-w-[360px]")}>
                <p className="line-clamp-4 text-xs whitespace-pre-line text-muted-foreground">{r.source_text}</p>
              </TableCell>
              <TableCell className={tcell}>
                <Votes correct={Number(r.correct_votes)} improve={Number(r.improve_votes)} unsure={Number(r.unsure_votes)} />
                {Number(r.open_feedback) > 0 && <p className="mt-1 text-[11px] font-medium text-warning">{r.open_feedback} open</p>}
              </TableCell>
              <TableCell className={cn(tcell, "text-right tabular-nums")}>{pct(r.knew_rate == null ? null : Number(r.knew_rate))}</TableCell>
              <TableCell className={tcell}>
                <ScoreBar score={Number(r.needs_change_score)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}

