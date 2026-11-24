/**
 * Intent classification layer: asks jev whether a chat question is SQL injection, a jailbreak, out of domain
 * and (functional token, non-admin only) asks for a restricted technical object, before the Claude agent runs.
 * classifyIntent never throws. With the layer disabled (or no API key) it returns "disabled" without any network call.
 */
import { callJev, JevError } from "@/lib/chat/intent/jev";
import { categoriesFor, checkSetFor, buildState, questionsFor, QUESTION_KEYS, REFUSALS } from "@/lib/chat/intent/policy";
import { intentConfig } from "@/lib/chat/intent/config";
import { INTENT_CATEGORIES, type BlockedCategory, type IntentCategory, type IntentConfig, type IntentInput, type IntentResult } from "@/lib/chat/intent/types";

export * from "@/lib/chat/intent/types";
export { intentConfig } from "@/lib/chat/intent/config";
export { REFUSALS, checkSetFor, buildState, questionsFor } from "@/lib/chat/intent/policy";
export { callJev, JevError } from "@/lib/chat/intent/jev";

/** Enabled means switched on AND an API key is present; a missing key is treated as off. */
export function intentEnabled(cfg: IntentConfig = intentConfig()): boolean {
  return cfg.enabled && cfg.apiKey !== "";
}

export async function classifyIntent(
  input: IntentInput,
  opts: { config?: IntentConfig; fetch?: typeof fetch } = {},
): Promise<IntentResult> {
  const cfg = opts.config ?? intentConfig();
  const checkSet = checkSetFor(input.tokenRole, input.isAdmin);
  const base = { checkSet, mode: cfg.mode, model: cfg.model, scores: {} as IntentResult["scores"] };

  if (!intentEnabled(cfg)) {
    return { ...base, outcome: "disabled", block: false, category: null, latencyMs: 0, refusal: null };
  }

  const started = Date.now();
  const enforce = cfg.mode === "enforce";
  try {
    const categories = categoriesFor(checkSet);
    const answers = await callJev(cfg, buildState(input, checkSet), questionsFor(checkSet), { fetch: opts.fetch });
    const scores: IntentResult["scores"] = {};
    for (const c of categories) scores[c] = answers[QUESTION_KEYS[c]];

    let category: IntentCategory | null = null;
    for (const c of INTENT_CATEGORIES) {
      const p = scores[c];
      if (p === undefined || p < cfg.thresholds[c]) continue;
      if (category === null || p > (scores[category] ?? 0)) category = c;
    }
    const latencyMs = Date.now() - started;
    if (category === null) return { ...base, scores, outcome: "allowed", block: false, category, latencyMs, refusal: null };
    return enforce
      ? { ...base, scores, outcome: "blocked", block: true, category, latencyMs, refusal: REFUSALS[category] }
      : { ...base, scores, outcome: "would_block", block: false, category, latencyMs, refusal: null };
  } catch (e) {
    return {
      ...base,
      outcome: "error",
      block: enforce,
      category: null,
      latencyMs: Date.now() - started,
      refusal: enforce ? REFUSALS.classifier_error : null,
      error: e instanceof JevError ? e.reason : "unexpected",
    };
  }
}

/** Value for chat_messages.blocked_category: the category, "classifier_error", or null when the turn was not blocked. */
export function blockedCategoryOf(result: IntentResult): BlockedCategory | null {
  if (!result.block) return null;
  return result.outcome === "error" ? "classifier_error" : result.category;
}
