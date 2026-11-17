import { z } from "zod";

/**
 * Settings shared by the admin UI, the server actions and the worker. Pure (no node or database imports), so the
 * browser can import it too.
 */

/** Models an admin may pick. The ids can be overridden per server with CARDS_MODEL_SONNET / CARDS_MODEL_OPUS. */
export const GEN_MODELS = {
  sonnet: { label: "Sonnet (faster, cheaper)", defaultId: "claude-sonnet-5-5", usdPerCard: 0.015, secondsPerCard: 6 },
  opus: { label: "Opus (for hard cards)", defaultId: "claude-opus-5-5", usdPerCard: 0.075, secondsPerCard: 12 },
} as const;
export type GenModel = keyof typeof GEN_MODELS;
export const DEFAULT_GEN_MODEL: GenModel = "sonnet";

export const LIMITS = {
  /** most cards one job may ask for (the server also reads CARDS_MAX_PER_JOB) */
  maxCardsPerJob: 120,
  maxPerLevel: 10,
  maxItems: 40,
  /** forms or modules handled by one Claude call */
  batchSize: 4,
  instructionsMax: 1000,
  /** jobs one admin may start per day (the server also reads CARDS_MAX_JOBS_PER_DAY) */
  maxJobsPerDay: 20,
} as const;

/** Who the cards are written for. Stored on every card (cards.audience); each audience has its own prompt template. */
export const AUDIENCES = ["functional", "technical"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_LABEL: Record<Audience, string> = { functional: "Functional", technical: "Technical" };
export const AUDIENCE_HINT: Record<Audience, string> = {
  functional: "Business users: plain words, no screen or code details.",
  technical: "Technical users: how it is built and behaves in the system.",
};
export const DEFAULT_AUDIENCE: Audience = "functional";

/** The audience of a saved job request (jobs made before the choice existed are functional). */
export const audienceOf = (params: unknown): Audience => ((params as { audience?: string } | null)?.audience === "technical" ? "technical" : "functional");

export const DEFAULT_COUNTS = { easy: 3, medium: 3, hard: 2 } as const;

export const itemSchema = z.object({
  /** form key (fGRN) for form level, module code (MM) for module level */
  key: z.string().min(1).max(200),
  scope: z.enum(["module", "form"]),
  module: z.string().min(1).max(50),
  title: z.string().min(1).max(300),
  easy: z.number().int().min(0).max(LIMITS.maxPerLevel),
  medium: z.number().int().min(0).max(LIMITS.maxPerLevel),
  hard: z.number().int().min(0).max(LIMITS.maxPerLevel),
});

export const jobParamsSchema = z
  .object({
    level: z.enum(["module", "form"]),
    audience: z.enum(AUDIENCES).default(DEFAULT_AUDIENCE),
    model: z.enum(["sonnet", "opus"]).default(DEFAULT_GEN_MODEL),
    instructions: z.string().max(LIMITS.instructionsMax).default(""),
    items: z.array(itemSchema).min(1, "Select at least one item").max(LIMITS.maxItems, `Select at most ${LIMITS.maxItems} items`),
  })
  .superRefine((p, ctx) => {
    for (const [i, it] of p.items.entries()) {
      if (it.scope !== p.level) ctx.addIssue({ code: "custom", path: ["items", i, "scope"], message: `Every item must be a ${p.level}` });
      if (it.easy + it.medium + it.hard < 1) ctx.addIssue({ code: "custom", path: ["items", i], message: `${it.title}: ask for at least one card` });
    }
    if (new Set(p.items.map((i) => `${i.scope}:${i.key}`)).size !== p.items.length) ctx.addIssue({ code: "custom", path: ["items"], message: "An item is selected twice" });
  });

export type JobItem = z.infer<typeof itemSchema>;
export type JobParams = z.infer<typeof jobParamsSchema>;

export const itemTotal = (i: Pick<JobItem, "easy" | "medium" | "hard">) => i.easy + i.medium + i.hard;
export const totalCards = (items: Pick<JobItem, "easy" | "medium" | "hard">[]) => items.reduce((n, i) => n + itemTotal(i), 0);

/** Rough size of a job, shown before Generate. An estimate only: the real cost depends on how much the model reads. */
export function estimateJob(items: Pick<JobItem, "easy" | "medium" | "hard">[], model: GenModel) {
  const cards = totalCards(items);
  const m = GEN_MODELS[model];
  const batches = Math.ceil(items.length / LIMITS.batchSize);
  return { cards, batches, usd: Math.round(cards * m.usdPerCard * 100) / 100, minutes: Math.max(1, Math.round((cards * m.secondsPerCard) / 60 + batches * 0.5)) };
}

export type JobStatus = "queued" | "generating" | "ready" | "pushing" | "pushed" | "failed" | "cancelled";
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  generating: "Generating",
  ready: "Ready for review",
  pushing: "Pushing",
  pushed: "Pushed",
  failed: "Failed",
  cancelled: "Cancelled",
};
/** A job in one of these states is still moving: the jobs list refreshes itself. */
export const ACTIVE_STATUSES: JobStatus[] = ["queued", "generating", "pushing"];

export type NotificationKind = "cards_ready" | "cards_failed" | "cards_pushed";
