import { chatConfig, KG_SERVER_NAME, type AnswerRole, type ChatConfig } from "./config";
import { codeForAssistantError, codeForMessage, type ChatErrorCode } from "./errors";
import { builtinTools, DENIED_TOOLS, isToolAllowed } from "./policy";
import { buildSystemPrompt } from "./prompts";

/**
 * The one interface everything Claude-related goes through, so credentials or the engine can change without touching
 * the rest of the app: `sdk` (Claude Agent SDK = Claude Code engine) now, `mock` for tests.
 */
export interface RunUser {
  id: string;
  username: string;
}

export interface RunRequest {
  prompt: string;
  role: AnswerRole;
  user: RunUser;
  /** Claude session to continue (REQ-HARN-04). */
  resumeSessionId?: string | null;
  signal: AbortSignal;
  onEvent: (e: RunnerEvent) => void;
}

export type RunnerEvent =
  | { type: "session"; sessionId: string; model?: string }
  | { type: "text"; delta: string }
  | { type: "tool_use"; toolUseId: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; isError: boolean }
  | { type: "tool_denied"; toolUseId?: string; name: string; input: Record<string, unknown> };

export interface RunResult {
  ok: boolean;
  errorCode?: ChatErrorCode;
  errorDetail?: string;
  sessionId?: string;
  model?: string;
  tokensIn: number;
  tokensOut: number;
  numTurns: number;
  /** Something visible happened (text or a tool call). Used to decide whether a failed resume can be replayed. */
  producedOutput: boolean;
}

export interface ClaudeRunner {
  run(req: RunRequest): Promise<RunResult>;
}

// ---------------------------------------------------------------- environment for the Claude process

/**
 * The Claude process gets a minimal environment: never DATABASE_URL, JWT_SECRET, KG_MCP_TOKEN or other app secrets
 * (REQ-NFR-05). Only what it needs to start, reach the network and find its own credentials.
 */
const PASS_THROUGH = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TZ",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  // Claude credentials: API key, long-lived subscription token (`claude setup-token`) or a cloud provider.
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "AWS_REGION",
  "AWS_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
];

export function harnessEnv(cfg: ChatConfig, src: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of PASS_THROUGH) if (src[k]) env[k] = src[k]!;
  if (cfg.claudeConfigDir) env.CLAUDE_CONFIG_DIR = cfg.claudeConfigDir;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "knowledge-review-chat/1.0";
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION = "false";
  env.DISABLE_AUTOUPDATER = "1";
  return env;
}

/** Headers sent to the KB MCP server on every call: its token plus the app user, for its logs (REQ-HARN-05). */
export function kgHeaders(cfg: ChatConfig, user: RunUser, role: AnswerRole): Record<string, string> {
  const h: Record<string, string> = {
    "X-App-User-Id": user.id,
    "X-App-Username": user.username,
    "X-App-User-Role": role,
  };
  if (cfg.kgMcpToken) h.Authorization = `Bearer ${cfg.kgMcpToken}`;
  return h;
}

// ---------------------------------------------------------------- Claude Agent SDK runner

const KG_DOWN_STATUSES = new Set(["failed", "needs-auth", "disabled"]);

export class AgentSdkRunner implements ClaudeRunner {
  constructor(private cfg: ChatConfig = chatConfig()) {}

