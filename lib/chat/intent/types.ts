/**
 * Intent classification layer (jev decision model) — shared contract.
 * Design: "Chat Intent Classifier — Design Decisions" doc. Everything in lib/chat/intent/ is self-contained;
 * with CLASSIFIER_ENABLED=false the chat path behaves exactly as before.
 */
import type { KgTokenRole } from "@/lib/chat/config";

export const INTENT_CATEGORIES = ["sql_injection", "jailbreak", "out_of_domain", "restricted_object"] as const;
export type IntentCategory = (typeof INTENT_CATEGORIES)[number];

/** common = sql_injection + jailbreak + out_of_domain; common+functional adds restricted_object. */
export type CheckSet = "common" | "common+functional";
export type IntentMode = "shadow" | "enforce";

/**
 * allowed     — no check fired.
 * blocked     — enforce mode, a check fired (or the classifier failed): do not run the agent.
 * would_block — shadow mode, a check fired: log only, run the agent.
 * error       — classifier failed (timeout, HTTP, bad output). In enforce mode `block` is true.
 * disabled    — layer switched off or not configured: run the agent, nothing logged.
 */
export type IntentOutcome = "allowed" | "blocked" | "would_block" | "error" | "disabled";

export interface IntentConfig {
  enabled: boolean;
  mode: IntentMode;
  timeoutMs: number;
  apiKey: string;
  model: string;
  baseUrl: string;
  thresholds: Record<IntentCategory, number>;
}

export interface IntentInput {
  /** MCP token role of the conversation; null for the old single-token SpectrumERP KB. */
  tokenRole: KgTokenRole | null;
  /** Admins always get the common check set. */
  isAdmin: boolean;
  /** The question being checked. */
  latestQuestion: string;
  /** Earlier user questions in this conversation, oldest first; only the last 2 are used. */
  previousQuestions: string[];
}

export interface IntentResult {
  outcome: IntentOutcome;
  /** True when the caller must NOT run the agent and must save `refusal` as the assistant message. */
  block: boolean;
  /** Category of the highest flagged score; null when nothing fired or on error/disabled. */
  category: IntentCategory | null;
  /** Probability per check that was asked. */
  scores: Partial<Record<IntentCategory, number>>;
  checkSet: CheckSet;
  mode: IntentMode;
  model: string;
  latencyMs: number;
  /** Refusal text to show when `block` is true, else null. */
  refusal: string | null;
  /** Short machine-readable error reason when outcome is "error" (e.g. "timeout", "http_500", "bad_output"). */
  error?: string;
}

/** Saved on chat_messages.blocked_category; "classifier_error" when enforce mode blocked because the classifier failed. */
export type BlockedCategory = IntentCategory | "classifier_error";
