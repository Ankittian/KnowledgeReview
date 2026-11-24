"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { KgEdge, KgGraph, KgNode } from "@/lib/kg/types";
import { FALLBACK_COLOR, truncate, useKgGet } from "./api";
import { usePanZoom } from "./usePanZoom";
import { ZoomControls } from "./ZoomControls";

export interface ExploreHandle {
  add: (n: KgNode) => void;
  expand: (id: string, rel?: string, dir?: "in" | "out") => Promise<void>;
}

const W = 1000, H = 640;
interface Pos { x: number; y: number; vx: number; vy: number; fixed?: boolean }

/** Free-form neighbourhood graph: add nodes, double-click (or use the drawer) to expand, drag to arrange. */
export function ExploreView({
  ref,
  colors,
  selectedId,
  onSelectNode,
  onError,
  onBusy,
}: {
  ref: React.Ref<ExploreHandle>;
  colors: Map<string, string>;
  selectedId: string | null;
  onSelectNode: (n: KgNode) => void;
  onError: (msg: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const pz = usePanZoom();
  const [nodes, setNodes] = useState<Map<string, KgNode>>(new Map());
  const [edges, setEdges] = useState<Map<string, KgEdge>>(new Map());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [, frame] = useState(0);
  const pos = useRef(new Map<string, Pos>());
  const edgesRef = useRef(edges);
  const alpha = useRef(0);
  const raf = useRef<number | null>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; moved: boolean } | null>(null);

  // ---- small dependency-free force simulation ----
  const step = useCallback(() => {
    const P = pos.current, ids = [...P.keys()], a = alpha.current;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const p = P.get(ids[i])!, q = P.get(ids[j])!;
      let dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
      if (d2 > 160000) continue;
      const d = Math.sqrt(d2), f = (2600 / d2) * a;
      p.vx += (dx / d) * f; p.vy += (dy / d) * f; q.vx -= (dx / d) * f; q.vy -= (dy / d) * f;
    }
    for (const e of edgesRef.current.values()) {
      const s = P.get(e.source), t = P.get(e.target);
      if (!s || !t) continue;
      const dx = t.x - s.x, dy = t.y - s.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 120) * 0.04 * a;
      s.vx += (dx / d) * f; s.vy += (dy / d) * f; t.vx -= (dx / d) * f; t.vy -= (dy / d) * f;
    }
    for (const p of P.values()) {
      p.vx += (W / 2 - p.x) * 0.003 * a; p.vy += (H / 2 - p.y) * 0.003 * a;
      if (!p.fixed) { p.x += p.vx; p.y += p.vy; }
      p.vx *= 0.6; p.vy *= 0.6;
    }
    alpha.current *= 0.97;
  }, []);
  const kick = useCallback((a = 1) => {
    alpha.current = Math.max(alpha.current, a);
    if (raf.current != null) return;
    const loop = () => {
      step(); frame((n) => n + 1);
      raf.current = alpha.current > 0.02 ? requestAnimationFrame(loop) : null;
    };
    raf.current = requestAnimationFrame(loop);
  }, [step]);
  useEffect(() => () => { if (raf.current != null) cancelAnimationFrame(raf.current); }, []);

  const merge = useCallback((g: Pick<KgGraph, "nodes" | "edges">, near?: string) => {
    const origin = near ? pos.current.get(near) : undefined;
    for (const n of g.nodes) if (!pos.current.has(n.id)) {
      const ang = Math.random() * Math.PI * 2, r = origin ? 70 : pos.current.size ? 220 : 0;
      pos.current.set(n.id, { x: (origin?.x ?? W / 2) + Math.cos(ang) * r, y: (origin?.y ?? H / 2) + Math.sin(ang) * r, vx: 0, vy: 0 });
    }
    setNodes((prev) => { const m = new Map(prev); g.nodes.forEach((n) => m.set(n.id, { ...m.get(n.id), ...n })); return m; });
    setEdges((prev) => { const m = new Map(prev); g.edges.forEach((e) => m.set(e.id, e)); edgesRef.current = m; return m; });
    kick(1);
  }, [kick]);

  const kgGet = useKgGet();
  const expand = useCallback(async (id: string, rel?: string, dir?: "in" | "out") => {
    onBusy(true);
    try {
      const g = await kgGet<KgGraph>("expand", { id, rel, dir, limit: 25 });
      merge(g, id);
      if (g.truncated) onError("Showing the first 25 neighbours. Pick a single relationship in the drawer to narrow it.");
    } catch (e) { onError(e instanceof Error ? e.message : "Request failed"); } finally { onBusy(false); }
  }, [merge, onBusy, onError, kgGet]);

  useImperativeHandle(ref, () => ({ add: (n) => merge({ nodes: [n], edges: [] }), expand }), [merge, expand]);

  const clear = () => { pos.current.clear(); edgesRef.current = new Map(); setNodes(new Map()); setEdges(new Map()); setHidden(new Set()); pz.reset(); };

  // ---- node dragging (pointer capture on the node group) ----
  const nodeDown = (e: React.PointerEvent<SVGGElement>, id: string) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, sx: e.clientX, sy: e.clientY, moved: false };
    pos.current.get(id)!.fixed = true;
  };
  const nodeMove = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
    if (!d.moved) return;
    const g = pz.toGraph(e.clientX, e.clientY), p = pos.current.get(d.id)!;
    p.x = g.x; p.y = g.y;
    kick(0.25);
  };
  const nodeUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const p = pos.current.get(d.id);
    if (p) p.fixed = false;
    if (!d.moved) { const n = nodes.get(d.id); if (n) onSelectNode(n); }
  };

  const legend = useMemo(() => {
    const m = new Map<string, number>();
    nodes.forEach((n) => m.set(n.label, (m.get(n.label) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [nodes]);
  const visible = (id: string) => { const n = nodes.get(id); return !!n && !hidden.has(n.label) && pos.current.has(id); };
  const shownEdges = [...edges.values()].filter((e) => visible(e.source) && visible(e.target));
  const focus = hover ?? selectedId;
  const linked = useMemo(() => {
    if (!focus || !nodes.has(focus)) return null;
    const s = new Set([focus]);
    edges.forEach((e) => { if (e.source === focus) s.add(e.target); if (e.target === focus) s.add(e.source); });
    return s;
  }, [focus, edges, nodes]);
  const edgeLabels = pz.t.k > 0.8 && shownEdges.length <= 150;

  return (
    <div className="relative h-full w-full">
      {legend.length > 0 && (
        <div className="absolute top-3 left-3 z-10 flex max-w-[70%] flex-wrap gap-1">
          {legend.map(([label, n]) => {
            const off = hidden.has(label);
            return (
              <button
                key={label}
                onClick={() => setHidden((h) => { const s = new Set(h); if (off) s.delete(label); else s.add(label); return s; })}
                className={`flex items-center gap-1.5 rounded-full bg-card px-2 py-0.5 text-xs shadow-sm ring-1 ring-border ${off ? "opacity-40 line-through" : ""}`}
                title={off ? "Show this type" : "Hide this type"}
              >
                <span className="size-2 rounded-full" style={{ background: colors.get(label) ?? FALLBACK_COLOR }} />
                {label} <span className="text-muted-foreground tabular-nums">{n}</span>
              </button>
            );
          })}
        </div>
      )}
      {nodes.size > 0 && (
        <Button size="sm" variant="outline" className="absolute top-3 right-3 z-10" onClick={clear}><Trash2 /> Clear</Button>
      )}
      {nodes.size === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
          <div className="max-w-sm text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Nothing here yet</p>
            <p className="mt-1">Search for a node in the toolbar, or open any node and choose <b>Explore from here</b>. Double-click a node to expand its neighbours; drag to arrange.</p>
          </div>
        </div>
      )}
      <svg ref={pz.svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing" {...pz.bind}>
        <defs>
          <marker id="kg-explore-arrow" viewBox="0 0 10 10" refX="19" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10z" className="fill-muted-foreground" />
          </marker>
        </defs>
        <g transform={pz.transform}>
          {shownEdges.map((e) => {
            const s = pos.current.get(e.source)!, t = pos.current.get(e.target)!;
            const on = !!linked && (e.source === focus || e.target === focus);
            return (
              <g key={e.id} opacity={linked && !on ? 0.12 : 1}>
                <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} strokeWidth={on ? 1.8 : 1} strokeDasharray={e.derived ? "4 3" : undefined} markerEnd="url(#kg-explore-arrow)" className={on ? "stroke-primary" : "stroke-muted-foreground/60"} />
                {(edgeLabels || on) && (
                  <text x={(s.x + t.x) / 2} y={(s.y + t.y) / 2} textAnchor="middle" dy="0.35em" paintOrder="stroke" strokeWidth={3} className="fill-muted-foreground stroke-card text-[8px]">{e.type}</text>
                )}
              </g>
            );
          })}
          {[...nodes.values()].filter((n) => visible(n.id)).map((n) => {
            const p = pos.current.get(n.id)!;
            const sel = n.id === selectedId;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x} ${p.y})`}
                className="cursor-pointer"
                opacity={linked && !linked.has(n.id) ? 0.25 : 1}
                onPointerDown={(e) => nodeDown(e, n.id)}
                onPointerMove={nodeMove}
                onPointerUp={nodeUp}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover(null)}
                onDoubleClick={() => void expand(n.id)}
              >
                <title>{`${n.label}: ${n.name}`}</title>
                <circle r={sel ? 11 : 8} fill={colors.get(n.label) ?? FALLBACK_COLOR} strokeWidth={sel ? 3 : 1.5} className={sel ? "stroke-foreground" : "stroke-card"} />
                <text y={21} textAnchor="middle" paintOrder="stroke" strokeWidth={3} className="fill-foreground stroke-card text-[10px]">{truncate(n.name, 26)}</text>
              </g>
            );
          })}
        </g>
      </svg>
      <ZoomControls onIn={() => pz.zoomBy(1.25)} onOut={() => pz.zoomBy(0.8)} onReset={pz.reset} />
    </div>
  );
}
