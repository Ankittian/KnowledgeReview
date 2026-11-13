/** Error codes stored on failed answers and shown to users with a Retry button (REQ-CHAT-09). */
export const CHAT_ERROR_CODES = ["timeout", "usage_limit", "kb_unavailable", "claude_unavailable", "interrupted", "error"] as const;
export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number];

export const CHAT_ERROR_TEXT: Record<ChatErrorCode, string> = {
  timeout: "The answer took too long and was stopped. Try again, or ask a narrower question.",
  usage_limit: "The Claude usage limit has been reached. Please try again later.",
  kb_unavailable: "The knowledge base is not reachable right now (MCP server or Neo4j is down). Please try again in a few minutes.",
  claude_unavailable: "The assistant is not available right now (Claude could not be reached). Please try again later.",
  interrupted: "The answer was interrupted because the server restarted. Please try again.",
  error: "Something went wrong while answering. Please try again.",
};

export const chatErrorText = (code: string | null | undefined) =>
  CHAT_ERROR_TEXT[(CHAT_ERROR_CODES as readonly string[]).includes(code ?? "") ? (code as ChatErrorCode) : "error"];

/** SDK assistant-message error kinds → our codes. */
export function codeForAssistantError(kind: string | undefined): ChatErrorCode | null {
  switch (kind) {
    case undefined:
      return null;
    case "rate_limit":
    case "billing_error":
      return "usage_limit";
    case "authentication_failed":
    case "oauth_org_not_allowed":
    case "account_on_hold":
    case "verification_required":
    case "overloaded":
    case "server_error":
    case "model_not_found":
    case "cloud_credential_error":
      return "claude_unavailable";
    default:
      return "error";
  }
}

/** Best-effort mapping of a free-text failure (thrown error, result.errors) to a code. */
export function codeForMessage(msg: string): ChatErrorCode {
  const m = msg.toLowerCase();
  if (/usage limit|rate.?limit|limit reached|quota|too many requests|\b429\b/.test(m)) return "usage_limit";
  if (/mcp|spectrum-kg|neo4j/.test(m)) return "kb_unavailable";
  if (/auth|login|credential|api key|oauth|enoent|spawn|not found.*claude|overloaded|\b5\d\d\b/.test(m)) return "claude_unavailable";
  return "error";
}

/** Failures that look like "the stored Claude session is gone", so the history should be replayed instead. */
export function looksLikeResumeFailure(msg: string): boolean {
  return /no conversation found|session.*(not found|does not exist|unknown)|could not resume|failed to resume|resume/i.test(msg);
}
