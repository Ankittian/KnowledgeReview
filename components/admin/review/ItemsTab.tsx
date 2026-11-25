import Link from "next/link";
import { sql } from "drizzle-orm";
import { getDb, query } from "@/db/client";
import { Empty, TableCard, Votes, entityHref, pct, tcell, thead } from "@/components/admin/bits";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const ITEM_TYPES = [
  { key: "forms", label: "Forms", one: "Form" },
  { key: "processes", label: "Processes", one: "Process" },
  { key: "rules", label: "Rules", one: "Rule" },
  { key: "concepts", label: "Concepts", one: "Concept" },
] as const;
export type ItemType = (typeof ITEM_TYPES)[number]["key"];

interface RollupRow {
  type: string;
  key: string;
  name: string;
  yaml_file: string;
  cards: number;
  cards_reviewed: number;
  correct_votes: number;
  improve_votes: number;
  unsure_votes: number;
  open_feedback: number;
  knew_rate: string | null;
  needs_change_score: string;
}

/** Review cards > By item: one row per form, process, rule or concept, with the verdicts of all its cards. */
export async function ItemsTab({ type, module }: { type: ItemType; module: string }) {
  const db = await getDb();
  const types = { forms: sql`type IN ('form','usercontrol')`, processes: sql`type = 'process'`, rules: sql`type = 'rule'`, concepts: sql`type = 'concept'` }[type];
  const one = ITEM_TYPES.find((t) => t.key === type)!.one;
  const rows = await query<RollupRow>(
    db,
    sql`SELECT * FROM kb_item_health WHERE ${types} AND verdicts > 0 ${module ? sql`AND module = ${module}` : sql``}
        ORDER BY needs_change_score DESC, improve_votes DESC, verdicts DESC LIMIT 300`,
  );
  if (!rows.length) return <Empty title="No verdicts yet">Rows appear once employees have reviewed related cards.</Empty>;
  return (
    <TableCard>
      <Table className="min-w-[760px]">
        <TableHeader className={thead}>
          <TableRow className="hover:bg-transparent">
            <TableHead>{one}</TableHead>
            <TableHead className="text-right">Cards</TableHead>
            <TableHead className="text-right">Reviewed</TableHead>
            <TableHead>Verdicts</TableHead>
            <TableHead className="text-right">Open fixes</TableHead>
            <TableHead className="text-right">Knew</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.type}:${r.key}`}>
              <TableCell className={cn(tcell, "max-w-[320px]")}>
                <Link href={entityHref(r.type, r.key)} className="font-medium hover:text-primary hover:underline">
                  {r.name}
                </Link>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {r.yaml_file}
                  {type === "rules" ? ` → ${r.key}` : ""}
                </p>
              </TableCell>
              <TableCell className={cn(tcell, "text-right tabular-nums")}>{r.cards}</TableCell>
              <TableCell className={cn(tcell, "text-right tabular-nums")}>{r.cards_reviewed}</TableCell>
              <TableCell className={tcell}>
                <Votes correct={Number(r.correct_votes)} improve={Number(r.improve_votes)} unsure={Number(r.unsure_votes)} />
              </TableCell>
              <TableCell className={cn(tcell, "text-right tabular-nums", Number(r.open_feedback) > 0 && "font-medium text-warning")}>{Number(r.open_feedback)}</TableCell>
              <TableCell className={cn(tcell, "text-right tabular-nums")}>{pct(r.knew_rate == null ? null : Number(r.knew_rate))}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  );
}