  async run(req: RunRequest): Promise<RunResult> {
    const cfg = this.cfg;
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const result: RunResult = { ok: false, tokensIn: 0, tokensOut: 0, numTurns: 0, producedOutput: false };
    if (!cfg.kgMcpUrl) return { ...result, errorCode: "kb_unavailable", errorDetail: "KG_MCP_URL is not configured" };

    const abort = new AbortController();
    const onAbort = () => abort.abort(req.signal.reason);
    if (req.signal.aborted) onAbort();
    else req.signal.addEventListener("abort", onAbort, { once: true });

    const stderrTail: string[] = [];
    let lastBlockWasText = false;
    let pendingError: ChatErrorCode | null = null;

    try {
      const q = query({
        prompt: req.prompt,
        options: {
          cwd: cfg.harnessDir,
          model: cfg.model,
          pathToClaudeCodeExecutable: cfg.claudeBin,
          env: harnessEnv(cfg),
          abortController: abort,
          // Only the harness project's settings; never the server user's ~/.claude settings (REQ-HARN-02).
          settingSources: ["project"],
          systemPrompt: { type: "custom", prompt: buildSystemPrompt(cfg.harnessDir, req.role) },
          tools: builtinTools(cfg.allowWeb),
          disallowedTools: DENIED_TOOLS,
          // No allow rules: every tool call goes through canUseTool, which is the single gate (REQ-HARN-01).
          permissionMode: "default",
          canUseTool: async (toolName, input, opts) => {
            if (isToolAllowed(toolName, cfg.allowWeb)) return { behavior: "allow", updatedInput: input };
            req.onEvent({ type: "tool_denied", toolUseId: opts.toolUseID, name: toolName, input });
            return { behavior: "deny", message: `The ${toolName} tool is not available in this assistant.` };
          },
          skills: [], // role skill is injected into the system prompt; the Skill tool stays off
          strictMcpConfig: true,
          mcpServers: {
            [KG_SERVER_NAME]: { type: "http", url: cfg.kgMcpUrl, headers: kgHeaders(cfg, req.user, req.role), alwaysLoad: true },
          },
          resume: req.resumeSessionId ?? undefined,
          maxTurns: cfg.maxTurns,
          includePartialMessages: true,
          verbatimPrompts: true, // user text is never treated as a slash command or @file mention
          persistSession: true, // needed for resume
          stderr: (d) => {
            stderrTail.push(d);
            if (stderrTail.length > 20) stderrTail.shift();
          },
        },
      });

      for await (const m of q) {
        switch (m.type) {
          case "system":
            if (m.subtype === "init") {
              result.sessionId = m.session_id;
              result.model = m.model;
              req.onEvent({ type: "session", sessionId: m.session_id, model: m.model });
              const kg = m.mcp_servers.find((s) => s.name === KG_SERVER_NAME);
              if (!kg || KG_DOWN_STATUSES.has(kg.status)) {
                pendingError = "kb_unavailable";
                result.errorDetail = `MCP server status: ${kg?.status ?? "missing"}`;
                abort.abort("kb_unavailable");
              }
            }
            break;
          case "stream_event": {
            if (m.parent_tool_use_id) break;
            const ev = m.event;
            if (ev.type === "content_block_start") {
              // separate text written before and after tool calls
              if (ev.content_block.type === "text" && !lastBlockWasText && result.producedOutput) req.onEvent({ type: "text", delta: "\n\n" });
              if (ev.content_block.type === "tool_use" || ev.content_block.type === "server_tool_use") lastBlockWasText = false;
            } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) {
              lastBlockWasText = true;
              result.producedOutput = true;
              req.onEvent({ type: "text", delta: ev.delta.text });
            }
            break;
          }
          case "assistant": {
            if (m.parent_tool_use_id) break;
            const code = codeForAssistantError(m.error);
            if (code) pendingError = code;
            for (const b of m.message.content) {
              if (b.type === "tool_use" || b.type === "server_tool_use" || b.type === "mcp_tool_use") {
                result.producedOutput = true;
                lastBlockWasText = false;
                const name = b.type === "mcp_tool_use" ? `mcp__${b.server_name}__${b.name}` : b.name;
                req.onEvent({ type: "tool_use", toolUseId: b.id, name, input: (b.input ?? {}) as Record<string, unknown> });
              }
            }
            break;
          }
          case "user": {
            const content = m.message.content;
            if (m.parent_tool_use_id || typeof content === "string") break;
            for (const b of content) {
              if (b.type === "tool_result") req.onEvent({ type: "tool_result", toolUseId: b.tool_use_id, isError: !!b.is_error });
            }
            break;
          }
          case "rate_limit_event":
            if (m.rate_limit_info.status === "rejected") pendingError = "usage_limit";
            break;
          case "result": {
            result.numTurns = m.num_turns;
            for (const u of Object.values(m.modelUsage ?? {})) {
              result.tokensIn += (u.inputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0);
              result.tokensOut += u.outputTokens ?? 0;
            }
            for (const d of m.permission_denials ?? []) req.onEvent({ type: "tool_denied", toolUseId: d.tool_use_id, name: d.tool_name, input: d.tool_input });
            if (m.subtype === "success" && !m.is_error && !pendingError) {
              result.ok = true;
            } else {
              const detail = m.subtype === "success" ? m.result : [m.subtype, ...(m.errors ?? [])].join(": ");
              result.errorDetail = detail?.slice(0, 2000);
              // error_max_turns: the agent ran out of turns before finishing; the partial text is kept with the error.
              result.errorCode = pendingError ?? (m.subtype === "error_max_turns" ? "error" : codeForMessage(detail ?? ""));
            }
            break;
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errorDetail = [msg, ...stderrTail].join("\n").slice(0, 2000);
      result.errorCode = pendingError ?? (req.signal.aborted ? "error" : codeForMessage(result.errorDetail));
    } finally {
      req.signal.removeEventListener("abort", onAbort);
    }

    if (!result.ok && !result.errorCode) result.errorCode = pendingError ?? "error";
    if (pendingError && result.ok) {
      result.ok = false;
      result.errorCode = pendingError;
    }
    return result;
  }
}

// ---------------------------------------------------------------- mock runner (tests, offline dev)

export class MockRunner implements ClaudeRunner {
  /** Lets tests script the behaviour. Default: stream a short role-specific answer. */
  constructor(private script?: (req: RunRequest) => Promise<RunResult>) {}

  async run(req: RunRequest): Promise<RunResult> {
    if (this.script) return this.script(req);
    const sessionId = req.resumeSessionId ?? `mock-${crypto.randomUUID()}`;
    req.onEvent({ type: "session", sessionId, model: "mock" });
    const words = `**${req.role} answer (mock).** You asked: _${req.prompt.slice(0, 200)}_\n\n| Item | Value |\n|---|---|\n| Role | ${req.role} |\n\nThis is a canned answer from the mock runner.`.split(/(?<= )/);
    for (const w of words) {
      if (req.signal.aborted) return { ok: false, sessionId, tokensIn: 0, tokensOut: 0, numTurns: 1, producedOutput: true, errorCode: "error" };
      req.onEvent({ type: "text", delta: w });
      await new Promise((r) => setTimeout(r, 15));
    }
    return { ok: true, sessionId, model: "mock", tokensIn: 100, tokensOut: words.length, numTurns: 1, producedOutput: true };
  }
}

export function createRunner(cfg: ChatConfig = chatConfig()): ClaudeRunner {
  return cfg.runner === "mock" ? new MockRunner() : new AgentSdkRunner(cfg);
}
