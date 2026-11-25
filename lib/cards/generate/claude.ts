import { chatConfig, kbServer } from "@/lib/chat/config";
import { codeForAssistantError, codeForMessage } from "@/lib/chat/errors";
import { DENIED_TOOLS, isToolAllowed } from "@/lib/chat/policy";
import { harnessEnv, kgHeaders } from "@/lib/chat/runner";
import { GEN_MODELS, itemTotal, type GenModel, type JobItem } from "./config";

/**
 * The one Claude call of card generation. It reuses the chat harness setup (lib/chat/runner.ts): the same server-side
 * credential from the environment, the same minimal child-process environment, the same knowledge-graph MCP server.
 * The model may call ONLY the read-only knowledge-graph tools; no shell, file or web tool exists for it, and the
 * server (not the model) chooses where anything is written.
 */
export interface GenerateRequest {
  kind: "cards" | "repair";
  prompt: string;
  model: GenModel;
  /** the admin who asked (sent to the knowledge-graph server for its logs) */
  user: { id: string; username: string };
  signal: AbortSignal;
  /** only the mock client reads these */
  module?: string;
  items?: JobItem[];
  audience?: "functional" | "technical";
}

export interface GenerateResult {
  ok: boolean;
  text: string;
  error?: string;
  model?: string;
  tokensIn: number;
  tokensOut: number;
}

export interface GenClient {
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

/** The model id to send: the server's override for the chosen model, then the default of that model. */
export function modelId(m: GenModel, env: Record<string, string | undefined> = process.env): string {
  const override = m === "sonnet" ? env.CARDS_MODEL_SONNET : env.CARDS_MODEL_OPUS;
  return override?.trim() || GEN_MODELS[m].defaultId;
}

const SYSTEM = "You write short ERP training flashcards from the SpectrumERP knowledge graph. Read it only through the spectrum-kg tools. Follow the user's instructions exactly and reply with the JSON they ask for and nothing else.";

export class SdkGenClient implements GenClient {
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const cfg = chatConfig();
    const out: GenerateResult = { ok: false, text: "", tokensIn: 0, tokensOut: 0 };
    // Card generation reads the SpectrumERP graph (spectrum-kg). kbServer() is the same resolver the chat uses for both knowledge bases.
    const kb = kbServer("spectrumerp", "functional", cfg);
    if (!kb.configured) return { ...out, error: "KG_MCP_URL is not configured" };
    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    const abort = new AbortController();
    const onAbort = () => abort.abort(req.signal.reason);
    if (req.signal.aborted) onAbort();
    else req.signal.addEventListener("abort", onAbort, { once: true });
    const timeoutMs = Math.max(1, Number(process.env.CARDS_TIMEOUT_MINUTES) || 20) * 60_000;
    const timer = setTimeout(() => abort.abort("timeout"), timeoutMs);
    const stderrTail: string[] = [];
    let pendingError: string | null = null;

    try {
      const q = query({
        prompt: req.prompt,
        options: {
          cwd: cfg.harnessDir,
          model: modelId(req.model),
          pathToClaudeCodeExecutable: cfg.claudeBin,
          env: harnessEnv(cfg),
          abortController: abort,
          settingSources: ["project"],
          systemPrompt: { type: "custom", prompt: SYSTEM },
          tools: [],
          disallowedTools: DENIED_TOOLS,
          permissionMode: "default",
          canUseTool: async (toolName, input) =>
            isToolAllowed(toolName, false) ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: `The ${toolName} tool is not available.` },
          skills: [],
          strictMcpConfig: true,
          mcpServers: {
            [kb.serverName]: { type: "http", url: kb.url, headers: kgHeaders(kb, req.user, "functional"), alwaysLoad: true },
          },
          maxTurns: Math.max(5, Number(process.env.CARDS_MAX_TURNS) || 60),
          persistSession: false,
          verbatimPrompts: true,
          stderr: (d) => {
            stderrTail.push(d);
            if (stderrTail.length > 20) stderrTail.shift();
          },
        },
      });

