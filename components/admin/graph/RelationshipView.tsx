"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import type { KgEdge, KgGraph, KgNode, KgOverview, KgRelInfo } from "@/lib/kg/types";
import { FALLBACK_COLOR, truncate, useKgGet } from "./api";
import { useWidth } from "./usePanZoom";

export interface RelSelection {
  a?: string;
  b?: string;
  type?: string;
}

const PAGE = 100, ROW = 30, BOX_H = 24, PAD = 12;

const touches = (r: KgRelInfo, l: string) => r.from.includes(l) || r.to.includes(l);
const connects = (r: KgRelInfo, a: string, b: string) => (r.from.includes(a) && r.to.includes(b)) || (r.from.includes(b) && r.to.includes(a));

/** Options for the relationship dropdown, given the chosen node types. */
export function relOptions(overview: KgOverview, sel: RelSelection): KgRelInfo[] {
  const { a, b } = sel;
  // A graph may list one entry per (type, from, to) pattern; the dropdown offers each type once.
  const merged = new Map<string, KgRelInfo>();
  for (const r of overview.relationships.filter((r) => (a && b ? connects(r, a, b) : a ? touches(r, a) : b ? touches(r, b) : true))) {
    const m = merged.get(r.type);
    merged.set(r.type, m ? { ...m, from: [...new Set([...m.from, ...r.from])], to: [...new Set([...m.to, ...r.to])], count: (m.count ?? 0) + (r.count ?? 0), derived: Boolean(m.derived && r.derived) } : r);
  }
  return [...merged.values()]
    .sort((x, y) => Number(Boolean(x.derived)) - Number(Boolean(y.derived)) || (y.count ?? 0) - (x.count ?? 0));
}

