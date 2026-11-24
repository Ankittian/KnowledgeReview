/**
 * Minimal client for TypeSafe AI's jev model: POST {baseUrl} (https://api.typesafe.ai/v1/systemone) with
 * `Authorization: Bearer <key>` and body { model, state, questions: { <key>: { type: "noul", instructions, criteria? } } }.
 * Response: { model, answers: { <key>: { type: "noul", noul: 0..1 } }, usage }.
 * Plain fetch, no SDK. Errors never include the API key or the response body.
 */
import type { IntentConfig } from "@/lib/chat/intent/types";

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}

export type JevErrorReason = "timeout" | "network" | "bad_output" | `http_${number}`;

export class JevError extends Error {
  constructor(public readonly reason: JevErrorReason) {
    super(`jev call failed: ${reason}`);
    this.name = "JevError";
  }
}

export interface CallJevOptions {
  fetch?: typeof fetch;
  /** Caller abort (e.g. request cancelled); surfaces as reason "network". */
  signal?: AbortSignal;
  /** Wait before the single 429/529 retry when the server sends no Retry-After. Default 300. */
  retryDelayMs?: number;
}

const RETRY_STATUSES = new Set([429, 529]);

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Returns the yes-probability (0..1) for every question key; throws JevError otherwise. */
export async function callJev(
  cfg: Pick<IntentConfig, "apiKey" | "model" | "baseUrl" | "timeoutMs">,
  state: unknown,
  questions: Record<string, NoulQuestion>,
  opts: CallJevOptions = {},
): Promise<Record<string, number>> {
  const doFetch = opts.fetch ?? fetch;
  const timeout = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeout.abort();
  }, cfg.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([timeout.signal, opts.signal]) : timeout.signal;
  const deadline = Date.now() + cfg.timeoutMs;
  const body = JSON.stringify({ model: cfg.model, state, questions });
  const init: RequestInit = {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body,
    signal,
  };

  try {
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await doFetch(cfg.baseUrl, init);
      if (!RETRY_STATUSES.has(res.status) || attempt >= 1) break;
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : (opts.retryDelayMs ?? 300);
      if (Date.now() + wait >= deadline) break; // no room left inside the overall timeout: report this failure
      await sleep(wait, signal);
    }
    if (!res.ok) throw new JevError(`http_${res.status}`);
    let json: unknown;
    try {
      json = await res.json();
    } catch (e) {
      if (signal.aborted) throw e;
      throw new JevError("bad_output");
    }
    return parseAnswers(json, Object.keys(questions));
  } catch (e) {
    if (e instanceof JevError) throw e;
    throw new JevError(timedOut ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}

function parseAnswers(json: unknown, keys: string[]): Record<string, number> {
  const answers = (json as { answers?: unknown } | null)?.answers;
  if (!answers || typeof answers !== "object") throw new JevError("bad_output");
  const out: Record<string, number> = {};
  for (const k of keys) {
    const v = (answers as Record<string, { noul?: unknown } | null>)[k]?.noul;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) throw new JevError("bad_output");
    out[k] = v;
  }
  return out;
}
