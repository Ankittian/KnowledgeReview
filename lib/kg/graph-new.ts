import { callTool, KgClientError, kgConfigured } from "./client";
import type { KgCode, KgEdge, KgGraph, KgHopHint, KgLabelInfo, KgNode, KgNodeDetail, KgNodePage, KgOverview, KgRelInfo } from "./types";

/**
 * Explorer adapter for SpectrumERP-new (D12, D14-D16), behind the same contract as graph.ts. Read-only: describe_graph,
 * search, get_nodes, expand, run_cypher (read queries) and read_code, with the technical token. Node `label` is the
 * graph's own type name (Neo4j label: SP, Table, FormClass, Method...); ids carry a prefix (SP:, TB:, F:, FORM:, M:...).
 */
type Row = Record<string, any>; // MCP tool responses are dynamically shaped.
const call = <T = Row>(name: string, args: Row = {}, timeoutMs?: number, raw?: boolean) => callTool<T>(name, args, { graph: "new", timeoutMs, raw });
const clamp = (n: number | undefined, fallback: number, max: number) => Number.isFinite(n) ? Math.min(max, Math.max(1, Math.floor(n!))) : fallback;
const offset = (n: number | undefined) => Number.isFinite(n) ? Math.max(0, Math.floor(n!)) : 0;
/** The server's compact table form { cols, rows } -> records. */
const records = (t: Row | undefined): Row[] => { const cols: string[] = t?.cols ?? []; return (t?.rows ?? []).map((r: unknown[]) => Object.fromEntries(cols.map((c, i) => [c, r[i]]))); };
const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Id prefix -> node type, as the server defines them (kg/config.py PREFIX_LABEL). */
const PREFIX_LABEL: Record<string, string> = { SYS: "System", MOD: "Module", LIB: "Library", SCH: "Schema", PRJ: "Project", SLN: "Solution", DB: "Database", SP: "SP", CLS: "Class", TB: "Table", RPT: "Report", F: "Form", FORM: "FormClass", VW: "View", GD: "GlobalDataTable", FN: "Function", TR: "Trigger", UC: "UserControl", WP: "WebPage", EXT: "ExternalObject", RULE: "Rule", WUC: "WebUserControl", M: "Method", COL: "Column", CTL: "UIControl", EV: "EnumValue" };
const LABEL_PREFIX = Object.fromEntries(Object.entries(PREFIX_LABEL).map(([p, l]) => [l, p]));
/** Schema-map columns, left -> right (approved layer table, plan §3.2); types are listed by id prefix. */
const LAYERS: { id: string; name: string; prefixes: string[] }[] = [
  { id: "menu", name: "Menu", prefixes: ["MOD", "F"] },
  { id: "screens", name: "Screens", prefixes: ["FORM", "CTL", "RPT"] },
  { id: "app", name: "Application code", prefixes: ["CLS", "M"] },
  { id: "database", name: "Database logic", prefixes: ["SP", "FN", "TR", "VW"] },
  { id: "data", name: "Data", prefixes: ["TB", "COL"] },
  { id: "lookups", name: "Lookups", prefixes: ["GD", "EV"] },
  { id: "other", name: "Other", prefixes: [] },
];
const layerOf = (prefix: string) => LAYERS.find(l => l.prefixes.includes(prefix))?.id ?? "other";

const node = (r: Row): KgNode => {
  const id = String(r.id), score = /(\d(?:\.\d+)?)\s*$/.exec(String(r.why ?? ""));
  return { id, label: r.type ?? r.label ?? "other", name: r.name || id, ...(text(r.purpose ?? r.summary) ? { summary: text(r.purpose ?? r.summary) } : {}), ...(score ? { score: Number(score[1]) } : {}) };
};
const edge = (source: string, type: string, target: string, props?: Row): KgEdge => {
  const p = Object.fromEntries(Object.entries(props ?? {}).filter(([, v]) => v != null && v !== false && v !== ""));
  return { id: JSON.stringify([source, type, target]), source, type, target, ...(Object.keys(p).length ? { props: p } : {}), ...(props?.derived === true ? { derived: true } : {}) };
};
const cypher = (query: string, params: Row = {}, limit = 200) => call<Row>("run_cypher", { query, params, limit });

/**
 * One page of a Cypher query ending in `SKIP $skip LIMIT $limit`. The server cuts a reply at ~12k characters, so a page
 * may arrive in several calls; the result says whether more rows exist beyond `want`.
 */
