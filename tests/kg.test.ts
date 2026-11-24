import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool } from "@/lib/kg/client";
import { edges, expand, nodeDetail, nodes, overview } from "@/lib/kg/graph";

const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: result } }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("knowledge graph MCP", () => {
  it("parses SSE and JSON fallback", async () => {
    vi.stubEnv("KG_MCP_URL", "https://example.test");
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('event: message\ndata: {"result":{"structuredContent":{"a":1}}}\n\n')).mockResolvedValueOnce(new Response(JSON.stringify({ result: { content: [{ text: '{"b":2}' }] } })));
    vi.stubGlobal("fetch", fetcher);
    expect(await callTool("x")).toEqual({ a: 1 }); expect(await callTool("x")).toEqual({ b: 2 });
  });
  it("maps tool errors, timeouts and missing configuration", async () => {
    vi.stubEnv("KG_MCP_URL", ""); await expect(callTool("x")).rejects.toMatchObject({ code: "kg_unconfigured" });
    vi.stubEnv("KG_MCP_URL", "https://example.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"result":{"isError":true}}')));
    await expect(callTool("x")).rejects.toMatchObject({ code: "kg_unavailable" });
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))));
    await expect(callTool("x", {}, { timeoutMs: 1 })).rejects.toMatchObject({ code: "kg_timeout" });
  });
  it("normalizes hints, directions, allowlists and limits", async () => {
    vi.stubEnv("KG_MCP_URL", "https://example.test");
    const fetcher = vi.fn().mockImplementation(async (_url, init) => {
      const { name, arguments: args } = JSON.parse(init.body).params;
      if (name === "describe_graph") return reply({ labels: [{ label: "Form", layer: "bridge" }], relationships: [{ type: "HAS_STEP", from: "Form", to: "Form" }] });
      if (name === "run_cypher") {
        if (args.query.includes("count(*)")) return reply({ rows: [{ label: "Form", count: 2 }] });
        if (args.params.ids) return reply({ rows: [{ id: "a", label: "Form", name: "A" }] });
        return reply({ rows: [] });
      }
      if (name === "get_node") return reply({ node: { id: "a", kind: "Form", name: "A" }, hop_hints: { in: { HAS_STEP: { count: 2, labels: ["Form"] } } } });
      if (name === "expand") return reply({ from: ["a"], results: { a: { "HAS_STEP (in)": [{ id: "b", label: "Form", name: "B", edge: { order: 1 } }], "HAS_STEP (out)": [{ id: "c", label: "Form", name: "C" }] } }, truncated: true, next_cursor: "2" });
      throw Error(name);
    }); vi.stubGlobal("fetch", fetcher);
    expect((await overview()).totalNodes).toBe(2);
    expect((await nodeDetail("a")).hopHints).toEqual([{ type: "HAS_STEP", direction: "in", count: 2, neighbourLabels: ["Form"] }]);
    const g = await expand(["a"], ["HAS_STEP"], "both", [], 999);
    expect(g.nodes).toHaveLength(3); expect(g.edges).toEqual(expect.arrayContaining([expect.objectContaining({ source: "b", target: "a", props: { order: 1 } }), expect.objectContaining({ source: "a", target: "c" })])); expect(g.nextCursor).toBe("2");
    expect(JSON.parse(fetcher.mock.calls.find(c => JSON.parse(c[1].body).params.name === "expand")![1].body).params.arguments.limit).toBe(100);
    await nodes("Form", "", 0, 999); await edges("HAS_STEP", 999);
    const calls = fetcher.mock.calls.map(c => JSON.parse(c[1].body).params).filter(p => p.name === "run_cypher");
    expect(calls.some(p => p.arguments.params.limit === 201)).toBe(true); expect(calls.some(p => p.arguments.params.limit === 301)).toBe(true);
    await expect(nodes("Form`) MATCH (n)" )).rejects.toMatchObject({ code: "bad_request" });
    await expect(edges("BAD")).rejects.toMatchObject({ code: "bad_request" });
  });
});

// ---------------------------------------------------------------- SpectrumERP-new (graph=new)

vi.mock("@/lib/chat/http", () => ({ chatCaller: vi.fn() }));

