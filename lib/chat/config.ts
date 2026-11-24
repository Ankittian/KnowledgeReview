import path from "node:path";

export const ANSWER_ROLES = ["technical", "functional", "product"] as const;
export type AnswerRole = (typeof ANSWER_ROLES)[number];
export const DEFAULT_ANSWER_ROLE: AnswerRole = "functional";

/** Name the KB MCP server is registered under. Its tools are exposed to Claude as `mcp__spectrum-kg__<tool>`. */
export const KG_SERVER_NAME = "spectrum-kg";
/** Name the second KB MCP server (SpectrumERP-new) is registered under: tools `mcp__spectrum-kg-new__<tool>`. */
export const KG_NEW_SERVER_NAME = "spectrum-kg-new";

/** Knowledge base a conversation uses; fixed per conversation (docs/plans/PLAN-kg-mcp-new.md D1). */
export const KB_SOURCES = ["spectrumerp", "spectrumerp_new"] as const;
export type KbSource = (typeof KB_SOURCES)[number];
export const DEFAULT_KB_SOURCE: KbSource = "spectrumerp";
/** User-facing names (D8). */
export const KB_LABELS: Record<KbSource, string> = { spectrumerp: "SpectrumERP", spectrumerp_new: "SpectrumERP-new" };
export const isKbSource = (v: unknown): v is KbSource => typeof v === "string" && (KB_SOURCES as readonly string[]).includes(v);

/** The new MCP's token roles. The token decides the role on that server (D3). */
export type KgTokenRole = "technical" | "functional";
/** App answer role -> new MCP token role: technical -> technical, functional -> functional, product -> technical (D3). */
export const tokenRoleFor = (role: AnswerRole): KgTokenRole => (role === "functional" ? "functional" : "technical");

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
    /** SpectrumERP-new MCP server (D8). Both tokens are required for it to count as configured. */
    kgNewMcpUrl: e.KG_NEW_MCP_URL?.trim() || "",
    kgNewMcpTokenTechnical: e.KG_NEW_MCP_TOKEN_TECHNICAL?.trim() || "",
    kgNewMcpTokenFunctional: e.KG_NEW_MCP_TOKEN_FUNCTIONAL?.trim() || "",
    /** Optional limits for SpectrumERP-new chats; default to the shared CHAT_TIMEOUT_SECONDS / CHAT_MAX_TURNS (D9). */
    newTimeoutMs: int(e.CHAT_NEW_TIMEOUT_SECONDS, int(e.CHAT_TIMEOUT_SECONDS, 120)) * 1000,
    newMaxTurns: int(e.CHAT_NEW_MAX_TURNS, int(e.CHAT_MAX_TURNS, 16)),
  };
}

export type ChatConfig = ReturnType<typeof chatConfig>;

/** True when SpectrumERP-new has a URL and both tokens. When false the option is hidden and refused (D19). */
export const kgNewConfigured = (cfg: ChatConfig = chatConfig()) => Boolean(cfg.kgNewMcpUrl && cfg.kgNewMcpTokenTechnical && cfg.kgNewMcpTokenFunctional);

export interface KbServer {
  kb: KbSource;
  /** MCP server name; Claude sees its tools as `mcp__<serverName>__<tool>`. */
  serverName: string;
  url: string;
  /** Bearer token. Server-side only: never put it in env passed to the Claude process (NFR-05). */
  token: string;
  /** Token role used on the new server; null for the old server (it has one token). */
  tokenRole: KgTokenRole | null;
  timeoutMs: number;
  maxTurns: number;
  /** URL (and, for the new server, both tokens) present. */
  configured: boolean;
}

/** Connection and limits for one conversation's KB, from its kb_source and answer role. */
export function kbServer(kb: KbSource, role: AnswerRole, cfg: ChatConfig = chatConfig()): KbServer {
  if (kb === "spectrumerp_new") {
    const tokenRole = tokenRoleFor(role);
    return { kb, serverName: KG_NEW_SERVER_NAME, url: cfg.kgNewMcpUrl, token: tokenRole === "functional" ? cfg.kgNewMcpTokenFunctional : cfg.kgNewMcpTokenTechnical, tokenRole, timeoutMs: cfg.newTimeoutMs, maxTurns: cfg.newMaxTurns, configured: kgNewConfigured(cfg) };
  }
  return { kb, serverName: KG_SERVER_NAME, url: cfg.kgMcpUrl, token: cfg.kgMcpToken, tokenRole: null, timeoutMs: cfg.timeoutMs, maxTurns: cfg.maxTurns, configured: Boolean(cfg.kgMcpUrl) };
}