async function rowsPage(query: string, params: Row, skip: number, want: number, chunk = 40): Promise<{ rows: Row[]; more: boolean }> {
  const rows: Row[] = []; let at = skip;
  for (let i = 0; i < 12 && rows.length < want + 1; i++) {
    const limit = Math.min(chunk, want + 1 - rows.length);
    const data = await cypher(query, { ...params, skip: at, limit }, limit);
    const got: Row[] = data.rows ?? [];
    rows.push(...got); at += got.length;
    if (!got.length || (got.length < limit && !data.truncated)) break;
  }
  return { rows: rows.slice(0, want), more: rows.length > want };
}

// ---------------------------------------------------------------- overview

interface TypeRow { type: string; prefix: string; count: number; withCode: number }
interface Pattern { src: string; rel: string; dst: string; n: number; derived: number }
let cached: { value: KgOverview; until: number } | undefined;

/** Types and relationship patterns: describe_graph when the server exposes it, else the same facts read with run_cypher. */
async function schema(): Promise<{ types: TypeRow[]; patterns: Pattern[] }> {
  try {
    const [map, rels] = await Promise.all([call<Row>("describe_graph"), call<Row>("describe_graph", { section: "relationships" })]);
    return {
      types: records(map.types).map(r => ({ type: String(r.type), prefix: String(r.prefix ?? "").replace(/:$/, ""), count: Number(r.count) || 0, withCode: Number(r.with_code) || 0 })),
      patterns: records(rels).map(r => ({ src: String(r.src), rel: String(r.rel), dst: String(r.dst), n: Number(r.n) || 0, derived: Number(r.derived) || 0 })),
    };
  } catch (error) {
    if (!(error instanceof KgClientError && error.missingTool)) throw error;
  }
  const [counts, rels] = await Promise.all([
    cypher("MATCH (n) RETURN labels(n)[0] AS type, count(*) AS count, count(n.file_path) AS with_code ORDER BY count DESC"),
    // One row holding every pattern: the server trims long row lists, not a single row.
    call<Row>("run_cypher", { query: "MATCH (a)-[r]->(b) WITH labels(a)[0] AS src, type(r) AS rel, labels(b)[0] AS dst, count(*) AS n, sum(CASE WHEN coalesce(r.derived, false) THEN 1 ELSE 0 END) AS derived ORDER BY n DESC RETURN collect([src, rel, dst, n, derived]) AS patterns", params: {}, limit: 1 }, 35_000),
  ]);
  return {
    types: (counts.rows ?? []).filter((r: Row) => r.type).map((r: Row) => ({ type: String(r.type), prefix: LABEL_PREFIX[r.type] ?? "", count: Number(r.count) || 0, withCode: Number(r.with_code) || 0 })),
    patterns: ((rels.rows?.[0]?.patterns ?? []) as unknown[][]).map(([src, rel, dst, n, derived]) => ({ src: String(src), rel: String(rel), dst: String(dst), n: Number(n) || 0, derived: Number(derived) || 0 })),
  };
}

export async function overview(): Promise<KgOverview> {
  if (!kgConfigured("new")) throw new KgClientError("kg_unconfigured", "Knowledge graph is not configured");
  if (cached && cached.until > Date.now()) return cached.value;
  const { types, patterns } = await schema();
  const labels: KgLabelInfo[] = types.map(t => ({ label: t.type, count: t.count, layer: layerOf(t.prefix), ...(t.withCode > 0 ? { hasCode: true } : {}) }));
  // One entry per (relationship, from, to) pattern, so the schema map never draws a pair the graph does not have.
  const relationships: KgRelInfo[] = patterns.map(p => ({ type: p.rel, from: [p.src], to: [p.dst], count: p.n, derived: p.n > 0 && p.derived >= p.n }));
  const value: KgOverview = { layers: LAYERS.map(({ id, name }) => ({ id, name })), labels, relationships, totalNodes: labels.reduce((s, l) => s + l.count, 0), fetchedAt: new Date().toISOString() };
  cached = { value, until: Date.now() + 300_000 }; return value;
}

/** Every label / relationship type that reaches a Cypher string or a tool argument must be a known identifier of this graph. */
async function validate(values: string[], kind: "label" | "relationship") {
  if (!values.length) return;
  const map = await overview();
  const allowed = new Set(kind === "label" ? map.labels.map(x => x.label) : map.relationships.map(x => x.type));
  if (values.some(v => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) || !allowed.has(v))) throw new KgClientError("bad_request", `Unknown ${kind}`);
}
/** Type of a node id from its prefix ("SP:x" -> "SP"); unknown prefix = no such node. */
const labelOf = (id: string) => PREFIX_LABEL[id.split(":", 1)[0]] ?? (() => { throw new KgClientError("not_found", "Node not found"); })();

// ---------------------------------------------------------------- reads

