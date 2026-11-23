import { chatConfig } from "@/lib/chat/config";
import type { KgErrorCode } from "./types";

export class KgClientError extends Error {
  constructor(public code: KgErrorCode, message: string) { super(message); }
}

/** Server-side only: this module reads the MCP credential and must not be imported by client components. */
export async function callTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}, options: { timeoutMs?: number } = {}): Promise<T> {
  const { kgMcpUrl, kgMcpToken } = chatConfig();
  if (!kgMcpUrl) throw new KgClientError("kg_unconfigured", "Knowledge graph is not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const response = await fetch(kgMcpUrl, { method: "POST", headers: { Authorization: `Bearer ${kgMcpToken}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new KgClientError("kg_unavailable", "Knowledge graph request failed");
    const body = await response.text();
    const data = body.trimStart().startsWith("{") ? body : body.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n")).find(Boolean);
    if (!data) throw new Error("Missing MCP response");
    const envelope = JSON.parse(data);
    if (envelope.error || !envelope.result || envelope.result.isError) throw new KgClientError("kg_unavailable", "Knowledge graph tool failed");
    const value = envelope.result.structuredContent ?? JSON.parse(envelope.result.content?.[0]?.text ?? "null");
    if (!value || typeof value !== "object") throw new Error("Invalid MCP response");
    if (value.error) {
      if ((name === "get_node" && /^no node\b/i.test(String(value.error))) || (name === "find_paths" && /^unknown node\b/i.test(String(value.error)))) throw new KgClientError("not_found", "Node not found");
      throw new KgClientError("kg_unavailable", "Knowledge graph tool failed");
    }
    return value as T;
  } catch (error) {
    if (controller.signal.aborted) throw new KgClientError("kg_timeout", "Knowledge graph request timed out");
    if (error instanceof KgClientError) throw error;
    throw new KgClientError("kg_unavailable", "Knowledge graph unavailable");
  } finally { clearTimeout(timer); }
}
