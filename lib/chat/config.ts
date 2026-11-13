import path from "node:path";

export const ANSWER_ROLES = ["technical", "functional", "product"] as const;
export type AnswerRole = (typeof ANSWER_ROLES)[number];
export const DEFAULT_ANSWER_ROLE: AnswerRole = "functional";

/** Name the KB MCP server is registered under. Its tools are exposed to Claude as `mcp__spectrum-kg__<tool>`. */
export const KG_SERVER_NAME = "spectrum-kg";

const int = (v: string | undefined, fallback: number, min = 1) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
};
const bool = (v: string | undefined, fallback: boolean) => (v == null || v === "" ? fallback : /^(1|true|yes|on)$/i.test(v));

/** All harness limits and connections. Read from the environment on every call so tests can override them. */
export function chatConfig() {
  const e = process.env;
  return {
    enabled: bool(e.CHAT_ENABLED, true),
    /** sdk = Claude Agent SDK (real Claude), mock = canned answers for tests and offline development. */
    runner: (e.CLAUDE_RUNNER === "mock" ? "mock" : "sdk") as "sdk" | "mock",
    model: e.CLAUDE_MODEL?.trim() || undefined,
    /** Optional path to a `claude` binary; the SDK's bundled engine is used when empty. */
    claudeBin: e.CLAUDE_BIN?.trim() || undefined,
    /** Dedicated working directory: only settings + role skills (REQ-HARN-02). */
    harnessDir: e.CLAUDE_HARNESS_DIR?.trim() ? path.resolve(/*turbopackIgnore: true*/ e.CLAUDE_HARNESS_DIR.trim()) : path.join(process.cwd(), "claude-harness"),
    /** Optional separate Claude config dir (credentials + session transcripts) for the harness OS user. */
    claudeConfigDir: e.CLAUDE_CONFIG_DIR?.trim() || undefined,
    maxConcurrent: int(e.MAX_CONCURRENT_CLAUDE, 3),
    timeoutMs: int(e.CHAT_TIMEOUT_SECONDS, 120) * 1000,
    maxTurns: int(e.CHAT_MAX_TURNS, 16),
    dailyLimit: int(e.CHAT_DAILY_LIMIT, 100),
    maxQuestionChars: int(e.CHAT_MAX_QUESTION_CHARS, 4000),
    /** How many earlier turns are replayed when a Claude session cannot be resumed (REQ-HARN-04). */
    replayTurns: int(e.CHAT_REPLAY_TURNS, 8),
    allowWeb: bool(e.CHAT_ALLOW_WEB, true),
    kgMcpUrl: e.KG_MCP_URL?.trim() || "",
    kgMcpToken: e.KG_MCP_TOKEN?.trim() || "",
  };
}

export type ChatConfig = ReturnType<typeof chatConfig>;