export async function search(q: string, labels: string[] = [], limit = 20): Promise<{ hits: KgNode[] }> {
  await validate(labels, "label");
  const data = await call("search", { query: q, ...(labels.length ? { types: labels } : {}), limit: clamp(limit, 20, 30), profile: "compact" });
  return { hits: records(data.hits).map(node) };
}
export async function nodes(label: string, q = "", skip = 0, limit = 50): Promise<KgNodePage> {
  await validate([label], "label"); const n = clamp(limit, 50, 200);
  const { rows, more } = await rowsPage(`MATCH (n:\`${label}\`) WHERE $q = '' OR toLower(coalesce(n.name, '')) CONTAINS toLower($q) RETURN n.id AS id, coalesce(n.name, n.id) AS name, left(coalesce(n.purpose, n.meaning, n.description, ''), 120) AS summary ORDER BY name, id SKIP $skip LIMIT $limit`, { q }, offset(skip), n, 30);
  return { nodes: rows.map(r => node({ ...r, type: label })), hasMore: more };
}
export async function nodeDetail(id: string): Promise<KgNodeDetail> {
  const [data, around] = await Promise.all([call<Row>("get_nodes", { ids: [id], profile: "detailed" }), call<Row>("expand", { ids: [id], summary_only: true }).catch(() => null)]);
  const found = data.nodes?.[0] as Row | undefined;
  if (!found) throw new KgClientError("not_found", "Node not found");
  const { links, hop_hints: _hints, ...props } = found;
  const byGroup = new Map<string, KgHopHint>();
  for (const r of records(around?.summary)) { // neighbour types per relationship, as expand(rel, dir) would return them
    const key = `${r.dir}|${r.rel}`, h = byGroup.get(key) ?? { type: String(r.rel), direction: r.dir === "in" ? "in" as const : "out" as const, count: 0, neighbourLabels: [] };
    h.count += Number(r.n) || 0; if (r.neighbor_type && !h.neighbourLabels.includes(r.neighbor_type)) h.neighbourLabels.push(r.neighbor_type); byGroup.set(key, h);
  }
  if (!byGroup.size) for (const direction of ["out", "in"] as const) for (const [type, count] of Object.entries((links?.[direction] ?? {}) as Row)) byGroup.set(`${direction}|${type}`, { type, direction, count: Number(count) || 0, neighbourLabels: [] });
  return { node: { ...node(found), props }, hopHints: [...byGroup.values()].sort((a, b) => b.count - a.count) };
}
export async function expand(ids: string[], rels: string[] = [], direction: "in" | "out" | "both" = "both", labels: string[] = [], limit = 25, cursor?: string): Promise<KgGraph> {
  if (ids.length > 25 || ids.some(id => !id.trim())) throw new KgClientError("bad_request", "Invalid id");
  await Promise.all([validate(rels, "relationship"), validate(labels, "label")]);
  const [data, seeds] = await Promise.all([
    call<Row>("expand", { ids, direction, ...(rels.length ? { rel_types: rels } : {}), ...(labels.length ? { target_types: labels } : {}), limit: clamp(limit, 25, 100), skip: cursor ? offset(Number(cursor)) : 0, profile: "compact" }),
    call<Row>("get_nodes", { ids, profile: "compact" }).catch(() => ({ nodes: [] as Row[] })),
  ]);
  const ns = new Map<string, KgNode>((seeds.nodes ?? []).map((r: Row) => [r.id, node(r)])); const es = new Map<string, KgEdge>();
  for (const group of (data.groups ?? []) as Row[]) {
    const source = String(group.from ?? (Array.isArray(data.from) ? data.from[0] : data.from));
    for (const item of records(group.neighbors)) {
      ns.set(item.id, node(item));
      const e = group.dir === "in" ? edge(item.id, group.rel, source, { count: item.count, confidence: item.confidence, derived: item.derived }) : edge(source, group.rel, item.id, { count: item.count, confidence: item.confidence, derived: item.derived });
      es.set(e.id, e);
    }
  }
  const more = data.next_skip != null;
  return { nodes: [...ns.values()], edges: [...es.values()], truncated: more || Boolean(data.truncated), nextCursor: more ? String(data.next_skip) : null };
}
export async function edges(type: string, limit = 50, skip = 0): Promise<KgGraph> {
  await validate([type], "relationship"); const n = clamp(limit, 50, 300);
  const { rows, more } = await rowsPage(`MATCH (a)-[r:\`${type}\`]->(b) RETURN [a.id, labels(a)[0], coalesce(a.name, a.id), b.id, labels(b)[0], coalesce(b.name, b.id), [k IN keys(r) WHERE k <> 'evidence' | [k, r[k]]]] AS e ORDER BY a.id, b.id SKIP $skip LIMIT $limit`, {}, offset(skip), n, 30);
  const ns = new Map<string, KgNode>(); const es = new Map<string, KgEdge>();
  for (const { e: [aid, alabel, aname, bid, blabel, bname, props] } of rows as { e: unknown[][] }[]) {
    ns.set(String(aid), node({ id: aid, type: alabel, name: aname })); ns.set(String(bid), node({ id: bid, type: blabel, name: bname }));
    const x = edge(String(aid), type, String(bid), Object.fromEntries((props as [string, unknown][]) ?? [])); es.set(x.id, x);
  }
  return { nodes: [...ns.values()], edges: [...es.values()], truncated: more };
}
/** Shortest paths by read-only Cypher (the server has no find_paths): at most 6 hops, a few paths, 35 s (D14). */
export async function paths(from: string, to: string, maxHops = 6, k = 3, excludeDerived = false): Promise<KgGraph> {
  const [a, b] = [labelOf(from), labelOf(to)]; await validate([a, b], "label");
  const found = await call<Row>("get_nodes", { ids: [from, to], profile: "compact" });
  const have = new Map<string, Row>((found.nodes ?? []).map((r: Row) => [r.id, r]));
  if (!have.has(from) || !have.has(to)) throw new KgClientError("not_found", "Node not found");
  if (from === to) return { nodes: [node(have.get(from)!)], edges: [], truncated: false };
  const hops = clamp(maxHops, 6, 6), count = clamp(k, 3, 10); // hops is a checked integer: Cypher cannot take it as a parameter
  const data = await callTool<Row>("run_cypher", { query: `MATCH (a:\`${a}\` {id: $from}), (b:\`${b}\` {id: $to}) MATCH p = allShortestPaths((a)-[*..${hops}]-(b)) WHERE a <> b${excludeDerived ? " AND all(r IN relationships(p) WHERE coalesce(r.derived, false) = false)" : ""} RETURN [n IN nodes(p) | [n.id, labels(n)[0], coalesce(n.name, n.id)]] AS ns, [r IN relationships(p) | [type(r), startNode(r).id, endNode(r).id, coalesce(r.derived, false)]] AS rs LIMIT $limit`, params: { from, to, limit: count }, limit: count }, { graph: "new", timeoutMs: 35_000 });
  const ns = new Map<string, KgNode>(); const es = new Map<string, KgEdge>();
  for (const row of (data.rows ?? []) as Row[]) {
    for (const [id, type, name] of row.ns as unknown[][]) ns.set(String(id), node({ id, type, name }));
    for (const [type, source, target, derived] of row.rs as unknown[][]) { const e = edge(String(source), String(type), String(target), { derived }); es.set(e.id, e); }
  }
  return { nodes: [...ns.values()], edges: [...es.values()], truncated: false };
}

