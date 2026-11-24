"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Columns2, Loader2, Orbit, Search, Share2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { KgGraphName, KgNode, KgOverview } from "@/lib/kg/types";
import { FALLBACK_COLOR, GRAPH_LABEL, GraphContext, labelColors, useKgGet } from "./api";
import { ExploreView, type ExploreHandle } from "./ExploreView";
import { NodeDrawer, type DrawerTarget } from "./NodeDrawer";
import { RelationshipView, type RelSelection } from "./RelationshipView";
import { SchemaView } from "./SchemaView";

type View = "schema" | "relationship" | "explore";
const VIEWS: { key: View; label: string; icon: typeof Share2; hint: string }[] = [
  { key: "schema", label: "Schema", icon: Share2, hint: "All node types and how they connect" },
  { key: "relationship", label: "Relationship", icon: Columns2, hint: "Two node types side by side" },
  { key: "explore", label: "Explore", icon: Orbit, hint: "Walk outward from a node" },
];

/**
 * Admin knowledge-graph explorer: graph switcher, toolbar, one of three views, and a details drawer.
 * `graph` comes from `?graph=new` (D12); the explorer remounts when it changes, so selection and expanded nodes reset.
 */
export function GraphExplorer({ graph = "old", newAvailable = false }: { graph?: KgGraphName; newAvailable?: boolean }) {
  return (
    <GraphContext.Provider value={graph}>
      <Explorer key={graph} graph={graph} newAvailable={newAvailable} />
    </GraphContext.Provider>
  );
}

