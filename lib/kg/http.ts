import { chatCaller } from "@/lib/chat/http";
import { json } from "@/lib/request";
import { KgClientError, kgGraphName } from "./client";
import * as oldGraph from "./graph";
import * as newGraph from "./graph-new";

type Endpoint = "overview" | "search" | "nodes" | "node" | "expand" | "edges" | "paths" | "code";
const bad = (message: string): never => { throw new KgClientError("bad_request", message); };
const required = (p: URLSearchParams, key: string) => p.get(key)?.trim() || bad(`Missing ${key}`);
const integer = (p: URLSearchParams, key: string, fallback: number, min = 1) => {
  const raw = p.get(key); if (raw === null) return fallback;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min) return bad(`Invalid ${key}`);
  return Number(raw);
};
const list = (p: URLSearchParams, key: string) => { const values = p.getAll(key); if (values.some(v => !v.trim()) || values.length > 100) return bad(`Invalid ${key}`); return values; };

export async function graphRoute(req: Request, endpoint: Endpoint): Promise<Response> {
  const caller = await chatCaller(req, { mutating: false });
  if (caller instanceof Response) return caller;
  if (!caller.isAdmin) return json({ error: "Forbidden", code: "forbidden" }, 403);
  try {
    const p = new URL(req.url).searchParams;
    // `graph=new` reads SpectrumERP-new; anything else or nothing reads the old graph (D12).
    const isNew = kgGraphName(p.get("graph")) === "new", graph = isNew ? newGraph : oldGraph;
    let result: unknown;
    switch (endpoint) {
      case "overview": result = await graph.overview(); break;
      case "search": result = await graph.search(required(p, "q"), list(p, "label"), integer(p, "limit", 20)); break;
      case "nodes": result = await graph.nodes(required(p, "label"), p.get("q") ?? "", integer(p, "skip", 0, 0), integer(p, "limit", 50)); break;
      case "node": result = await graph.nodeDetail(required(p, "id")); break;
      case "expand": {
        const ids = list(p, "id"); if (!ids.length) bad("Missing id");
        const direction = p.get("dir") ?? "both"; if (direction !== "in" && direction !== "out" && direction !== "both") return bad("Invalid dir");
        const cursor = p.get("cursor") ?? undefined; if (cursor && !/^\d+$/.test(cursor)) bad("Invalid cursor");
        result = await graph.expand(ids, list(p, "rel"), direction, list(p, "label"), integer(p, "limit", 25), cursor); break;
      }
      case "edges": result = await graph.edges(required(p, "type"), integer(p, "limit", 50), integer(p, "skip", 0, 0)); break;
      case "paths": {
        const exclude = p.get("excludeDerived") ?? "0"; if (exclude !== "0" && exclude !== "1") bad("Invalid excludeDerived");
        result = await graph.paths(required(p, "from"), required(p, "to"), integer(p, "maxHops", 6), integer(p, "k", 3), exclude === "1"); break;
      }
      case "code": if (!isNew) bad("Code is only available for graph=new"); result = await newGraph.code(required(p, "id"), p.has("start") ? integer(p, "start", 1) : undefined); break;
    }
    return json(result);
  } catch (error) {
    const e = error instanceof KgClientError ? error : new KgClientError("kg_unavailable", "Knowledge graph unavailable");
    const status = { bad_request: 400, not_found: 404, kg_unconfigured: 503, kg_unavailable: 502, kg_timeout: 504, forbidden: 502, unauthorized: 502 }[e.code];
    return json({ error: e.message, code: e.code }, status);
  }
}