/** Two columns: source nodes on the left, target nodes on the right, one line per relationship instance. */
export function RelationshipView({
  overview,
  colors,
  value,
  onChange,
  selectedId,
  onSelectNode,
  onError,
}: {
  overview: KgOverview;
  colors: Map<string, string>;
  value: RelSelection;
  onChange: (v: RelSelection) => void;
  selectedId: string | null;
  onSelectNode: (n: KgNode) => void;
  onError: (msg: string) => void;
}) {
  const [data, setData] = useState<{ nodes: Map<string, KgNode>; edges: KgEdge[]; rows: number; more: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; edge: KgEdge } | null>(null);
  const [boxRef, width] = useWidth<HTMLDivElement>();
  const kgGet = useKgGet();

  const labels = useMemo(() => [...overview.labels].sort((x, y) => x.label.localeCompare(y.label)), [overview]);
  const options = useMemo(() => relOptions(overview, value), [overview, value]);
  const rel = overview.relationships.find((r) => r.type === value.type);

  const pick = (next: RelSelection) => {
    const opts = relOptions(overview, next);
    if (!next.type || !opts.some((r) => r.type === next.type)) next = { ...next, type: next.a && next.b ? opts[0]?.type : undefined };
    onChange(next);
  };

  // Load the first page whenever the relationship type changes.
  useEffect(() => {
    setData(null); setFilter(""); setHover(null); setTip(null);
    if (!value.type) return;
    const ctrl = new AbortController();
    setLoading(true);
    kgGet<KgGraph>("edges", { type: value.type, limit: PAGE, skip: 0 }, ctrl.signal)
      .then((g) => setData({ nodes: new Map(g.nodes.map((n) => [n.id, n])), edges: g.edges, rows: g.edges.length, more: g.truncated }))
      .catch((e) => { if (!ctrl.signal.aborted) onError(e.message); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [value.type, onError, kgGet]);

  const loadMore = async () => {
    if (!data || !value.type) return;
    setLoading(true);
    try {
      const g = await kgGet<KgGraph>("edges", { type: value.type, limit: PAGE, skip: data.rows });
      const nodes = new Map(data.nodes); g.nodes.forEach((n) => nodes.set(n.id, n));
      setData({ nodes, edges: [...data.edges, ...g.edges], rows: data.rows + g.edges.length, more: g.truncated });
    } catch (e) { onError(e instanceof Error ? e.message : "Request failed"); } finally { setLoading(false); }
  };

  // Keep only edges between the two chosen types (a relationship may allow several), then apply the name filter.
  const view = useMemo(() => {
    if (!data) return null;
    const lab = (id: string) => data.nodes.get(id)?.label ?? "";
    const f = filter.trim().toLowerCase();
    const name = (id: string) => (data.nodes.get(id)?.name ?? id).toLowerCase();
    const edges = data.edges.filter((e) => {
      if (value.a && value.b) {
        const s = lab(e.source), t = lab(e.target);
        if (!((s === value.a && t === value.b) || (s === value.b && t === value.a))) return false;
      }
      return !f || name(e.source).includes(f) || name(e.target).includes(f);
    });
    const left = [...new Set(edges.map((e) => e.source))].sort((x, y) => name(x).localeCompare(name(y)));
    const li = new Map(left.map((id, i) => [id, i]));
    const bary = new Map<string, number[]>();
    edges.forEach((e) => bary.set(e.target, [...(bary.get(e.target) ?? []), li.get(e.source)!]));
    const avg = (id: string) => { const v = bary.get(id)!; return v.reduce((s, x) => s + x, 0) / v.length; };
    const right = [...bary.keys()].sort((x, y) => avg(x) - avg(y) || name(x).localeCompare(name(y)));
    const ri = new Map(right.map((id, i) => [id, i]));
    return { edges, left, right, li, ri };
  }, [data, filter, value.a, value.b]);

  const srcLabels = view ? [...new Set(view.left.map((id) => data!.nodes.get(id)?.label))].filter(Boolean).join(" / ") : "";
  const tgtLabels = view ? [...new Set(view.right.map((id) => data!.nodes.get(id)?.label))].filter(Boolean).join(" / ") : "";

  // Geometry: 1 SVG unit = 1 CSS pixel.
  const w = Math.max(width, 320);
  const colW = Math.round(Math.min(300, Math.max(130, w * 0.34)));
  const rx = w - PAD - colW;
  const rows = view ? Math.max(view.left.length, view.right.length, 1) : 1;
  const h = PAD * 2 + rows * ROW;
  const chars = Math.floor((colW - 28) / 6.6);
  const yL = (id: string) => PAD + view!.li.get(id)! * ROW;
  const yR = (id: string) => PAD + view!.ri.get(id)! * ROW;

  const focus = hover ?? (selectedId && view && (view.li.has(selectedId) || view.ri.has(selectedId)) ? selectedId : null);
  const linked = useMemo(() => {
    if (!focus || !view) return null;
    const s = new Set([focus]);
    view.edges.forEach((e) => { if (e.source === focus) s.add(e.target); if (e.target === focus) s.add(e.source); });
    return s;
  }, [focus, view]);

  const box = (id: string, x: number, y: number) => {
    const n = data!.nodes.get(id);
    const on = id === selectedId;
    const dim = linked && !linked.has(id);
    return (
      <g
        key={`${x}:${id}`}
        transform={`translate(${x} ${y})`}
        className="cursor-pointer"
        opacity={dim ? 0.3 : 1}
        onPointerEnter={() => setHover(id)}
        onPointerLeave={() => setHover(null)}
        onClick={() => n && onSelectNode(n)}
      >
        <title>{n?.name ?? id}</title>
        <rect width={colW} height={BOX_H} rx={6} className={on ? "fill-primary/10 stroke-primary" : "fill-card stroke-border"} strokeWidth={on ? 1.5 : 1} />
        <circle cx={12} cy={BOX_H / 2} r={4} fill={colors.get(n?.label ?? "") ?? FALLBACK_COLOR} />
        <text x={22} y={BOX_H / 2} dy="0.35em" className="fill-foreground text-[12px]">{truncate(n?.name ?? id, chars)}</text>
      </g>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Pick the two types and the relationship */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <NativeSelect size="sm" value={value.a ?? ""} onChange={(e) => pick({ ...value, a: e.target.value || undefined })} aria-label="First node type">
          <NativeSelectOption value="">Any type</NativeSelectOption>
          {labels.map((l) => <NativeSelectOption key={l.label} value={l.label}>{l.label}</NativeSelectOption>)}
        </NativeSelect>
        <Button size="icon-sm" variant="ghost" aria-label="Swap types" onClick={() => pick({ ...value, a: value.b, b: value.a })}><ArrowLeftRight /></Button>
        <NativeSelect size="sm" value={value.b ?? ""} onChange={(e) => pick({ ...value, b: e.target.value || undefined })} aria-label="Second node type">
          <NativeSelectOption value="">Any type</NativeSelectOption>
          {labels.map((l) => <NativeSelectOption key={l.label} value={l.label}>{l.label}</NativeSelectOption>)}
        </NativeSelect>
        <NativeSelect size="sm" className="min-w-48" value={value.type ?? ""} onChange={(e) => onChange({ ...value, type: e.target.value || undefined })} aria-label="Relationship">
          <NativeSelectOption value="">{options.length ? `Relationship (${options.length})` : "No relationship between these types"}</NativeSelectOption>
          {options.map((r) => (
            <NativeSelectOption key={r.type} value={r.type}>
              {r.from.join("|")} → {r.type} → {r.to.join("|")}{r.count != null ? ` (${r.count.toLocaleString()})` : ""}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {data && <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter names…" className="h-7 w-40" aria-label="Filter names" />}
        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      {rel && view && (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs">
          <span className="truncate font-medium">{srcLabels || rel.from.join(" / ")} <span className="text-muted-foreground">({view.left.length})</span></span>
          <span className="flex items-center gap-1 font-semibold text-primary" title={rel.means}>{rel.type}<ArrowRight className="size-3.5" /></span>
          <span className="truncate text-right font-medium">{tgtLabels || rel.to.join(" / ")} <span className="text-muted-foreground">({view.right.length})</span></span>
          {rel.means && <span className="col-span-3 truncate text-center text-muted-foreground">{rel.means}</span>}
        </div>
      )}

      <div ref={boxRef} className="relative min-h-0 flex-1 overflow-y-auto" onPointerLeave={() => setTip(null)}>
        {!value.type ? (
          <Suggestions overview={overview} onPick={(r) => onChange({ type: r.type, a: r.from[0], b: r.to[0] })} />
        ) : !view ? null : view.edges.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{loading ? "Loading…" : "No links found for this pair in the loaded rows."}</p>
        ) : (
          <svg width={w} height={h} className="block select-none">
            {view.edges.map((e) => {
              const y1 = yL(e.source) + BOX_H / 2, y2 = yR(e.target) + BOX_H / 2, x1 = PAD + colW, x2 = rx, mx = (x1 + x2) / 2;
              const on = linked ? linked.has(e.source) && linked.has(e.target) && (e.source === focus || e.target === focus) : false;
              return (
                <path
                  key={e.id}
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  strokeWidth={on ? 2 : 1.2}
                  strokeDasharray={e.derived ? "4 3" : undefined}
                  className={cn("cursor-help", on ? "stroke-primary" : "stroke-muted-foreground")}
                  opacity={linked && !on ? 0.08 : on ? 1 : 0.4}
                  onPointerMove={(ev) => { const r = ev.currentTarget.ownerSVGElement!.getBoundingClientRect(); setTip({ x: ev.clientX - r.left, y: ev.clientY - r.top, edge: e }); }}
                  onPointerLeave={() => setTip(null)}
                />
              );
            })}
            {view.left.map((id) => box(id, PAD, yL(id)))}
            {view.right.map((id) => box(id, rx, yR(id)))}
          </svg>
        )}
        {tip && data && (
          <div className="pointer-events-none absolute z-10 max-w-72 rounded-md bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md ring-1 ring-border" style={{ left: Math.min(tip.x + 12, w - 290), top: tip.y + 12 }}>
            <div className="font-medium">{data.nodes.get(tip.edge.source)?.name} → {data.nodes.get(tip.edge.target)?.name}</div>
            <div className="text-muted-foreground">{tip.edge.type}{tip.edge.derived ? " (derived)" : ""}</div>
            {tip.edge.props && Object.entries(tip.edge.props).map(([k, v]) => (
              <div key={k} className="truncate"><span className="text-muted-foreground">{k}:</span> {typeof v === "string" ? v : JSON.stringify(v)}</div>
            ))}
          </div>
        )}
        {data?.more && (
          <div className="sticky bottom-0 flex justify-center bg-gradient-to-t from-card via-card/90 to-transparent pt-6 pb-3">
            <Button size="sm" variant="secondary" onClick={loadMore} disabled={loading}>Load {PAGE} more links</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Suggestions({ overview, onPick }: { overview: KgOverview; onPick: (r: KgRelInfo) => void }) {
  const top = relOptions(overview, {}).slice(0, 10);
  return (
    <div className="mx-auto max-w-xl p-6 text-center">
      <p className="text-sm font-medium">Pick two node types above to see how they connect.</p>
      <p className="mt-1 text-xs text-muted-foreground">Or start from one of the largest relationships:</p>
      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {top.map((r) => (
          <Button key={r.type} size="xs" variant="outline" onClick={() => onPick(r)}>
            {r.from[0]} → <span className="font-semibold">{r.type}</span> → {r.to[0]}
          </Button>
        ))}
      </div>
    </div>
  );
}