function Explorer({ graph, newAvailable }: { graph: KgGraphName; newAvailable: boolean }) {
  const kgGet = useKgGet();
  const router = useRouter();
  const [switching, startSwitch] = useTransition();
  const switchTo = (g: KgGraphName) => startSwitch(() => router.replace(g === "new" ? "/admin/graph?graph=new" : "/admin/graph", { scroll: false }));
  const [overview, setOverview] = useState<KgOverview | null>(null);
  const [view, setView] = useState<View>("schema");
  const [rel, setRel] = useState<RelSelection>({});
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(0);
  const explore = useRef<ExploreHandle>(null);
  const colors = useMemo(() => labelColors(overview), [overview]);

  const reportError = useCallback((msg: string) => setError(msg), []);
  const reportBusy = useCallback((b: boolean) => setBusy((n) => Math.max(0, n + (b ? 1 : -1))), []);

  useEffect(() => {
    kgGet<KgOverview>("overview").then(setOverview).catch((e) => setError(e.message));
  }, [kgGet]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  // Esc closes the drawer (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      setDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openNode = useCallback((n: KgNode) => setDrawer({ kind: "node", id: n.id, seed: n }), []);
  const openType = useCallback((label: string) => setDrawer({ kind: "type", label }), []);
  const openRelationship = useCallback((sel: RelSelection) => { setRel(sel); setView("relationship"); }, []);
  const exploreFrom = useCallback((n: KgNode, opts?: { rel?: string; dir?: "in" | "out" }) => {
    setView("explore");
    setDrawer({ kind: "node", id: n.id, seed: n });
    explore.current?.add(n);
    void explore.current?.expand(n.id, opts?.rel, opts?.dir);
  }, []);
  const pickSearchHit = (n: KgNode) => {
    openNode(n);
    if (view === "explore") explore.current?.add(n);
  };

  const selectedId = drawer?.kind === "node" ? drawer.id : null;
  const activeLabel = drawer?.kind === "type" ? drawer.label : null;

  return (
    <div data-fullbleed className="flex h-[calc(100dvh-17rem)] min-h-[520px] flex-col overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-foreground/[0.07]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div role="tablist" aria-label="Knowledge graph" className="flex rounded-lg bg-muted p-0.5">
          {(["old", "new"] as const).map((g) => {
            const unavailable = g === "new" && !newAvailable && graph !== "new";
            return (
              <button
                key={g}
                role="tab"
                aria-selected={graph === g}
                disabled={unavailable}
                title={unavailable ? "SpectrumERP-new is not configured" : undefined}
                onClick={() => graph !== g && switchTo(g)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  graph === g ? "bg-card text-foreground shadow-sm" : "text-muted-foreground enabled:hover:text-foreground",
                )}
              >
                {GRAPH_LABEL[g]}
              </button>
            );
          })}
        </div>
        <div role="tablist" aria-label="Graph view" className="flex rounded-lg bg-muted p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="tab"
              aria-selected={view === v.key}
              title={v.hint}
              onClick={() => setView(v.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                view === v.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <v.icon className="size-3.5" />
              {v.label}
            </button>
          ))}
        </div>
        <SearchBox colors={colors} onPick={pickSearchHit} />
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {(busy > 0 || switching) && <Loader2 className="size-4 animate-spin" />}
          {overview && <span className="hidden sm:inline">{overview.labels.length} types · {new Set(overview.relationships.map((r) => r.type)).size} relationships · {overview.totalNodes.toLocaleString()} nodes</span>}
        </div>
      </div>

      {/* Body: view + drawer */}
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {!overview ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              {error ? <span className="text-destructive">{error}</span> : <Loader2 className="size-5 animate-spin" />}
            </div>
          ) : (
            <>
              <div className={cn("h-full", view !== "schema" && "hidden")}>
                <SchemaView overview={overview} colors={colors} activeLabel={activeLabel} onSelectType={openType} onSelectRel={openRelationship} />
              </div>
              <div className={cn("h-full", view !== "relationship" && "hidden")}>
                <RelationshipView overview={overview} colors={colors} value={rel} onChange={setRel} selectedId={selectedId} onSelectNode={openNode} onError={reportError} />
              </div>
              <div className={cn("h-full", view !== "explore" && "hidden")}>
                <ExploreView ref={explore} colors={colors} selectedId={selectedId} onSelectNode={openNode} onError={reportError} onBusy={reportBusy} />
              </div>
            </>
          )}
          {error && overview && (
            <div role="alert" className="absolute inset-x-3 bottom-3 z-20 mx-auto flex max-w-lg items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive shadow-sm ring-1 ring-destructive/20 backdrop-blur">
              <span className="flex-1">{error}</span>
              <button aria-label="Dismiss" onClick={() => setError(null)}><X className="size-3.5" /></button>
            </div>
          )}
        </div>

        {drawer && overview && (
          <aside
            aria-label="Details"
            className="absolute inset-x-0 bottom-0 z-30 h-[65%] rounded-t-xl border-t bg-card shadow-lg lg:static lg:h-auto lg:w-[380px] lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-none"
          >
            <NodeDrawer
              target={drawer}
              overview={overview}
              colors={colors}
              onClose={() => setDrawer(null)}
              onOpenNode={openNode}
              onOpenType={openType}
              onExplore={exploreFrom}
              onOpenRelationship={openRelationship}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

function SearchBox({ colors, onPick }: { colors: Map<string, string>; onPick: (n: KgNode) => void }) {
  const kgGet = useKgGet();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<KgNode[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      kgGet<{ hits: KgNode[] }>("search", { q: term, limit: 15 }, ctrl.signal)
        .then((r) => { setHits(r.hits); setActive(0); setOpen(true); })
        .catch(() => { if (!ctrl.signal.aborted) setHits([]); })
        .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, kgGet]);

  const choose = (n: KgNode) => { onPick(n); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (!hits?.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); setOpen(true); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(hits[active]); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="relative w-full sm:w-72" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits && setOpen(true)}
        onKeyDown={onKey}
        placeholder="Search nodes…"
        aria-label="Search nodes"
        role="combobox"
        aria-expanded={open}
        aria-controls="kg-search-results"
        className="h-7 pl-8"
      />
      {loading && <Loader2 className="absolute top-1/2 right-2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
      {open && hits && (
        <ul id="kg-search-results" role="listbox" className="absolute top-full right-0 left-0 z-40 mt-1 max-h-80 overflow-y-auto rounded-lg bg-popover p-1 shadow-lg ring-1 ring-border">
          {hits.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">No matches.</li>}
          {hits.map((n, i) => (
            <li key={n.id} role="option" aria-selected={i === active}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(n)}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left", i === active && "bg-muted")}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: colors.get(n.label) ?? FALLBACK_COLOR }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{n.name}</span>
                  {n.summary && <span className="block truncate text-[11px] text-muted-foreground">{n.summary}</span>}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{n.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
