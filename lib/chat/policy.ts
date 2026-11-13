import { KG_SERVER_NAME } from "./config";

/**
 * Tool permissions for the harness (REQ-HARN-01, PDF section 6 table). Enforced in SDK configuration in three layers:
 *   1. `tools`: the only built-in tools the model is even offered (web tools, or none);
 *   2. `disallowedTools`: removed from the model's context even if something else enables them;
 *   3. `canUseTool`: the allow-list check for EVERY call (no allow rules shadow it); anything else is denied and
 *      audit-logged. Allowed calls are approved here, so no approval prompt ever reaches a user.
 * The prompt is never relied on for this.
 */
export const KG_TOOL_PREFIX = `mcp__${KG_SERVER_NAME}__`;
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

export function builtinTools(allowWeb: boolean): string[] {
  return allowWeb ? [...WEB_TOOLS] : [];
}

export function isToolAllowed(toolName: string, allowWeb: boolean): boolean {
  if (toolName.startsWith(KG_TOOL_PREFIX) && toolName.length > KG_TOOL_PREFIX.length) return true;
  return allowWeb && (WEB_TOOLS as readonly string[]).includes(toolName);
}

/** Short, safe status line for the UI while a tool runs. Never shows arguments or sources (REQ-CHAT-12). */
export function toolActivityLabel(toolName: string): string {
  if (toolName.startsWith(KG_TOOL_PREFIX)) return "Looking up the knowledge base…";
  if (toolName === "WebSearch") return "Searching the web…";
  if (toolName === "WebFetch") return "Reading a web page…";
  return "Working…";
}