      for await (const m of q) {
        if (m.type === "system" && m.subtype === "init") {
          out.model = m.model;
          const kg = m.mcp_servers.find((s) => s.name === kb.serverName);
          if (!kg || ["failed", "needs-auth", "disabled"].includes(kg.status)) {
            pendingError = `The knowledge graph is not reachable (status: ${kg?.status ?? "missing"})`;
            abort.abort("kb_unavailable");
          }
        } else if (m.type === "assistant" && !m.parent_tool_use_id) {
          const code = codeForAssistantError(m.error);
          if (code) pendingError = `Claude reported: ${code}`;
        } else if (m.type === "rate_limit_event" && m.rate_limit_info.status === "rejected") {
          pendingError = "The Claude usage limit was reached";
        } else if (m.type === "result") {
          for (const u of Object.values(m.modelUsage ?? {})) {
            out.tokensIn += (u.inputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0);
            out.tokensOut += u.outputTokens ?? 0;
          }
          if (m.subtype === "success" && !m.is_error && !pendingError) {
            out.ok = true;
            out.text = m.result ?? "";
          } else {
            const detail = m.subtype === "success" ? m.result : [m.subtype, ...(m.errors ?? [])].join(": ");
            out.error = pendingError ?? `${codeForMessage(detail ?? "")}: ${(detail ?? "").slice(0, 300)}`;
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.error = pendingError ?? (abort.signal.reason === "timeout" ? `Timed out after ${Math.round(timeoutMs / 60000)} minutes` : [msg, ...stderrTail].join(" ").slice(0, 500));
    } finally {
      clearTimeout(timer);
      req.signal.removeEventListener("abort", onAbort);
    }
    if (!out.ok && !out.error) out.error = pendingError ?? "Claude returned no answer";
    return out;
  }
}

// ---------------------------------------------------------------- mock (CLAUDE_RUNNER=mock: tests and offline development)

const SAFE_SENTENCES = [
  "The storekeeper checks the delivery against the purchase order before anything is accepted.",
  "Stock rises only after the approver authorizes the receipt, so unchecked goods never count.",
  "Finance uses the valued entry later when the supplier bill is passed for payment.",
  "If the quantity is short, the buyer is told and the order stays open for the balance.",
  "Each step hands a clear document to the next team, so nobody has to ask what happened.",
  "A reversal is done with a new entry, so the history of what really happened stays visible.",
  "The approver looks at the quantity, the rate and the supplier before giving the approval.",
  "Deliveries on one order are added together and compared with the agreed extra percentage.",
];

const ADJ = ["late", "partial", "rejected", "urgent", "returned", "blocked", "split", "damaged", "repeated", "corrected", "delayed"];
const NOUN = ["delivery", "invoice", "approval", "shipment", "quantity", "supplier", "inspection", "payment", "order", "receipt", "challan", "rate", "balance"];
const PLACE = ["stores", "gate", "accounts", "purchase desk", "quality team", "warehouse", "yard"];
let counter = 0;

/** Canned cards that pass every check: unique titles, enough words, well-formed source references. */
export class MockGenClient implements GenClient {
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (req.signal.aborted) return { ok: false, text: "", error: "Cancelled", tokensIn: 0, tokensOut: 0 };
    await new Promise((r) => setTimeout(r, Number(process.env.CARDS_MOCK_DELAY_MS) || 1500));
    if (req.kind === "repair") return { ok: true, text: JSON.stringify({ cards: [] }), model: "mock", tokensIn: 10, tokensOut: 10 };
    const stamp = Date.now().toString(36);
    const wordsFor = { easy: 30, medium: 80, hard: 150 } as const;
    const items = (req.items ?? []).map((it) => {
      const cards: object[] = [];
      let n = 0;
      for (const level of ["easy", "medium", "hard"] as const) {
        for (let k = 0; k < it[level]; k++) {
          n++;
          const c = counter++;
          const body: string[] = [];
          let words = 0;
          for (let s = n; words < wordsFor[level]; s++) {
            const sentence = SAFE_SENTENCES[s % SAFE_SENTENCES.length];
            body.push(sentence);
            words += sentence.split(" ").length;
          }
          cards.push({
            level,
            topic_key: `sample-${level}--topic-${stamp}-${c}`,
            title: `What should the team check when a ${ADJ[c % ADJ.length]} ${NOUN[c % NOUN.length]} reaches the ${PLACE[c % PLACE.length]}?`,
            body: body.join("\n"),
            source_refs: [`${it.title} [4:00000000-0000-0000-0000-000000000000:${n}] (${it.scope}:${it.key})`],
          });
        }
      }
      return { scope: it.scope, key: it.key, title: it.title, context: `Sample flow > ${it.title}`, cards };
    });
    const total = (req.items ?? []).reduce((n, i) => n + itemTotal(i), 0);
    return { ok: true, text: JSON.stringify({ module: req.module, audience: req.audience ?? "functional", items }), model: "mock", tokensIn: 100 * total, tokensOut: 80 * total };
  }
}

export function createGenClient(): GenClient {
  return chatConfig().runner === "mock" ? new MockGenClient() : new SdkGenClient();
}