const NEW_URL = "https://new.test/mcp-new", OLD_URL = "https://old.test/mcp";
const rpc = (result: unknown, headers: Record<string, string> = {}) => new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result })}\n\n`, { headers: { "content-type": "text/event-stream", ...headers } });
/** The new server returns tool results as JSON text in content[0].text, not structuredContent. */
const toolReply = (payload: unknown) => rpc({ content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: false });
const types = { cols: ["type", "prefix", "count", "with_code"], rows: [["Form", "F:", 10, 0], ["FormClass", "FORM:", 8, 8], ["Method", "M:", 50, 50], ["SP", "SP:", 20, 19], ["Table", "TB:", 5, 0], ["Widget", "WID:", 1, 0]] };
const patterns = { cols: ["src", "rel", "dst", "n", "derived"], rows: [["FormClass", "IMPLEMENTS_FORM", "Form", 8, 0], ["Form", "USES_SP", "SP", 12, 0], ["SP", "READS", "Table", 9, 0], ["FormClass", "READS", "Table", 3, 3], ["SP", "CALLS_SP", "SP", 4, 4]] };
const describe_ = (args: Record<string, unknown>) => args.section === "relationships" ? patterns : { model: "x", types, relationships: ["READS: SP->Table 9"], workflow: [] };

type Call = { name: string; args: Record<string, any> };
/** Mock SpectrumERP-new: initialize handshake + tools/call, recording what was sent. */
function newServer(handle: (name: string, args: Record<string, any>, n: number) => unknown, opts: { dropSessionOnce?: boolean } = {}) {
  const calls: Call[] = [], log: { method: string; url: string; headers: Record<string, string> }[] = [];
  let sessions = 0, dropped = false;
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)), headers = init.headers as Record<string, string>;
    log.push({ method: body.method, url, headers });
    if (body.method === "initialize") return rpc({ protocolVersion: "2025-06-18", capabilities: {} }, { "mcp-session-id": `session-${++sessions}` });
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (opts.dropSessionOnce && !dropped) { dropped = true; return new Response('{"error":{"message":"Missing session ID"}}', { status: 400 }); }
    calls.push({ name: body.params.name, args: body.params.arguments });
    const out = handle(body.params.name, body.params.arguments, calls.length);
    return out instanceof Response ? out : toolReply(out);
  });
  vi.stubGlobal("fetch", fetcher);
  return { calls, log, fetcher, cypher: () => calls.filter(c => c.name === "run_cypher") };
}
const standard = (name: string, args: Record<string, any>): unknown => name === "describe_graph" ? describe_(args) : { error: `unexpected ${name}` };
const load = async () => { vi.resetModules(); return { client: await import("@/lib/kg/client"), g: await import("@/lib/kg/graph-new"), http: await import("@/lib/kg/http"), old: await import("@/lib/kg/graph") }; };
const configure = () => { vi.stubEnv("KG_NEW_MCP_URL", NEW_URL); vi.stubEnv("KG_NEW_MCP_TOKEN_TECHNICAL", "technical-token"); vi.stubEnv("KG_NEW_MCP_TOKEN_FUNCTIONAL", "functional-token"); vi.stubEnv("KG_MCP_URL", OLD_URL); vi.stubEnv("KG_MCP_TOKEN", "old-token"); };

describe("SpectrumERP-new client", () => {
  it("opens an MCP session with the technical token, reuses it, and reopens it when the server drops it", async () => {
    configure(); const { client } = await load();
    const s = newServer((name) => ({ name }), { dropSessionOnce: true });
    expect(await client.callTool("search", {}, { graph: "new" })).toEqual({ name: "search" });
    expect(await client.callTool("expand", {}, { graph: "new" })).toEqual({ name: "expand" });
    expect(s.log.map(l => l.method)).toEqual(["initialize", "notifications/initialized", "tools/call", "initialize", "notifications/initialized", "tools/call", "tools/call"]);
    expect(s.log.every(l => l.url === NEW_URL && l.headers.Authorization === "Bearer technical-token")).toBe(true);
    expect(s.log[2].headers["Mcp-Session-Id"]).toBe("session-1"); expect(s.log[5].headers["Mcp-Session-Id"]).toBe("session-2"); expect(s.log[6].headers["Mcp-Session-Id"]).toBe("session-2");
  });
  it("gives concurrent calls on one session distinct JSON-RPC ids", async () => {
    configure(); const { client } = await load();
    const ids: number[] = []; vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.method === "initialize") return rpc({ capabilities: {} }, { "mcp-session-id": "s" });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      ids.push(body.id); return toolReply({ ok: true });
    }));
    await Promise.all([client.callTool("search", {}, { graph: "new" }), client.callTool("expand", {}, { graph: "new" }), client.callTool("run_cypher", {}, { graph: "new" })]);
    expect(new Set(ids).size).toBe(3);
  });
  it("keeps the old server on a bare tools/call with its own token", async () => {
    configure(); const { client } = await load();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: { structuredContent: { ok: 1 } } }))); vi.stubGlobal("fetch", fetcher);
    expect(await client.callTool("describe_graph")).toEqual({ ok: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe(OLD_URL);
    expect(fetcher.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer old-token" }); expect(JSON.parse(fetcher.mock.calls[0][1].body).method).toBe("tools/call");
  });
  it("maps 401, 403, timeouts, unconfigured and not-found; never sends log_qa or write-capable tools", async () => {
    const { client } = await load();
    vi.stubEnv("KG_NEW_MCP_URL", ""); await expect(client.callTool("search", {}, { graph: "new" })).rejects.toMatchObject({ code: "kg_unconfigured" });
    configure(); vi.stubEnv("KG_NEW_MCP_TOKEN_TECHNICAL", ""); await expect(client.callTool("search", {}, { graph: "new" })).rejects.toMatchObject({ code: "kg_unconfigured" });
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(client.callTool("search", {}, { graph: "new" })).rejects.toMatchObject({ code: "unauthorized" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 403 })));
    await expect(client.callTool("search", {}, { graph: "new" })).rejects.toMatchObject({ code: "forbidden" });
    newServer(() => new Response("{}", { status: 403 })); await expect(client.callTool("search", {}, { graph: "new" })).rejects.toMatchObject({ code: "forbidden" });
    newServer(() => ({ error: "No node with id 'SP:x'. Use search() to find a valid id.", did_you_mean: [] })); await expect(client.callTool("get_nodes", {}, { graph: "new" })).rejects.toMatchObject({ code: "not_found" });
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, init) => new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))));
    await expect(client.callTool("search", {}, { graph: "new", timeoutMs: 1 })).rejects.toMatchObject({ code: "kg_timeout" });
    const s = newServer(() => ({}));
    await expect(client.callTool("log_qa", { question: "q", answer: "a" }, { graph: "new" })).rejects.toMatchObject({ code: "bad_request" });
    await expect(client.callTool("log_qa", {})).rejects.toMatchObject({ code: "bad_request" });
    await expect(client.callTool("get_node", {}, { graph: "new" })).rejects.toMatchObject({ code: "bad_request" });
    expect(s.fetcher).not.toHaveBeenCalled();
  });
});

describe("SpectrumERP-new overview", () => {
  it("builds layers and types from describe_graph; unmapped types go to Other", async () => {
    configure(); const { g } = await load(); const s = newServer(standard);
    const o = await g.overview();
    expect(o.layers.map(l => l.name)).toEqual(["Menu", "Screens", "Application code", "Database logic", "Data", "Lookups", "Other"]);
    const layer = (label: string) => o.labels.find(l => l.label === label)?.layer;
    expect([layer("Form"), layer("FormClass"), layer("Method"), layer("SP"), layer("Table"), layer("Widget")]).toEqual(["menu", "screens", "app", "database", "data", "other"]);
    expect(o.labels.filter(l => l.hasCode).map(l => l.label)).toEqual(["FormClass", "Method", "SP"]);
    expect(o.totalNodes).toBe(94);
    // one entry per (relationship, from, to) pattern; derived when every edge of the pattern is a shortcut
    expect(o.relationships).toEqual(expect.arrayContaining([expect.objectContaining({ type: "READS", from: ["SP"], to: ["Table"], count: 9, derived: false }), expect.objectContaining({ type: "READS", from: ["FormClass"], to: ["Table"], derived: true })]));
    await g.overview(); expect(s.calls.filter(c => c.name === "describe_graph")).toHaveLength(2); // cached: no second round
  });
  it("falls back to read-only Cypher when the server has describe_graph switched off", async () => {
    configure(); const { g } = await load();
    const s = newServer((name, args) => {
      if (name === "describe_graph") return rpc({ content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true });
      return args.query.includes("collect(") ? { rows: [{ patterns: [["SP", "READS", "Table", 9, 0], ["SP", "CALLS_SP", "SP", 4, 4]] }] } : { rows: [{ type: "SP", count: 20, with_code: 19 }, { type: "Table", count: 5, with_code: 0 }, { type: "Widget", count: 1, with_code: 0 }] };
    });
    const o = await g.overview();
    expect(o.labels.map(l => [l.label, l.layer, Boolean(l.hasCode)])).toEqual([["SP", "database", true], ["Table", "data", false], ["Widget", "other", false]]);
    expect(o.relationships.map(r => [r.type, r.count, r.derived])).toEqual([["READS", 9, false], ["CALLS_SP", 4, true]]);
    expect(s.cypher()).toHaveLength(2); expect(s.cypher().every(c => /^MATCH \(\w\)/.test(c.args.query) && !/\b(CREATE|MERGE|DELETE|SET|REMOVE)\b/.test(c.args.query))).toBe(true);
  });
});

describe("SpectrumERP-new adapter", () => {
  it("normalises search hits and validates types before calling the server", async () => {
    configure(); const { g } = await load();
    const s = newServer((name, args) => name === "search" ? { hits: { cols: ["id", "name", "type", "module", "purpose", "why"], rows: [["F:IGRN", "Material Receipt Note", "Form", "Inventory", "Record receipts.", "name+semantic 0.81"], ["SP:a.b", "a.b", "SP", null, null, "exact"]] } } : standard(name, args));
    expect((await g.search("grn", ["Form", "SP"], 999)).hits).toEqual([{ id: "F:IGRN", label: "Form", name: "Material Receipt Note", summary: "Record receipts.", score: 0.81 }, { id: "SP:a.b", label: "SP", name: "a.b" }]);
    expect(s.calls.find(c => c.name === "search")!.args).toMatchObject({ query: "grn", types: ["Form", "SP"], limit: 30 });
    const before = s.calls.length;
    await expect(g.search("grn", ["Bogus"])).rejects.toMatchObject({ code: "bad_request" });
    expect(s.calls.slice(before).some(c => c.name === "search")).toBe(false);
  });
  it("reads node pages by label with parameters, and rejects unknown or malformed labels before any Cypher", async () => {
    configure(); const { g } = await load();
    const s = newServer((name, args) => name === "run_cypher" ? { rows: [{ id: "F:A", name: "A", summary: "x" }, { id: "F:B", name: "B", summary: "" }, { id: "F:C", name: "C", summary: "" }] } : standard(name, args));
    const page = await g.nodes("Form", "rec'eipt", 5, 2);
    expect(page).toEqual({ nodes: [{ id: "F:A", label: "Form", name: "A", summary: "x" }, { id: "F:B", label: "Form", name: "B" }], hasMore: true });
    const q = s.cypher()[0]; expect(q.args.query).toContain("(n:`Form`)"); expect(q.args.query).not.toContain("rec'eipt"); expect(q.args.params).toMatchObject({ q: "rec'eipt", skip: 5, limit: 3 });
    const before = s.cypher().length;
    for (const bad of ["Form`) MATCH (n) DETACH DELETE n //", "Bogus", "form", "Form Class", ""]) await expect(g.nodes(bad)).rejects.toMatchObject({ code: "bad_request" });
    for (const bad of ["BAD", "READS`]-() DELETE", "reads"]) await expect(g.edges(bad)).rejects.toMatchObject({ code: "bad_request" });
    await expect(g.expand(["F:A"], ["NOPE"])).rejects.toMatchObject({ code: "bad_request" });
    await expect(g.expand(["F:A"], [], "both", ["Bogus"])).rejects.toMatchObject({ code: "bad_request" });
    expect(s.cypher()).toHaveLength(before); expect(s.calls.some(c => c.name === "expand")).toBe(false);
  });
  it("combines get_nodes with the neighbour summary into hop hints; unknown ids are not_found", async () => {
    configure(); const { g } = await load();
    newServer((name, args) => {
      if (name === "get_nodes") return args.ids[0] === "SP:gone" ? { error: "No node with id 'SP:gone'. Use search() to find a valid id.", did_you_mean: [] } : { nodes: [{ id: "SP:a.b", name: "a.b", type: "SP", purpose: "Does a thing.", line: 1, links: { out: { READS: 6 } }, hop_hints: ["expand(...)"] }] };
      if (name === "expand") return { from: "SP:a.b", total: 8, summary: { cols: ["rel", "dir", "neighbor_type", "n"], rows: [["READS", "out", "Table", 5], ["READS", "out", "View", 1], ["CALLS_SP", "in", "SP", 2]] } };
      return standard(name, args);
    });
    const d = await g.nodeDetail("SP:a.b");
    expect(d.node).toMatchObject({ id: "SP:a.b", label: "SP", name: "a.b", summary: "Does a thing." }); expect(Object.keys(d.node.props)).toEqual(["id", "name", "type", "purpose", "line"]);
    expect(d.hopHints).toEqual([{ type: "READS", direction: "out", count: 6, neighbourLabels: ["Table", "View"] }, { type: "CALLS_SP", direction: "in", count: 2, neighbourLabels: ["SP"] }]);
    await expect(g.nodeDetail("SP:gone")).rejects.toMatchObject({ code: "not_found" });
  });
  it("expands with directions, edge properties, paging cursor and clamped limit", async () => {
    configure(); const { g } = await load();
    const s = newServer((name, args) => {
      if (name === "get_nodes") return { nodes: [{ id: "F:IGRN", name: "GRN", type: "Form" }] };
      if (name === "expand") return { from: "F:IGRN", groups: [{ rel: "USES_SP", dir: "out", neighbors: { cols: ["id", "name", "type", "purpose", "count", "derived"], rows: [["SP:a", "a", "SP", "Does a.", 3, true]] } }, { rel: "IMPLEMENTS_FORM", dir: "in", neighbors: { cols: ["id", "name", "type", "purpose"], rows: [["FORM:x", "x", "FormClass", null]] } }], next_skip: 25, truncated: false };
      return standard(name, args);
    });
    const r = await g.expand(["F:IGRN"], ["USES_SP", "IMPLEMENTS_FORM"], "both", ["SP", "FormClass"], 999, "50");
    expect(r.nodes.map(n => [n.id, n.label])).toEqual([["F:IGRN", "Form"], ["SP:a", "SP"], ["FORM:x", "FormClass"]]);
    expect(r.edges).toEqual([expect.objectContaining({ source: "F:IGRN", type: "USES_SP", target: "SP:a", props: { count: 3, derived: true }, derived: true }), expect.objectContaining({ source: "FORM:x", type: "IMPLEMENTS_FORM", target: "F:IGRN" })]);
    expect(r.truncated).toBe(true); expect(r.nextCursor).toBe("25");
    expect(s.calls.find(c => c.name === "expand")!.args).toMatchObject({ ids: ["F:IGRN"], direction: "both", rel_types: ["USES_SP", "IMPLEMENTS_FORM"], target_types: ["SP", "FormClass"], limit: 100, skip: 50, profile: "compact" });
    await expect(g.expand(Array.from({ length: 26 }, (_, i) => `F:${i}`))).rejects.toMatchObject({ code: "bad_request" });
  });
  it("samples edges by relationship type; pages past the server's reply cap and drops evidence text", async () => {
    configure(); const { g } = await load();
    const row = (i: number) => ({ e: [`SP:${i}`, "SP", `s${i}`, `TB:${i}`, "Table", `t${i}`, [["op", "SELECT"], ["confidence", "static"]]] });
    const s = newServer((name, args, n) => name === "run_cypher" ? (args.params.skip === 0 ? { rows: [row(0), row(1)], truncated: true } : { rows: [row(2), row(3)], truncated: false }) : standard(name, args));
    const r = await g.edges("READS", 3, 0);
    expect(r.edges).toHaveLength(3); expect(r.truncated).toBe(true); expect(r.nodes).toHaveLength(6);
    expect(r.edges[0]).toMatchObject({ source: "SP:0", type: "READS", target: "TB:0", props: { op: "SELECT", confidence: "static" } });
    const [first, second] = s.cypher(); expect(first.args.params).toMatchObject({ skip: 0, limit: 4 }); expect(second.args.params).toMatchObject({ skip: 2, limit: 2 });
    expect(first.args.query).toContain("-[r:`READS`]->"); expect(first.args.query).toContain("k <> 'evidence'");
  });
  it("finds shortest paths with read-only Cypher: 6 hops max, params for ids, derived filter", async () => {
    configure(); const { g } = await load();
    const s = newServer((name, args) => {
      if (name === "get_nodes") return { nodes: args.ids.filter((i: string) => i !== "TB:gone").map((id: string) => ({ id, name: id, type: id.split(":")[0] === "TB" ? "Table" : "Form" })) };
      if (name === "run_cypher") return { rows: [{ ns: [["F:a", "Form", "A"], ["SP:m", "SP", "M"], ["TB:b", "Table", "B"]], rs: [["USES_SP", "F:a", "SP:m", false], ["READS", "TB:b", "SP:m", true]] }] };
      return standard(name, args);
    });
    const r = await g.paths("F:a", "TB:b", 99, 99, true);
    expect(r.nodes.map(n => n.id)).toEqual(["F:a", "SP:m", "TB:b"]);
    expect(r.edges).toEqual([expect.objectContaining({ source: "F:a", type: "USES_SP", target: "SP:m" }), expect.objectContaining({ source: "TB:b", type: "READS", target: "SP:m", derived: true })]);
    const q = s.cypher()[0]; expect(q.args.query).toContain("allShortestPaths((a)-[*..6]-(b))"); expect(q.args.query).toContain("coalesce(r.derived, false) = false"); expect(q.args.query).toContain("(a:`Form` {id: $from})");
    expect(q.args.params).toEqual({ from: "F:a", to: "TB:b", limit: 10 }); expect(q.args.limit).toBe(10);
    await expect(g.paths("F:a", "TB:gone")).rejects.toMatchObject({ code: "not_found" });
    await expect(g.paths("F:a", "ZZ:unknown")).rejects.toMatchObject({ code: "not_found" });
    expect(s.cypher()).toHaveLength(1);
    expect((await g.paths("F:a", "F:a")).edges).toEqual([]); // same node: nothing to search
  });
  it("uses a 35 s budget for paths", async () => {
    configure(); const { g } = await load(); const timers = vi.spyOn(globalThis, "setTimeout");
    newServer((name, args) => name === "get_nodes" ? { nodes: args.ids.map((id: string) => ({ id, name: id, type: "Form" })) } : name === "run_cypher" ? { rows: [] } : standard(name, args));
    await g.paths("F:a", "F:b"); expect(timers.mock.calls.some(c => c[1] === 35_000)).toBe(true); timers.mockRestore();
  });
  it("reads code through read_code and normalises chunks, outlines and errors", async () => {
    configure(); const { g } = await load();
    const s = newServer((name, args) => {
      if (name !== "read_code") return standard(name, args);
      if (args.node_id === "SP:a.b") return { path: "DatabaseObjects/a.b.sql", start_line: args.start_line ?? 1, end_line: 400, total_lines: 900, more_available: true, next_start_line: 401, code: "    1| CREATE PROCEDURE a.b" };
      if (args.node_id === "FORM:big") return { path: "x/fBig.vb", items: "   12  Sub Save()", header: "Header", note: "file has 900 lines: outline shown instead of the whole file", outline: true };
      if (args.node_id === "M:m") return { path: "x/y.vb", method: "m", method_lines: [10, 20], code: "   10| Sub m()" };
      if (args.node_id === "M:nofile") return { error: "this node has no file_path", linked_nodes_with_code: [] };
      if (args.node_id === "M:lost") return { error: "file not found under code root: x/y.vb", code_root: "/srv/codebase" };
      return { error: `No node with id '${args.node_id}'. Use search() to find a valid id.` };
    });
    expect(await g.code("SP:a.b")).toEqual({ id: "SP:a.b", path: "DatabaseObjects/a.b.sql", startLine: 1, endLine: 400, totalLines: 900, code: "    1| CREATE PROCEDURE a.b", nextStartLine: 401 });
    expect(await g.code("SP:a.b", 401)).toMatchObject({ startLine: 401 }); expect(s.calls.filter(c => c.name === "read_code").pop()!.args).toMatchObject({ node_id: "SP:a.b", start_line: 401, max_lines: 400 });
    expect(await g.code("FORM:big")).toMatchObject({ outline: true, code: "Header\n\n   12  Sub Save()", note: expect.stringContaining("outline"), nextStartLine: null });
    expect(await g.code("M:m")).toMatchObject({ startLine: 10, endLine: 20 });
    await expect(g.code("M:nofile")).rejects.toMatchObject({ code: "bad_request" });
    const lost = await g.code("M:lost").catch(e => e); expect(lost).toMatchObject({ code: "not_found" }); expect(String(lost.message)).not.toContain("/srv");
    await expect(g.code("M:ghost")).rejects.toMatchObject({ code: "not_found" });
    const before = s.calls.length;
    await expect(g.code("F:IGRN")).rejects.toMatchObject({ code: "bad_request" });  // Form holds no code
    await expect(g.code("TB:t")).rejects.toMatchObject({ code: "bad_request" });
    await expect(g.code("ZZ:nope")).rejects.toMatchObject({ code: "not_found" });
    expect(s.calls.slice(before).some(c => c.name === "read_code")).toBe(false);
  });
});

