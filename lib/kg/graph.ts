import { callTool, KgClientError } from "./client";
import type { KgEdge, KgGraph, KgHopHint, KgLabelInfo, KgNode, KgNodeDetail, KgNodePage, KgOverview, KgRelInfo } from "./types";

type Row = Record<string, any>; // MCP tool responses are dynamically shaped.
const derivedTypes = new Set(["CALLS_SP", "USES_TABLE", "SHARES_TABLE", "PERSISTED_IN"]);
const clamp = (n: number | undefined, fallback: number, max: number) => Number.isFinite(n) ? Math.min(max, Math.max(1, Math.floor(n!))) : fallback;
const offset = (n: number | undefined) => Number.isFinite(n) ? Math.max(0, Math.floor(n!)) : 0;
const node = (r: Row): KgNode => ({ id: String(r.id), label: r.label ?? r.kind ?? "other", name: r.name || r.title || String(r.id), ...(r.summary != null ? { summary: r.summary } : {}), ...(typeof r.score === "number" ? { score: r.score } : {}) });
const edge = (source: string, type: string, target: string, props?: Row): KgEdge => ({ id: JSON.stringify([source, type, target]), source, type, target, ...(props && Object.keys(props).length ? { props } : {}), ...(derivedTypes.has(type) || props?.derived === true ? { derived: true } : {}) });
const cypher = async (query: string, params: Row = {}, limit = 1000): Promise<Row[]> => (await callTool<Row>("run_cypher", { query, params, limit, profile: "detailed" })).rows ?? [];
const layers = [{ id: "functional", name: "Functional" }, { id: "bridge", name: "Bridge" }, { id: "code", name: "Code" }, { id: "data", name: "Data" }, { id: "other", name: "Other" }];
let cached: { value: KgOverview; until: number } | undefined;

export async function overview(): Promise<KgOverview> {
  if (cached && cached.until > Date.now()) return cached.value;
  const [schema, counts] = await Promise.all([callTool<Row>("describe_graph"), cypher("MATCH (n:Searchable) WHERE n.kind IS NOT NULL RETURN n.kind AS label, count(*) AS count")]);
  const metadata = new Map<string, Row>((schema.labels ?? []).map((v: Row) => [v.label, v]));
  const labels: KgLabelInfo[] = counts.map((r) => { const m = metadata.get(r.label); return { label: r.label, count: r.count, layer: layers.some(l => l.id === m?.layer && l.id !== "other") ? m!.layer : "other", ...(m?.means ? { means: m.means } : {}), ...(m?.key_props ? { keyProps: m.key_props } : {}) }; });
  const relationships: KgRelInfo[] = (schema.relationships ?? []).map((r: Row) => ({ type: r.type, from: Array.isArray(r.from) ? r.from : String(r.from ?? "").split("|").filter(Boolean), to: Array.isArray(r.to) ? r.to : String(r.to ?? "").split("|").filter(Boolean), means: r.means, derived: Boolean(r.derived), count: r.count }));
  const value = { layers, labels, relationships, totalNodes: labels.reduce((s, l) => s + l.count, 0), fetchedAt: new Date().toISOString() };
  cached = { value, until: Date.now() + 300_000 }; return value;
}

async function validate(values: string[], kind: "label" | "relationship") {
  if (!values.length) return;
  const map = await overview();
  const allowed = new Set(kind === "label" ? map.labels.map(x => x.label) : map.relationships.map(x => x.type));
  if (values.some(v => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) || !allowed.has(v))) throw new KgClientError("bad_request", `Unknown ${kind}`);
}

