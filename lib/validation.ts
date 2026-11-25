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

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." })
  .refine((d) => d.newPassword !== d.currentPassword, { path: ["newPassword"], message: "Choose a password you haven't used here before." });

export const emailSchema = z.string().trim().toLowerCase().max(254, "That email address is too long.").pipe(z.email("Enter a valid email address."));
export const otpCodeSchema = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.");

const passwordsMatch = { path: ["confirmPassword"], message: "Passwords do not match." };

/** Add or change the email: the address to verify, plus the current password when an email is already set. */
export const requestEmailSchema = z.object({ email: emailSchema, currentPassword: z.string().max(128).optional() });
export const verifyEmailSchema = z.object({ email: emailSchema, code: otpCodeSchema });

/** Signed in, no old password: the emailed code authorises the new password. */
export const changePasswordWithOtpSchema = z
  .object({ code: otpCodeSchema, newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((d) => d.newPassword === d.confirmPassword, passwordsMatch);

/** Signed out: who (username or verified email), the emailed code, and the new password. */
export const identifierSchema = z.string().transform(normalizeUsername).pipe(z.string().min(1, "Enter your username or email.").max(254));
export const resetPasswordSchema = z
  .object({ identifier: identifierSchema, code: otpCodeSchema, newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((d) => d.newPassword === d.confirmPassword, passwordsMatch);

/** `username` is a username or, when it contains "@", a verified email address. */
export const loginSchema = z.object({
  username: z.string().transform(normalizeUsername).pipe(z.string().min(1, "Enter your username or email.").max(254)),
  password: z.string().min(1, "Enter your password.").max(128),
});

const isoDate = z.iso.datetime({ offset: true }).optional().nullable();

export const FEEDBACK_CATEGORIES = ["incorrect", "incomplete", "outdated", "unclear", "other"] as const;
export const VERDICTS = ["correct", "needs_improvement", "unsure"] as const;

export const reviewSchema = z
  .object({
    clientEventId: z.string().min(8).max(64),
    versionId: z.number().int().positive(),
    /** daily (default): the answer belongs to today's deck. browse: answered while browsing, no deck. */
    source: z.enum(["daily", "browse"]).optional().default("daily"),
    deckDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    deckId: z.number().int().positive().optional().nullable(),
    knewIt: z.boolean(),
    verdict: z.enum(VERDICTS),
    shownAt: isoDate,
    flippedAt: isoDate,
    answeredAt: isoDate,
    device: z.string().max(40).optional().nullable(),
    /** true when this changes the answer already given to the card in today's deck (no read-time lock, no new answer counted) */
    edit: z.boolean().optional(),
    /** time the card was actually on screen and attended to (hidden tab / idle time already removed) */
    activeMs: z.number().int().min(0).max(3_600_000).optional().nullable(),
    feedback: z
      .object({
        category: z.enum(FEEDBACK_CATEGORIES),
        suggestedText: z.string().max(5000).optional().nullable(),
        comment: z.string().max(2000).optional().nullable(),
      })
      .optional()
      .nullable(),
  })
  .refine((r) => r.source === "browse" || !!r.deckDate, { path: ["deckDate"], message: "Missing deck date." })
  .refine((r) => r.verdict !== "needs_improvement" || !!r.feedback || r.source === "browse", {
    path: ["feedback"],
    message: "Choose what needs improving.",
  });

export const CLIENT_EVENT_TYPES = [
  "deck_started",
  "card_shown",
  "card_flipped",
  "card_skipped",
  "knew_answered",
  "statement_answered",
  "feedback_opened",
  "feedback_cancelled",
  "deck_summary_viewed",
  "browse_search",
  "browse_flip",
] as const;

/** Largest accepted event payload, serialised. Real payloads are a few short fields. */
export const MAX_EVENT_PAYLOAD_BYTES = 2048;
const eventPayload = z
  .record(z.string(), z.unknown())
  .refine((p) => JSON.stringify(p).length <= MAX_EVENT_PAYLOAD_BYTES, { message: "Event payload too large." });

export const eventsSchema = z.object({
  events: z
    .array(
      z.object({
        clientEventId: z.string().min(8).max(64),
        type: z.enum(CLIENT_EVENT_TYPES),
        versionId: z.number().int().positive().optional().nullable(),
        at: isoDate,
        payload: eventPayload.optional(),
      }),
    )
    .min(1)
    .max(100),
});
