import { chatConfig } from "@/lib/chat/config";
import type { KgErrorCode, KgGraphName } from "./types";

export class KgClientError extends Error {
  /** The server does not expose this tool (e.g. describe_graph is switched off on SpectrumERP-new). */
  missingTool = false;
  constructor(public code: KgErrorCode, message: string) { super(message); }
}

/** Which MCP server a call goes to: "old" = spectrum-kg, "new" = SpectrumERP-new (technical token), or an explicit target. */
export interface KgTarget { url: string; token: string; /** Open an MCP session (initialize) before tools/call. The new server requires it. */ handshake?: boolean }
export const kgGraphName = (value: string | null | undefined): KgGraphName => (value === "new" ? "new" : "old");

/** Server-side only: reads the MCP credentials. Null when the graph is not configured. */
export function kgTarget(graph: KgGraphName | KgTarget = "old"): KgTarget | null {
  if (typeof graph === "object") return graph.url ? graph : null;
  const cfg = chatConfig();
  if (graph === "new") return cfg.kgNewMcpUrl && cfg.kgNewMcpTokenTechnical ? { url: cfg.kgNewMcpUrl, token: cfg.kgNewMcpTokenTechnical, handshake: true } : null;
  return cfg.kgMcpUrl ? { url: cfg.kgMcpUrl, token: cfg.kgMcpToken } : null;
}

export const kgConfigured = (graph: KgGraphName = "old") => kgTarget(graph) !== null;

// Read-only tools the explorer may call on the new server. log_qa writes the server's activity log: never sent.
const NEW_TOOLS = new Set(["describe_graph", "search", "get_nodes", "expand", "run_cypher", "read_code"]);
const SESSION_TTL_MS = 600_000;
// JSON-RPC ids must be unique within a session: two concurrent calls sharing an id make the server drop one reply.
let nextRequestId = 100;
const sessions = new Map<string, { id: Promise<string>; until: number }>();
const sessionKey = (t: KgTarget) => `${t.url}\n${t.token}`;
const HEADERS = (t: KgTarget, session?: string) => ({ Authorization: `Bearer ${t.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(session ? { "Mcp-Session-Id": session } : {}) });
const reject = (status: number): never => {
  if (status === 401) throw new KgClientError("unauthorized", "Knowledge graph rejected the credentials");
  if (status === 403) throw new KgClientError("forbidden", "Knowledge graph refused the request");
  throw new KgClientError("kg_unavailable", "Knowledge graph request failed");
};

/** One MCP session per server+token, shared by concurrent calls; reopened when the server forgets it. */
function openSession(target: KgTarget, signal: AbortSignal, fresh: boolean): Promise<string> {
  const key = sessionKey(target), known = sessions.get(key);
  if (!fresh && known && known.until > Date.now()) return known.id;
  const id = (async () => {
    const init = await fetch(target.url, { method: "POST", headers: HEADERS(target), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "knowledge-review-graph-explorer", version: "1" } } }), signal, cache: "no-store" });
    if (!init.ok) reject(init.status);
    const session = init.headers.get("mcp-session-id");
    await init.text().catch(() => "");
    if (!session) throw new KgClientError("kg_unavailable", "Knowledge graph request failed");
    const ack = await fetch(target.url, { method: "POST", headers: HEADERS(target, session), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), signal, cache: "no-store" });
    if (!ack.ok) reject(ack.status);
    await ack.text().catch(() => "");
    return session;
  })();
  sessions.set(key, { id, until: Date.now() + SESSION_TTL_MS });
  id.catch(() => { if (sessions.get(key)?.id === id) sessions.delete(key); });
  return id;
}

/**
 * Call one MCP tool and return its JSON result. `options.graph` picks the server (default old); `options.raw` returns a
 * tool's own `{ error }` payload instead of throwing, so the caller can read it (read_code does).
 * Server-side only: this module reads the MCP credentials and must not be imported by client components.
 */
export async function callTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}, options: { timeoutMs?: number; graph?: KgGraphName | KgTarget; raw?: boolean } = {}): Promise<T> {
  if (name === "log_qa") throw new KgClientError("bad_request", "log_qa is not available to the explorer");
  const target = kgTarget(options.graph ?? "old");
  if (!target) throw new KgClientError("kg_unconfigured", "Knowledge graph is not configured");
  if (target.handshake && !NEW_TOOLS.has(name)) throw new KgClientError("bad_request", "Tool not allowed");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  const post = async (session?: string) => fetch(target.url, { method: "POST", headers: HEADERS(target, session), body: JSON.stringify({ jsonrpc: "2.0", id: ++nextRequestId, method: "tools/call", params: { name, arguments: args } }), signal: controller.signal, cache: "no-store" });
  try {
    let session = target.handshake ? await openSession(target, controller.signal, false) : undefined;
    let response = await post(session);
    // The server dropped the session (restart, expiry): open a new one and retry once.
    if (target.handshake && (response.status === 400 || response.status === 404)) { await response.text().catch(() => ""); session = await openSession(target, controller.signal, true); response = await post(session); }
    if (!response.ok) reject(response.status);
    const body = await response.text();
    const data = body.trimStart().startsWith("{") ? body : body.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n")).find(Boolean);
    if (!data) throw new Error("Missing MCP response");
    const envelope = JSON.parse(data);
    if (envelope.error || !envelope.result || envelope.result.isError) {
      const e = new KgClientError("kg_unavailable", "Knowledge graph tool failed");
      e.missingTool = /^unknown tool\b/i.test(String(envelope.result?.content?.[0]?.text ?? ""));
      throw e;
    }
    const value = envelope.result.structuredContent ?? JSON.parse(envelope.result.content?.[0]?.text ?? "null");
    if (!value || typeof value !== "object") throw new Error("Invalid MCP response");
    if (value.error && !options.raw) {
      const text = String(value.error);
      if ((name === "get_node" && /^no node\b/i.test(text)) || (name === "find_paths" && /^unknown node\b/i.test(text)) || /^no node with id\b/i.test(text)) throw new KgClientError("not_found", "Node not found");
      throw new KgClientError("kg_unavailable", "Knowledge graph tool failed");
    }
    return value as T;
  } catch (error) {
    if (controller.signal.aborted) throw new KgClientError("kg_timeout", "Knowledge graph request timed out");
    if (error instanceof KgClientError) throw error;
    throw new KgClientError("kg_unavailable", "Knowledge graph unavailable");
  } finally { clearTimeout(timer); }
}
