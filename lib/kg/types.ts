/**
 * Shared contract between the knowledge-graph backend (lib/kg/*, app/api/admin/graph/*) and the admin
 * graph explorer UI (app/admin/graph, components/admin/graph/*).
 *
 * The app never talks to Neo4j directly: every read goes through the spectrum-kg MCP server
 * (KG_MCP_URL / KG_MCP_TOKEN, streamable HTTP, tools describe_graph, search, get_node, expand, find_paths,
 * run_cypher). The backend normalises those tool results into the shapes below.
 *
 * All endpoints are GET, admin only, JSON, under /api/admin/graph:
 *
 *   GET /overview                                  -> KgOverview           (cached ~5 min server side)
 *   GET /search?q=&label=A&label=B&limit=20        -> { hits: KgNode[] }    (hybrid search, entry points)
 *   GET /nodes?label=Form&q=&skip=0&limit=50       -> KgNodePage            (browse one label, optional name filter)
 *   GET /node?id=form:fGRN                         -> KgNodeDetail          (all properties + hop hints)
 *   GET /expand?id=a&id=b&rel=X&rel=Y&dir=both&label=L&limit=25&cursor=
 *                                                   -> KgGraph              (one hop; seeds included in nodes)
 *   GET /edges?type=HAS_STEP&limit=50&skip=0       -> KgGraph              (sample links of one relationship type)
 *   GET /paths?from=a&to=b&maxHops=6&k=3&excludeDerived=1
 *                                                   -> KgGraph              (shortest paths, merged)
 *
 * Errors: non-2xx with body KgError. 400 bad_request, 401/403 auth, 404 not_found,
 * 503 kg_unconfigured (no KG_MCP_URL), 502 kg_unavailable (MCP/Neo4j down or tool error), 504 kg_timeout.
 */

/** A graph node. `label` is the Neo4j label (= `kind` property), e.g. "Form", "StoredProcedure". */
export interface KgNode {
  id: string;
  label: string;
  /** Display name: name, else title, else id. */
  name: string;
  summary?: string | null;
  /** Present on /node (full properties); may be partial or absent elsewhere. */
  props?: Record<string, unknown>;
  /** Search relevance, only on /search hits. */
  score?: number;
}

/** A directed relationship. `id` is stable for the same (source, type, target) so the UI can de-duplicate merges. */
export interface KgEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  /** Edge properties, e.g. ops, order, tables, write_conflict. */
  props?: Record<string, unknown>;
  /** Derived shortcut edge (CALLS_SP, USES_TABLE, SHARES_TABLE, PERSISTED_IN). */
  derived?: boolean;
}

export interface KgGraph {
  nodes: KgNode[];
  edges: KgEdge[];
  /** More results exist than were returned. */
  truncated: boolean;
  /** Pass back as `cursor` (expand) to page further; null when there is nothing more. */
  nextCursor?: string | null;
}

export type KgLayer = "functional" | "bridge" | "code" | "data" | "other";

export interface KgLabelInfo {
  label: string;
  count: number;
  layer: KgLayer;
  /** What the label means (from describe_graph). */
  means?: string;
  /** Comma separated key properties. */
  keyProps?: string;
}

export interface KgRelInfo {
  type: string;
  /** Allowed source / target labels. */
  from: string[];
  to: string[];
  means?: string;
  derived?: boolean;
  count?: number;
}

export interface KgOverview {
  labels: KgLabelInfo[];
  relationships: KgRelInfo[];
  totalNodes: number;
  /** ISO time the overview was fetched from the MCP server. */
  fetchedAt: string;
}

export interface KgNodePage {
  nodes: KgNode[];
  /** Total nodes of the label matching the filter, when cheaply known. */
  total?: number;
  hasMore: boolean;
}

/** One relationship group available from a node: what expand(rel=type, dir=direction) would return. */
export interface KgHopHint {
  type: string;
  direction: "out" | "in";
  count: number;
  neighbourLabels: string[];
}

export interface KgNodeDetail {
  /** `props` is always present here: every property, long code fields cut by the server. */
  node: KgNode & { props: Record<string, unknown> };
  hopHints: KgHopHint[];
}

export type KgErrorCode = "bad_request" | "not_found" | "kg_unconfigured" | "kg_unavailable" | "kg_timeout" | "forbidden" | "unauthorized";

export interface KgError {
  error: string;
  code: KgErrorCode;
}