// ---------------------------------------------------------------- code (D15)

/** Source text of a node whose type has code. Read-only; `start` continues a long file where the last chunk stopped. */
export async function code(id: string, start?: number): Promise<KgCode> {
  const label = labelOf(id); await validate([label], "label");
  if (!(await overview()).labels.find(l => l.label === label)?.hasCode) throw new KgClientError("bad_request", "This node type has no code");
  const data = await call<Row>("read_code", { node_id: id, max_lines: 400, ...(start && start > 0 ? { start_line: Math.floor(start) } : {}) }, undefined, true);
  if (data.error) {
    const message = String(data.error);
    if (/^no node with id\b/i.test(message)) throw new KgClientError("not_found", "Node not found");
    if (/no file_path/i.test(message)) throw new KgClientError("bad_request", "This node has no code");
    if (/file not found|path escapes/i.test(message)) throw new KgClientError("not_found", "Source file not found");
    throw new KgClientError("kg_unavailable", "Knowledge graph tool failed");
  }
  const body = data.code ?? [data.header, data.items].filter(Boolean).join("\n\n");
  if (typeof data.path !== "string" || typeof body !== "string") throw new KgClientError("kg_unavailable", "Knowledge graph tool failed");
  const span = (data.method_lines ?? []) as number[];
  return {
    id, path: data.path, code: body,
    ...(data.start_line ?? span[0] ? { startLine: data.start_line ?? span[0] } : {}), ...(data.end_line ?? span[1] ? { endLine: data.end_line ?? span[1] } : {}),
    ...(data.total_lines ? { totalLines: data.total_lines } : {}), ...(data.outline || data.items ? { outline: true } : {}),
    nextStartLine: data.more_available ? data.next_start_line ?? null : null, ...(text(data.note) ? { note: data.note } : {}),
  };
}