export async function search(q: string, labels: string[] = [], limit = 20): Promise<{ hits: KgNode[] }> {
  await validate(labels, "label");
  const data = await callTool<Row>("search", { query: q, labels: labels.length ? labels : null, top_k: clamp(limit, 20, 30) });
  return { hits: (data.results ?? []).map(node) };
}
export async function nodes(label: string, q = "", skip = 0, limit = 50): Promise<KgNodePage> {
  await validate([label], "label"); const n = clamp(limit, 50, 200);
  const found = await cypher("MATCH (n:Searchable) WHERE n.kind = $label AND ($q = '' OR toLower(coalesce(n.name, n.title, '')) CONTAINS toLower($q)) RETURN n.id AS id, n.kind AS label, coalesce(n.name, n.title, n.id) AS name, n.summary AS summary ORDER BY name, id SKIP $skip LIMIT $limit", { label, q, skip: offset(skip), limit: n + 1 }, n + 1);
  return { nodes: found.slice(0, n).map(node), hasMore: found.length > n };
}
export async function nodeDetail(id: string): Promise<KgNodeDetail> {
  const data = await callTool<Row>("get_node", { id, detail: "full" });
  if (!data.node) throw new KgClientError("not_found", "Node not found");
  const hints: KgHopHint[] = [];
  for (const direction of ["out", "in"] as const) for (const [type, raw] of Object.entries(data.hop_hints?.[direction] ?? {})) {
    const h = raw as Row | [number, string[]];
    hints.push({ type, direction, count: Array.isArray(h) ? h[0] : h.count, neighbourLabels: (Array.isArray(h) ? h[1] : h.labels) ?? [] });
  }
  return { node: { ...node(data.node), props: data.node }, hopHints: hints };
}
export async function expand(ids: string[], rels: string[] = [], direction: "in" | "out" | "both" = "both", labels: string[] = [], limit = 25, cursor?: string): Promise<KgGraph> {
  await Promise.all([validate(rels, "relationship"), validate(labels, "label")]);
  const data = await callTool<Row>("expand", { ids, rel_types: rels.length ? rels : null, direction, target_labels: labels.length ? labels : null, limit: clamp(limit, 25, 100), cursor: cursor || null, profile: "detailed" });
  const seeds = await cypher("MATCH (n:Searchable) WHERE n.id IN $ids RETURN n.id AS id, n.kind AS label, coalesce(n.name, n.title, n.id) AS name, n.summary AS summary", { ids: data.from ?? ids }, 1000);
  const ns = new Map<string, KgNode>(seeds.map(r => [r.id, node(r)])); const es = new Map<string, KgEdge>();
  for (const [source, groups] of Object.entries(data.results ?? {})) for (const [key, neighbours] of Object.entries(groups as Row)) {
    const match = /^(.*) \((in|out)\)$/.exec(key); if (!match) continue;
    for (const item of neighbours as Row[]) { ns.set(item.id, node(item)); const e = match[2] === "out" ? edge(source, match[1], item.id, item.edge) : edge(item.id, match[1], source, item.edge); es.set(e.id, e); }
  }
  return { nodes: [...ns.values()], edges: [...es.values()], truncated: Boolean(data.truncated), nextCursor: data.next_cursor ?? null };
}
export async function edges(type: string, limit = 50, skip = 0): Promise<KgGraph> {
  await validate([type], "relationship"); const n = clamp(limit, 50, 300);
  const rows = await cypher("MATCH (a:Searchable)-[r]->(b:Searchable) WHERE type(r) = $type AND a.kind IS NOT NULL AND b.kind IS NOT NULL RETURN a.id AS aid, a.kind AS alabel, coalesce(a.name, a.title, a.id) AS aname, b.id AS bid, b.kind AS blabel, coalesce(b.name, b.title, b.id) AS bname, properties(r) AS props ORDER BY aid, bid SKIP $skip LIMIT $limit", { type, skip: offset(skip), limit: n + 1 }, n + 1);
  const ns = new Map<string, KgNode>(); const es = new Map<string, KgEdge>();
  for (const r of rows.slice(0, n)) { ns.set(r.aid, node({ id: r.aid, label: r.alabel, name: r.aname })); ns.set(r.bid, node({ id: r.bid, label: r.blabel, name: r.bname })); const e = edge(r.aid, type, r.bid, r.props); es.set(e.id, e); }
  return { nodes: [...ns.values()], edges: [...es.values()], truncated: rows.length > n };
}
export async function paths(from: string, to: string, maxHops = 6, k = 3, excludeDerived = false): Promise<KgGraph> {
  const data = await callTool<Row>("find_paths", { from_id: from, to_id: to, max_hops: clamp(maxHops, 6, 8), k: clamp(k, 3, 10), exclude_derived: excludeDerived }, { timeoutMs: 35_000 });
  const ns = new Map<string, KgNode>(); const es = new Map<string, KgEdge>();
  for (const path of data.paths ?? []) { const steps = path.steps as Row[]; for (let i = 0; i < steps.length; i += 2) { const a = steps[i]; ns.set(a.id, node(a)); if (steps[i + 1] && steps[i + 2]) { const r = steps[i + 1], b = steps[i + 2]; const e = r.dir === "->" ? edge(a.id, r.rel, b.id) : edge(b.id, r.rel, a.id); es.set(e.id, e); } } }
  return { nodes: [...ns.values()], edges: [...es.values()], truncated: false };
}
