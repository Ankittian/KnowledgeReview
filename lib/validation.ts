import { z } from "zod";

export const normalizeUsername = (u: string) => u.trim().toLowerCase();

export const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters.")
  .max(32, "Username must be at most 32 characters.")
  .regex(/^[a-z0-9._-]+$/, "Use lower-case letters, digits, dot, dash or underscore.");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be at most 128 characters.");

export const signupSchema = z
  .object({
    username: z.string().transform(normalizeUsername).pipe(usernameSchema),
    displayName: z.string().trim().min(2, "Enter your name.").max(80),
    department: z.string().trim().max(80).optional().transform((v) => v || null),
    primaryModule: z.string().trim().max(10).optional().transform((v) => v || null),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });

export const loginSchema = z.object({
  username: z.string().transform(normalizeUsername).pipe(z.string().min(1, "Enter your username.").max(64)),
  password: z.string().min(1, "Enter your password.").max(128),
});

const isoDate = z.iso.datetime({ offset: true }).optional().nullable();

export const FEEDBACK_CATEGORIES = ["incorrect", "incomplete", "outdated", "unclear", "other"] as const;
export const VERDICTS = ["correct", "needs_improvement", "unsure"] as const;

export const reviewSchema = z
  .object({
    clientEventId: z.string().min(8).max(64),
    versionId: z.number().int().positive(),
    deckDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    deckId: z.number().int().positive().optional().nullable(),
    knewIt: z.boolean(),
    verdict: z.enum(VERDICTS),
    shownAt: isoDate,
    flippedAt: isoDate,
    answeredAt: isoDate,
    device: z.string().max(40).optional().nullable(),
    feedback: z
      .object({
        category: z.enum(FEEDBACK_CATEGORIES),
        suggestedText: z.string().max(5000).optional().nullable(),
        comment: z.string().max(2000).optional().nullable(),
      })
      .optional()
      .nullable(),
  })
  .refine((r) => r.verdict !== "needs_improvement" || !!r.feedback, {
    path: ["feedback"],
    message: "Choose what needs improving.",
  });

export const CLIENT_EVENT_TYPES = [
  "deck_started",
  "card_shown",
  "card_flipped",
  "knew_answered",
  "feedback_opened",
  "feedback_cancelled",
  "deck_summary_viewed",
  "browse_search",
  "browse_flip",
] as const;

export const eventsSchema = z.object({
  events: z
    .array(
      z.object({
        clientEventId: z.string().min(8).max(64),
        type: z.enum(CLIENT_EVENT_TYPES),
        versionId: z.number().int().positive().optional().nullable(),
        at: isoDate,
        payload: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(100),
});
