"use client";

import { useMemo, useState } from "react";
import type { KgOverview, KgRelInfo } from "@/lib/kg/types";
import { FALLBACK_COLOR, layerName, truncate } from "./api";
import { usePanZoom } from "./usePanZoom";
import { ZoomControls } from "./ZoomControls";

const COL_W = 320, NODE_W = 190, NODE_H = 36, ROW = 58, PAD = 60, HEAD = 40;

interface Box { label: string; count: number; x: number; y: number; col: number }
interface Link { key: string; rel: KgRelInfo; from: string; to: string; d: string; lx: number; ly: number; width: number }

/** Map of node types (boxes, in layer columns) and the relationship types between them (curves). */
export function SchemaView({
  overview,
  colors,
  activeLabel,
  onSelectType,
  onSelectRel,
}: {
  overview: KgOverview;
  colors: Map<string, string>;
  activeLabel: string | null;
  onSelectType: (label: string) => void;
  onSelectRel: (sel: { type: string; a: string; b: string }) => void;
}) {
  const pz = usePanZoom();
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const [hoverLink, setHoverLink] = useState<string | null>(null);

  const { boxes, links, cols, width, height } = useMemo(() => {
    const cols = overview.layers.map((l) => l.id).filter((id) => overview.labels.some((x) => x.layer === id));
    const perCol = cols.map((layer) => overview.labels.filter((l) => l.layer === layer).sort((a, b) => b.count - a.count));
    const maxRows = Math.max(1, ...perCol.map((c) => c.length));
    const boxes = new Map<string, Box>();
    perCol.forEach((list, col) => {
      const top = PAD + HEAD + ((maxRows - list.length) * ROW) / 2;
      list.forEach((l, i) => boxes.set(l.label, { label: l.label, count: l.count, col, x: PAD + col * COL_W, y: top + i * ROW }));
    });

    // Parallel links between the same pair of boxes fan out.
    const pairIndex = new Map<string, number>();
    const links: Link[] = [];
    for (const rel of overview.relationships) {
      for (const from of rel.from) for (const to of rel.to) {
        const a = boxes.get(from), b = boxes.get(to);
        if (!a || !b) continue;
        const pair = [from, to].sort().join("|");
        const idx = pairIndex.get(pair) ?? 0;
        pairIndex.set(pair, idx + 1);
        const off = (idx % 2 ? -1 : 1) * Math.ceil(idx / 2) * 12;
        const width = 1 + Math.log10((rel.count ?? 1) + 1) * 0.6;
        let d: string, lx: number, ly: number;
        const ay = a.y + NODE_H / 2, by = b.y + NODE_H / 2;
        if (from === to) {
          const x = a.x + NODE_W, r = 22 + idx * 8;
          d = `M ${x} ${ay - 8} C ${x + r * 2} ${ay - r * 1.6}, ${x + r * 2} ${ay + r * 1.6}, ${x} ${ay + 8}`;
          lx = x + r * 1.6; ly = ay;
        } else if (a.col === b.col) {
          const x = a.x + NODE_W, bulge = 50 + Math.abs(by - ay) * 0.25 + idx * 14;
          d = `M ${x} ${ay} C ${x + bulge} ${ay}, ${x + bulge} ${by}, ${x} ${by}`;
          lx = x + bulge * 0.75; ly = (ay + by) / 2;
        } else {
          const forward = a.col < b.col;
          const x1 = forward ? a.x + NODE_W : a.x, x2 = forward ? b.x : b.x + NODE_W, mx = (x1 + x2) / 2;
          d = `M ${x1} ${ay} C ${mx} ${ay + off}, ${mx} ${by + off}, ${x2} ${by}`;
          lx = mx; ly = (ay + by) / 2 + off * 0.75;
        }
        links.push({ key: `${rel.type}|${from}|${to}`, rel, from, to, d, lx, ly, width });
      }
    }
    const width = PAD * 2 + (cols.length - 1) * COL_W + NODE_W + 140;
    const height = PAD * 2 + HEAD + maxRows * ROW;
    return { boxes: [...boxes.values()], links, cols, width, height };
  }, [overview]);

  const focus = hoverLabel ?? activeLabel;
  const linkOn = (l: Link) => (hoverLink ? hoverLink === l.key : focus ? l.from === focus || l.to === focus : false);
  const neighbours = useMemo(() => {
    if (!focus) return null;
    const s = new Set([focus]);
    links.forEach((l) => { if (l.from === focus) s.add(l.to); if (l.to === focus) s.add(l.from); });
    return s;
  }, [focus, links]);
  const showAllLabels = links.length <= 14;

  return (
    <div className="relative h-full w-full">
      <svg
        ref={pz.svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        {...pz.bind}
      >
        <defs>
          <marker id="kg-schema-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10z" className="fill-muted-foreground" />
          </marker>
        </defs>
        <g transform={pz.transform}>
          {cols.map((layer, i) => (
            <text key={layer} x={PAD + i * COL_W + NODE_W / 2} y={PAD} textAnchor="middle" className="fill-muted-foreground text-[12px] font-medium tracking-wide uppercase">
              {layerName(overview, layer)}
            </text>
          ))}
          {links.map((l) => {
            const on = linkOn(l);
            const dim = (focus || hoverLink) && !on;
            return (
              <g key={l.key} className="cursor-pointer" onPointerDown={(e) => e.stopPropagation()} onClick={() => onSelectRel({ type: l.rel.type, a: l.from, b: l.to })} onPointerEnter={() => setHoverLink(l.key)} onPointerLeave={() => setHoverLink(null)}>
                <path d={l.d} fill="none" stroke="transparent" strokeWidth={12} />
                <path
                  d={l.d}
                  fill="none"
                  strokeWidth={on ? l.width + 1 : l.width}
                  strokeDasharray={l.rel.derived ? "5 4" : undefined}
                  markerEnd="url(#kg-schema-arrow)"
                  className={on ? "stroke-primary" : "stroke-muted-foreground"}
                  opacity={dim ? 0.1 : on ? 1 : 0.45}
                />
                {(on || (showAllLabels && !dim)) && (
                  <text x={l.lx} y={l.ly} textAnchor="middle" dy="0.35em" paintOrder="stroke" strokeWidth={4} className="fill-foreground stroke-card text-[11px] font-medium">
                    {l.rel.type}
                    {l.rel.count != null ? ` · ${l.rel.count.toLocaleString()}` : ""}
                  </text>
                )}
              </g>
            );
          })}
          {boxes.map((b) => {
            const color = colors.get(b.label) ?? FALLBACK_COLOR;
            const active = b.label === activeLabel;
            const dim = neighbours && !neighbours.has(b.label);
            return (
              <g
                key={b.label}
                transform={`translate(${b.x} ${b.y})`}
                className="cursor-pointer"
                opacity={dim ? 0.3 : 1}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onSelectType(b.label)}
                onPointerEnter={() => setHoverLabel(b.label)}
                onPointerLeave={() => setHoverLabel(null)}
              >
                <rect width={NODE_W} height={NODE_H} rx={9} className={active ? "fill-card stroke-primary" : "fill-card stroke-border"} strokeWidth={active ? 2 : 1} />
                <rect width={6} height={NODE_H} rx={3} fill={color} />
                <text x={16} y={NODE_H / 2} dy="0.35em" className="fill-foreground text-[13px] font-medium">{truncate(b.label, 18)}</text>
                <text x={NODE_W - 10} y={NODE_H / 2} dy="0.35em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">{b.count.toLocaleString()}</text>
              </g>
            );
          })}
        </g>
      </svg>
      <p className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-card/90 px-2 py-1 text-xs text-muted-foreground shadow-sm ring-1 ring-border">
        Click a type for its connections, or a line to see real examples of that relationship.
      </p>
      <ZoomControls onIn={() => pz.zoomBy(1.25)} onOut={() => pz.zoomBy(0.8)} onReset={pz.reset} />
    </div>
  );
}
