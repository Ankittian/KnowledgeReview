import { cn } from "@/lib/utils";

/** Thinking indicator: one node splits into a small knowledge graph, rotates, then merges back. Green in light theme, blue in dark. */
export function KgLoader({ className, animated = true }: { className?: string; animated?: boolean }) {
  return (
    <svg viewBox="-10 -10 20 20" className={cn("kg-loader size-5 shrink-0", !animated && "kg-static", className)} aria-hidden>
      <g className="kg-orbit" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" fill="currentColor">
        <line className="kg-edge" x1="0" y1="0" x2="0.0" y2="-6.5" />
        <line className="kg-edge" x1="0" y1="0" x2="6.18" y2="-2.01" />
        <line className="kg-edge" x1="0" y1="0" x2="3.82" y2="5.26" />
        <line className="kg-edge" x1="0" y1="0" x2="-3.82" y2="5.26" />
        <line className="kg-edge" x1="0" y1="0" x2="-6.18" y2="-2.01" />
        <circle className="kg-sat" cx="0" cy="0" r="1.7" style={{ "--x": "0.0px", "--y": "-6.5px" } as React.CSSProperties} />
        <circle className="kg-sat" cx="0" cy="0" r="1.7" style={{ "--x": "6.18px", "--y": "-2.01px" } as React.CSSProperties} />
        <circle className="kg-sat" cx="0" cy="0" r="1.7" style={{ "--x": "3.82px", "--y": "5.26px" } as React.CSSProperties} />
        <circle className="kg-sat" cx="0" cy="0" r="1.7" style={{ "--x": "-3.82px", "--y": "5.26px" } as React.CSSProperties} />
        <circle className="kg-sat" cx="0" cy="0" r="1.7" style={{ "--x": "-6.18px", "--y": "-2.01px" } as React.CSSProperties} />
      </g>
      <circle cx="0" cy="0" r="2.2" fill="currentColor" />
    </svg>
  );
}
