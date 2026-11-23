"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Columns2, Copy, Loader2, Orbit, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { KgHopHint, KgNode, KgNodeDetail, KgNodePage, KgOverview } from "@/lib/kg/types";
import { FALLBACK_COLOR, LAYER_NAME, kgGet, splitKeyProps } from "./api";
import type { RelSelection } from "./RelationshipView";

export type DrawerTarget = { kind: "node"; id: string; seed?: KgNode } | { kind: "type"; label: string };

export interface DrawerActions {
  onClose: () => void;
  onOpenNode: (n: KgNode) => void;
  onOpenType: (label: string) => void;
  onExplore: (n: KgNode, opts?: { rel?: string; dir?: "in" | "out" }) => void;
  onOpenRelationship: (sel: RelSelection) => void;
}

/** Right-hand panel (bottom sheet on phones) for one node or one node type. */
export function NodeDrawer({ target, overview, colors, ...actions }: { target: DrawerTarget; overview: KgOverview; colors: Map<string, string> } & DrawerActions) {
  return target.kind === "node" ? (
    <NodePanel key={target.id} id={target.id} seed={target.seed} overview={overview} colors={colors} {...actions} />
  ) : (
    <TypePanel key={target.label} label={target.label} overview={overview} colors={colors} {...actions} />
  );
}

// ---------------------------------------------------------------- shared bits

function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b px-3">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn("-mb-px border-b-2 px-2 py-2 text-xs font-medium transition-colors", value === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Header({ color, kicker, title, onKicker, onClose, children }: { color: string; kicker: string; title: string; onKicker?: () => void; onClose: () => void; children?: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-b p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <button disabled={!onKicker} onClick={onKicker} className="flex items-center gap-1.5 text-xs text-muted-foreground enabled:hover:text-foreground enabled:hover:underline">
            <span className="size-2 rounded-full" style={{ background: color }} />
            {kicker}
          </button>
          <h3 className="mt-0.5 line-clamp-2 font-semibold break-words" title={title}>{title}</h3>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Close panel" onClick={onClose}><X /></Button>
      </div>
      {children}
    </div>
  );
}

const isNumArray = (v: unknown) => Array.isArray(v) && v.length > 16 && v.every((x) => typeof x === "number");
function fmt(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (isNumArray(v)) return `[${(v as unknown[]).length} numbers]`;
  if (Array.isArray(v) && v.every((x) => x == null || typeof x !== "object")) return v.join(", ");
  return JSON.stringify(v, null, 2);
}

