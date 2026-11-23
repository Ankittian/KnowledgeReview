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
