/** Environment configuration for the intent classification layer. Read on every call so tests can override it. */
import { INTENT_CATEGORIES, type IntentCategory, type IntentConfig } from "@/lib/chat/intent/types";

export const DEFAULT_THRESHOLD = 0.5;
export const DEFAULT_TIMEOUT_MS = 3000;
export const DEFAULT_MODEL = "jev-1.14.0";
export const DEFAULT_BASE_URL = "https://api.typesafe.ai/v1/systemone";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function thresholdsFrom(raw: string | undefined): Record<IntentCategory, number> {
  const out = Object.fromEntries(INTENT_CATEGORIES.map((c) => [c, DEFAULT_THRESHOLD])) as Record<IntentCategory, number>;
  if (!raw?.trim()) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out; // invalid JSON -> defaults
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
  for (const c of INTENT_CATEGORIES) {
    const v = (parsed as Record<string, unknown>)[c];
    if (typeof v === "number" && Number.isFinite(v)) out[c] = clamp01(v);
  }
  return out;
}

export function intentConfig(env: Record<string, string | undefined> = process.env): IntentConfig {
  const timeout = Number(env.CLASSIFIER_TIMEOUT_MS);
  return {
    enabled: /^(1|true|yes|on)$/i.test(env.CLASSIFIER_ENABLED?.trim() ?? ""),
    mode: env.CLASSIFIER_MODE?.trim().toLowerCase() === "enforce" ? "enforce" : "shadow",
    timeoutMs: Number.isFinite(timeout) && timeout >= 1 ? Math.floor(timeout) : DEFAULT_TIMEOUT_MS,
    apiKey: env.CLASSIFIER_API_KEY?.trim() ?? "",
    model: env.CLASSIFIER_MODEL?.trim() || DEFAULT_MODEL,
    baseUrl: env.CLASSIFIER_BASE_URL?.trim() || DEFAULT_BASE_URL,
    thresholds: thresholdsFrom(env.CLASSIFIER_THRESHOLDS),
  };
}