function PropValue({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  const s = fmt(value);
  const code = s.includes("\n") || (typeof value === "object" && value !== null && !Array.isArray(value));
  const long = s.length > 140 || s.split("\n").length > 3;
  return (
    <div className="min-w-0">
      {code ? (
        <pre className={cn("overflow-x-auto rounded bg-muted/60 p-1.5 font-mono text-[11px] leading-snug whitespace-pre-wrap break-words", !open && long && "max-h-16 overflow-hidden")}>{s}</pre>
      ) : (
        <p className={cn("text-xs break-words", !open && long && "line-clamp-3")}>{s}</p>
      )}
      {long && <button onClick={() => setOpen(!open)} className="mt-0.5 text-[11px] font-medium text-primary hover:underline">{open ? "Show less" : "Show more"}</button>}
    </div>
  );
}

const SKIP_AUTO = new Set(["id", "name", "title", "summary", "kind", "label"]);

// ---------------------------------------------------------------- node

function NodePanel({ id, seed, overview, colors, onClose, onOpenType, onExplore, onOpenRelationship }: { id: string; seed?: KgNode; overview: KgOverview; colors: Map<string, string> } & DrawerActions) {
  const [detail, setDetail] = useState<KgNodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"summary" | "rels" | "props">("summary");
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    kgGet<KgNodeDetail>("node", { id }, ctrl.signal).then(setDetail).catch((e) => { if (!ctrl.signal.aborted) setError(e.message); });
    return () => ctrl.abort();
  }, [id]);

  const node: KgNode | undefined = detail?.node ?? seed;
  const label = node?.label ?? "";
  const info = overview.labels.find((l) => l.label === label);
  const props = useMemo(() => Object.entries(detail?.node.props ?? {}).filter(([, v]) => v != null && v !== ""), [detail]);

  const keyProps = useMemo(() => {
    if (!detail) return [];
    const p = detail.node.props;
    const wanted = splitKeyProps(info?.keyProps).filter((k) => !SKIP_AUTO.has(k) && p[k] != null && p[k] !== "");
    if (wanted.length) return wanted.map((k) => [k, p[k]] as const);
    // No key props declared: show the first few short, simple values.
    return props.filter(([k, v]) => !SKIP_AUTO.has(k) && !isNumArray(v) && fmt(v).length <= 80 && !fmt(v).includes("\n")).slice(0, 8);
  }, [detail, info, props]);

  const hints = detail?.hopHints ?? [];
  const out = hints.filter((h) => h.direction === "out"), inn = hints.filter((h) => h.direction === "in");
  const shownProps = props.filter(([k, v]) => !filter || k.toLowerCase().includes(filter.toLowerCase()) || fmt(v).toLowerCase().includes(filter.toLowerCase()));
  const summary = (detail?.node.props.summary as string | undefined) ?? node?.summary ?? null;

  const copy = async () => {
    try { await navigator.clipboard.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard blocked */ }
  };

  const hintRow = (h: KgHopHint) => (
    <li key={`${h.direction}${h.type}`} className="group flex items-center gap-1">
      <button
        onClick={() => node && onExplore(node, { rel: h.type, dir: h.direction })}
        title={`Show these ${h.count} in Explore`}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
      >
        {h.direction === "out" ? <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" /> : <ArrowLeft className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="truncate font-medium">{h.type}</span>
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
          {h.neighbourLabels.slice(0, 2).map((l) => <span key={l} className="flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: colors.get(l) ?? FALLBACK_COLOR }} />{l}</span>)}
        </span>
        <span className="ml-auto pl-1 tabular-nums text-muted-foreground">{h.count.toLocaleString()}</span>
      </button>
      {h.neighbourLabels[0] && (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`All ${label} ${h.type} ${h.neighbourLabels[0]} links side by side`}
          title="See all links of this kind side by side"
          onClick={() => onOpenRelationship({ type: h.type, a: label, b: h.neighbourLabels[0] })}
        >
          <Columns2 />
        </Button>
      )}
    </li>
  );

  return (
    <div className="flex h-full flex-col">
      <Header color={colors.get(label) ?? FALLBACK_COLOR} kicker={label || "Node"} title={node?.name ?? id} onKicker={label ? () => onOpenType(label) : undefined} onClose={onClose}>
        <div className="flex items-center gap-1">
          <code className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={id}>{id}</code>
          <Button size="icon-xs" variant="ghost" aria-label="Copy id" onClick={copy}>{copied ? <Check /> : <Copy />}</Button>
        </div>
        <Button size="sm" className="w-full" disabled={!node} onClick={() => node && onExplore(node)}><Orbit /> Explore from here</Button>
      </Header>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "summary", label: "Summary" },
          { key: "rels", label: `Relationships${detail ? ` (${hints.length})` : ""}` },
          { key: "props", label: `Properties${detail ? ` (${props.length})` : ""}` },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
        {error ? <p className="text-xs text-destructive">{error}</p> : !detail ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : tab === "summary" ? (
          <div className="space-y-4">
            {summary && <PropValue value={summary} />}
            {keyProps.length > 0 && (
              <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                {keyProps.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="truncate text-xs text-muted-foreground" title={k}>{k}</dt>
                    <dd className="min-w-0"><PropValue value={v} /></dd>
                  </div>
                ))}
              </dl>
            )}
            {hints.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Top connections</div>
                <ul className="space-y-0.5">{[...hints].sort((a, b) => b.count - a.count).slice(0, 4).map(hintRow)}</ul>
                {hints.length > 4 && <button onClick={() => setTab("rels")} className="mt-1 text-[11px] font-medium text-primary hover:underline">All {hints.length} relationships</button>}
              </div>
            )}
          </div>
        ) : tab === "rels" ? (
          <div className="space-y-3">
            {hints.length === 0 && <p className="text-xs text-muted-foreground">No relationships.</p>}
            {out.length > 0 && <div><div className="mb-1 text-xs font-medium text-muted-foreground">Outgoing</div><ul className="space-y-0.5">{out.map(hintRow)}</ul></div>}
            {inn.length > 0 && <div><div className="mb-1 text-xs font-medium text-muted-foreground">Incoming</div><ul className="space-y-0.5">{inn.map(hintRow)}</ul></div>}
            <p className="text-[11px] text-muted-foreground">Click a row to add those neighbours to Explore. <Columns2 className="inline size-3" /> shows every link of that kind side by side.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter properties…" className="h-7" aria-label="Filter properties" />
            <dl className="divide-y">
              {shownProps.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 py-1.5">
                  <dt className="truncate text-xs text-muted-foreground" title={k}>{k}</dt>
                  <dd className="min-w-0"><PropValue value={v} /></dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- node type

function TypePanel({ label, overview, colors, onClose, onOpenNode, onOpenRelationship }: { label: string; overview: KgOverview; colors: Map<string, string> } & DrawerActions) {
  const [tab, setTab] = useState<"links" | "nodes">("links");
  const info = overview.labels.find((l) => l.label === label);

  const links = useMemo(() => {
    const rows: { type: string; dir: "out" | "in"; other: string; count?: number; derived?: boolean; means?: string }[] = [];
    for (const r of overview.relationships) {
      if (r.from.includes(label)) r.to.forEach((o) => rows.push({ type: r.type, dir: "out", other: o, count: r.count, derived: r.derived, means: r.means }));
      if (r.to.includes(label)) r.from.forEach((o) => { if (!(o === label && r.from.includes(label) && r.to.includes(label))) rows.push({ type: r.type, dir: "in", other: o, count: r.count, derived: r.derived, means: r.means }); });
    }
    return rows;
  }, [overview, label]);

  return (
    <div className="flex h-full flex-col">
      <Header color={colors.get(label) ?? FALLBACK_COLOR} kicker={`Node type · ${LAYER_NAME[info?.layer ?? "other"]} layer`} title={label} onClose={onClose}>
        <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground tabular-nums">{(info?.count ?? 0).toLocaleString()}</span> nodes{info?.means ? ` · ${info.means}` : ""}</p>
        {info?.keyProps && (
          <div className="flex flex-wrap gap-1">
            {splitKeyProps(info.keyProps).map((k) => <span key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{k}</span>)}
          </div>
        )}
      </Header>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "links", label: `Connections (${links.length})` }, { key: "nodes", label: "Nodes" }]} />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "links" ? (
          <ul className="space-y-0.5">
            {links.length === 0 && <li className="text-xs text-muted-foreground">No relationships.</li>}
            {links.map((l) => (
              <li key={`${l.dir}${l.type}${l.other}`}>
                <button
                  onClick={() => onOpenRelationship({ type: l.type, a: label, b: l.other })}
                  title={l.means ?? "See these links side by side"}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  {l.dir === "out" ? <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" /> : <ArrowLeft className="size-3.5 shrink-0 text-muted-foreground" />}
                  <span className={cn("truncate font-medium", l.derived && "italic")}>{l.type}</span>
                  <span className="flex shrink-0 items-center gap-1 text-muted-foreground"><span className="size-1.5 rounded-full" style={{ background: colors.get(l.other) ?? FALLBACK_COLOR }} />{l.other}</span>
                  {l.count != null && <span className="ml-auto pl-1 tabular-nums text-muted-foreground">{l.count.toLocaleString()}</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <NodeList label={label} onOpenNode={onOpenNode} />
        )}
      </div>
    </div>
  );
}

function NodeList({ label, onOpenNode }: { label: string; onOpenNode: (n: KgNode) => void }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState<{ nodes: KgNode[]; more: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true); setError(null);
      kgGet<KgNodePage>("nodes", { label, q: q.trim(), limit: 50 }, ctrl.signal)
        .then((p) => setPage({ nodes: p.nodes, more: p.hasMore }))
        .catch((e) => { if (!ctrl.signal.aborted) setError(e.message); })
        .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [label, q]);

  const more = async () => {
    if (!page) return;
    setLoading(true);
    try {
      const p = await kgGet<KgNodePage>("nodes", { label, q: q.trim(), skip: page.nodes.length, limit: 50 });
      setPage({ nodes: [...page.nodes, ...p.nodes], more: p.hasMore });
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); } finally { setLoading(false); }
  };

  return (
    <div className="space-y-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${label} by name…`} className="h-7" aria-label="Filter nodes" />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <ul className="space-y-0.5">
        {page?.nodes.map((n) => (
          <li key={n.id}>
            <button onClick={() => onOpenNode(n)} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted">
              <div className="truncate text-xs font-medium">{n.name}</div>
              {n.summary && <div className="truncate text-[11px] text-muted-foreground">{n.summary}</div>}
            </button>
          </li>
        ))}
        {page && page.nodes.length === 0 && !loading && <li className="text-xs text-muted-foreground">No matches.</li>}
      </ul>
      {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      {page?.more && !loading && <Button size="xs" variant="secondary" className="w-full" onClick={more}>Load more</Button>}
    </div>
  );
}
