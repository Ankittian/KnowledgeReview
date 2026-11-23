import type { KgLayer, KgOverview } from "@/lib/kg/types";

const API = "/api/admin/graph";

type Params = Record<string, string | string[] | number | undefined | null>;

/** GET one of the admin graph endpoints. Throws an Error with the server's message on failure. */
export async function kgGet<T>(path: string, params: Params = {}, signal?: AbortSignal): Promise<T> {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const values = Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v];
    for (const x of values) u.append(k, String(x));
  }
  const r = await fetch(`${API}/${path}?${u}`, { cache: "no-store", signal });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
  return body as T;
}

export const LAYERS: KgLayer[] = ["functional", "bridge", "code", "data", "other"];
export const LAYER_NAME: Record<KgLayer, string> = { functional: "Functional", bridge: "Bridge", code: "Code", data: "Data", other: "Other" };

const PALETTE = ["#6366f1", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6", "#0ea5e9", "#84cc16", "#ec4899", "#f97316", "#10b981", "#a855f7", "#64748b"];
export const FALLBACK_COLOR = "#94a3b8";

/** Stable colour per node type, in overview order. */
export function labelColors(overview: KgOverview | null): Map<string, string> {
  const m = new Map<string, string>();
  (overview?.labels ?? []).forEach((l, i) => m.set(l.label, PALETTE[i % PALETTE.length]));
  return m;
}

export const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** "a, b c" -> ["a", "b", "c"] */
export const splitKeyProps = (s?: string) => (s ?? "").split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
