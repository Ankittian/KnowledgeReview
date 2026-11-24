import { DEFAULT_KB_SOURCE, KG_NEW_SERVER_NAME, KG_SERVER_NAME, type KbSource } from "./config";

/**
 * Tool permissions for the harness (REQ-HARN-01, PDF section 6 table). Enforced in SDK configuration in three layers:
 *   1. `tools`: the only built-in tools the model is even offered (web tools, or none);
 *   2. `disallowedTools`: removed from the model's context even if something else enables them;
 *   3. `canUseTool`: the allow-list check for EVERY call (no allow rules shadow it); anything else is denied and
 *      audit-logged. Allowed calls are approved here, so no approval prompt ever reaches a user.
 * The prompt is never relied on for this.
 * The allow-list is per conversation (D5): a chat may use only its own knowledge base's server, never the other one's.
 */
export const KG_TOOL_PREFIX = `mcp__${KG_SERVER_NAME}__`;
export const KG_NEW_TOOL_PREFIX = `mcp__${KG_NEW_SERVER_NAME}__`;
/** Tool-name prefix of the MCP server a conversation's KB is registered under. */
export const toolPrefixFor = (kb: KbSource) => (kb === "spectrumerp_new" ? KG_NEW_TOOL_PREFIX : KG_TOOL_PREFIX);
/** `log_qa` writes the full Q&A to the new server's activity log; off for now (D5). */
export const KG_NEW_LOG_QA_TOOL = `${KG_NEW_TOOL_PREFIX}log_qa`;
export const WEB_TOOLS = ["WebSearch", "WebFetch"] as const;

export const DENIED_TOOLS = [
  "Bash",
  "PowerShell",
  "BashOutput",
  "KillShell",
  "Monitor",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "NotebookRead",
  "Glob",
  "Grep",
  "LS",
  "Agent",
  "Task",
  "TodoWrite",
  "Workflow",
  "Skill",
  "ExitPlanMode",
  "AskUserQuestion",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
];

/**
 * Tools removed from the model's context for one conversation. `log_qa` is listed here (not denied per call) so the
 * model never sees it and no denial is logged every turn (D5).
 */
export function disallowedToolsFor(kb: KbSource): string[] {
  return kb === "spectrumerp_new" ? [...DENIED_TOOLS, KG_NEW_LOG_QA_TOOL] : DENIED_TOOLS;
}

export function builtinTools(allowWeb: boolean): string[] {
  return allowWeb ? [...WEB_TOOLS] : [];
}

export function isToolAllowed(toolName: string, allowWeb: boolean, kb: KbSource = DEFAULT_KB_SOURCE): boolean {
  const prefix = toolPrefixFor(kb);
  if (toolName.startsWith(prefix) && toolName.length > prefix.length) return true;
  return allowWeb && (WEB_TOOLS as readonly string[]).includes(toolName);
}

/** Short, safe status line for the UI while a tool runs. Never shows arguments or sources (REQ-CHAT-12). */
export function toolActivityLabel(toolName: string): string {
  if (toolName.startsWith(KG_TOOL_PREFIX) || toolName.startsWith(KG_NEW_TOOL_PREFIX)) return "Looking up the knowledge base…";
  if (toolName === "WebSearch") return "Searching the web…";
  if (toolName === "WebFetch") return "Reading a web page…";
  return "Working…";
}