describe("graph parameter routing", () => {
  const request = (path: string) => new Request(`https://app.test/api/admin/graph/${path}`);
  const asAdmin = async (isAdmin = true) => { const { chatCaller } = await import("@/lib/chat/http"); vi.mocked(chatCaller).mockResolvedValue({ isAdmin } as never); };
  const oldFetch = () => vi.fn().mockImplementation(async (_url, init) => { const { name } = JSON.parse(init.body).params; return reply(name === "describe_graph" ? { labels: [{ label: "Form", layer: "bridge" }], relationships: [] } : { rows: [{ label: "Form", count: 2 }] }); });

  it("sends graph=new to SpectrumERP-new and everything else to the old graph", async () => {
    configure(); const { http } = await load(); await asAdmin();
    const s = newServer(standard);
    const fresh = await (await http.graphRoute(request("overview?graph=new"), "overview")).json();
    expect(fresh.layers.map((l: { id: string }) => l.id)).toContain("menu"); expect(s.log.every(l => l.url === NEW_URL)).toBe(true);
    const old = oldFetch(); vi.stubGlobal("fetch", old);
    for (const q of ["overview", "overview?graph=old", "overview?graph=bogus"]) {
      const body = await (await http.graphRoute(request(q), "overview")).json();
      expect(body.layers.map((l: { id: string }) => l.id)).toEqual(["functional", "bridge", "code", "data", "other"]); expect(body.labels).toEqual([expect.objectContaining({ label: "Form", count: 2, layer: "bridge" })]);
    }
    expect(old.mock.calls.every(c => c[0] === OLD_URL)).toBe(true);
  });
  it("serves /code for graph=new only, admins only, and reports unconfigured / upstream failures as 503 / 502", async () => {
    configure(); const { http } = await load(); await asAdmin();
    newServer((name, args) => name === "read_code" ? { path: "a.sql", start_line: 1, end_line: 2, code: "    1| SELECT 1", more_available: false } : standard(name, args));
    const ok = await http.graphRoute(request("code?graph=new&id=SP%3Aa.b"), "code");
    expect(ok.status).toBe(200); expect(await ok.json()).toMatchObject({ id: "SP:a.b", path: "a.sql", code: "    1| SELECT 1" });
    expect((await http.graphRoute(request("code?id=SP%3Aa.b"), "code")).status).toBe(400); // old graph has no code
    expect((await http.graphRoute(request("code?graph=new"), "code")).status).toBe(400);
    expect((await http.graphRoute(request("code?graph=new&id=SP%3Aa.b&start=0"), "code")).status).toBe(400);
    await asAdmin(false); expect((await http.graphRoute(request("overview?graph=new"), "overview")).status).toBe(403); await asAdmin();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    const down = await http.graphRoute(request("node?graph=new&id=SP%3Aa.b"), "node"); expect(down.status).toBe(502); expect(await down.json()).toMatchObject({ code: "unauthorized" });
    vi.stubEnv("KG_NEW_MCP_URL", ""); const off = await http.graphRoute(request("overview?graph=new"), "overview"); expect(off.status).toBe(503); expect(await off.json()).toMatchObject({ code: "kg_unconfigured" });
    vi.stubGlobal("fetch", oldFetch()); expect((await http.graphRoute(request("overview"), "overview")).status).toBe(200); // old graph unaffected
  });
});
