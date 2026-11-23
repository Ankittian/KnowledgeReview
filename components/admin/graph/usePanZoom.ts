"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PanZoom {
  x: number;
  y: number;
  k: number;
}

/**
 * Pan (drag the background) and zoom (wheel / pinch-trackpad) for an <svg> with a viewBox.
 * Put `transform` on an inner <g>. Node drags should call stopPropagation on pointerdown.
 */
export function usePanZoom() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [t, setT] = useState<PanZoom>({ x: 0, y: 0, k: 1 });
  const pan = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);

  /** Client pixel -> viewBox coordinate (before the pan/zoom transform). */
  const toView = useCallback((cx: number, cy: number) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: cx, y: cy };
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }, []);

  /** Client pixel -> graph coordinate (after undoing pan/zoom). */
  const tRef = useRef(t);
  tRef.current = t;
  const toGraph = useCallback(
    (cx: number, cy: number) => {
      const v = toView(cx, cy);
      const { x, y, k } = tRef.current;
      return { x: (v.x - x) / k, y: (v.y - y) / k };
    },
    [toView],
  );

  // Native, non-passive wheel listener so the page does not scroll while zooming.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = toView(e.clientX, e.clientY);
      setT((cur) => {
        const k = Math.min(4, Math.max(0.15, cur.k * Math.exp(-e.deltaY * 0.0015)));
        const gx = (v.x - cur.x) / cur.k, gy = (v.y - cur.y) / cur.k;
        return { k, x: v.x - gx * k, y: v.y - gy * k };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toView]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = toView(e.clientX, e.clientY);
    pan.current = { sx: v.x, sy: v.y, x: tRef.current.x, y: tRef.current.y };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = pan.current;
    if (!p) return;
    const v = toView(e.clientX, e.clientY);
    // toView depends on the current transform only through the CTM of the <svg>, which pan does not change.
    setT((cur) => ({ ...cur, x: p.x + (v.x - p.sx), y: p.y + (v.y - p.sy) }));
  };
  const onPointerUp = () => {
    pan.current = null;
  };

  const zoomBy = (f: number) => setT((cur) => ({ ...cur, k: Math.min(4, Math.max(0.15, cur.k * f)) }));
  const reset = useCallback(() => setT({ x: 0, y: 0, k: 1 }), []);

  return {
    svgRef,
    t,
    transform: `translate(${t.x} ${t.y}) scale(${t.k})`,
    toGraph,
    reset,
    zoomBy,
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}

/** Width of an element, kept up to date with a ResizeObserver. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
