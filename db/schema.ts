import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Three modules, one Postgres schema each. Every table holds a fact once; anything derivable by a join is not stored.
 *   auth      who can sign in, and what they did (users, roles, login sessions, activity log, settings)
 *   kb        the knowledge base and the flashcards built from it
 *   learning  what employees did with the cards (decks, schedule, answers, feedback)
 * The connection's search_path is `auth, kb, learning, public` (see db/client.ts), so raw SQL can use bare table names.
 */
export const authSchema = pgSchema("auth");
export const kbSchema = pgSchema("kb");
export const learningSchema = pgSchema("learning");

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();

// ================================================================ auth

export const userStatus = authSchema.enum("user_status", ["pending", "active", "disabled"]);

export const roles = authSchema.table("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // employee | reviewer | admin
});

export const users = authSchema.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(), // stored lower-case
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  department: text("department"),
  primaryModule: text("primary_module"), // module code, e.g. MM
  roleId: integer("role_id")
    .notNull()
    .references(() => roles.id),
  status: userStatus("status").notNull().default("pending"),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
});

/** One row per sign-in (its id is the JWT `sid` claim). */
export const loginSessions = authSchema.table(
  "login_sessions",
  {
    id: text("id").primaryKey(), // sha256(token); the raw token only lives in the cookie
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(), // absolute expiry of the sign-in
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("login_sessions_user_idx").on(t.userId)],
);

/**
 * Rotating refresh tokens of a login session (user and absolute expiry come from the session). Every refresh marks the
 * presented token as used and inserts a new one. Presenting a used token again (outside the short grace window)
 * means it was stolen, so the whole session is deleted. Only the sha256 of the token is stored.
 */
export const refreshTokens = authSchema.table(
  "refresh_tokens",
  {
    id: text("id").primaryKey(), // sha256(token); the raw token only lives in the cookie
    sessionId: text("session_id")
      .notNull()
      .references(() => loginSessions.id, { onDelete: "cascade" }),
    idleExpiresAt: ts("idle_expires_at").notNull(), // extended on every refresh
    usedAt: ts("used_at"),
    replacedById: text("replaced_by_id"),
    createdAt: createdAt(),
  },
  (t) => [index("refresh_tokens_session_idx").on(t.sessionId)],
);

/** Append-only log of everything that happened: sign-ins, cards shown, answers, admin actions. */
export const activityLog = authSchema.table(
  "activity_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id"), // who did it; NULL for system events
    action: text("action").notNull(),
    targetType: text("target_type"), // card | user | feedback | setting | ...
    targetId: text("target_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    sessionId: text("session_id"),
    ip: text("ip"),
    clientEventId: text("client_event_id").unique(), // makes client retries idempotent
    createdAt: createdAt(),
  },
  (t) => [index("activity_log_user_idx").on(t.userId, t.createdAt), index("activity_log_action_idx").on(t.action, t.createdAt)],
);

export const appSettings = authSchema.table("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ================================================================ kb

export const kbItemType = kbSchema.enum("kb_item_type", ["module", "concept", "rule", "form", "usercontrol", "process"]);

/** One row per YAML item. This is the unit that "needs change". */
export const kbItems = kbSchema.table(
  "kb_items",
  {
    id: serial("id").primaryKey(),
    type: kbItemType("type").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    module: text("module"),
    yamlFile: text("yaml_file").notNull(),
    contentHash: text("content_hash").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    active: boolean("active").notNull().default(true),
  },
  (t) => [unique("kb_items_type_key").on(t.type, t.key)],
);

export const cardStatus = kbSchema.enum("card_status", ["active", "retired", "draft"]);
/** Who a generated card is written for. NULL = a legacy template card (kept for history, never served). */
export const cardAudience = kbSchema.enum("card_audience", ["functional", "technical"]);
export const cardLevel = kbSchema.enum("card_level", ["easy", "medium", "hard"]);

export const cards = kbSchema.table(
  "cards",
  {
    id: text("id").primaryKey(), // stable: {kind}:{source_key}[:{n}]
    kbItemId: integer("kb_item_id")
      .notNull()
      .references(() => kbItems.id),
    kind: text("kind").notNull(), // rule.summary, form.field, ...
    sourceField: text("source_field").notNull(), // YAML field the back text came from
    audience: cardAudience("audience"),
    level: cardLevel("level"),
    topicKey: text("topic_key"), // generated cards: identity = kb item + audience + level + topic
    status: cardStatus("status").notNull().default("active"),
    currentVersionId: integer("current_version_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("cards_kb_item_idx").on(t.kbItemId),
    index("cards_status_idx").on(t.status),
    uniqueIndex("cards_generated_identity").on(t.kbItemId, t.audience, t.level, t.topicKey).where(sql`${t.audience} IS NOT NULL`),
  ],
);

export const cardVersions = kbSchema.table(
  "card_versions",
  {
    id: serial("id").primaryKey(),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    version: integer("version").notNull(),
    context: text("context").notNull(), // subtitle above the question
    front: text("front").notNull(),
    back: text("back").notNull(),
    sourceText: text("source_text").notNull(), // raw YAML text of source_field (what an edit would change)
    sourceHash: text("source_hash").notNull(), // hash of context+front+back+source text: detects a change on sync
    createdAt: createdAt(),
  },
  (t) => [unique("card_versions_card_version").on(t.cardId, t.version)],
);

/** Card -> related YAML items (forms, processes, concepts, rules). Never exposed to employees. */
export const cardRelatedItems = kbSchema.table(
  "card_related_items",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    kbItemId: integer("kb_item_id")
      .notNull()
      .references(() => kbItems.id),
    relation: text("relation").notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.kbItemId, t.relation] }), index("card_related_items_item_idx").on(t.kbItemId)],
);

// ================================================================ learning

export const verdict = learningSchema.enum("verdict", ["correct", "needs_improvement", "unsure"]);
export const feedbackCategory = learningSchema.enum("feedback_category", ["incorrect", "incomplete", "outdated", "unclear", "other"]);
export const feedbackStatus = learningSchema.enum("feedback_status", ["open", "accepted", "rejected", "applied", "stale"]);

/** Leitner-box schedule: when a user should see a card again. */
export const reviewSchedule = learningSchema.table(
  "review_schedule",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    box: integer("box").notNull().default(1),
    dueDate: date("due_date").notNull(),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.cardId] }), index("review_schedule_due_idx").on(t.userId, t.dueDate)],
);

/**
 * A random set of cards generated at sign-in (one per session per day, topped up within the same session when it is
 * finished while the daily limit still has room). All decks of a day share the admin's daily card limit.
 */
export const dailyDecks = learningSchema.table(
  "daily_decks",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    deckDate: date("deck_date").notNull(),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [index("daily_decks_user_day_idx").on(t.userId, t.deckDate), index("daily_decks_session_idx").on(t.sessionId, t.deckDate)],
);

/** The cards of a deck, in the order they are shown. */
export const deckCards = learningSchema.table(
  "deck_cards",
  {
    deckId: integer("deck_id")
      .notNull()
      .references(() => dailyDecks.id, { onDelete: "cascade" }),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.deckId, t.cardId] }), index("deck_cards_card_idx").on(t.cardId)],
);

/**
 * One scored answer. The card, KB item and source field are reached through `card_version_id`; the date through the deck.
 * Timings are the differences of the three timestamps.
 */
export const cardReviews = learningSchema.table(
  "card_reviews",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    cardVersionId: integer("card_version_id")
      .notNull()
      .references(() => cardVersions.id),
    deckId: integer("deck_id")
      .notNull()
      .references(() => dailyDecks.id),
    knewIt: boolean("knew_it").notNull(),
    verdict: verdict("verdict").notNull(),
    shownAt: ts("shown_at"),
    flippedAt: ts("flipped_at"),
    answeredAt: ts("answered_at"),
    clientEventId: text("client_event_id").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    index("card_reviews_user_idx").on(t.userId, t.createdAt),
    index("card_reviews_version_idx").on(t.cardVersionId),
    uniqueIndex("card_reviews_deck_version").on(t.deckId, t.cardVersionId),
  ],
);

/** A user's suggestion to fix a card. The card, KB item and the text that was reviewed come from `card_version_id`. */
export const cardFeedback = learningSchema.table(
  "card_feedback",
  {
    id: serial("id").primaryKey(),
    reviewId: bigint("review_id", { mode: "number" }).references(() => cardReviews.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    cardVersionId: integer("card_version_id")
      .notNull()
      .references(() => cardVersions.id),
    category: feedbackCategory("category").notNull(),
    suggestedText: text("suggested_text"),
    comment: text("comment"),
    status: feedbackStatus("status").notNull().default("open"),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: ts("resolved_at"),
    resolutionNote: text("resolution_note"),
    appliedCommit: text("applied_commit"),
    createdAt: createdAt(),
  },
  (t) => [index("card_feedback_version_idx").on(t.cardVersionId, t.status), index("card_feedback_status_idx").on(t.status)],
);

/** `sql` fragment: the id of a role by name, for inserts/updates (roles are looked up, never hard-coded). */
export const roleIdOf = (name: string) => sql<number>`(SELECT id FROM auth.roles WHERE name = ${name})`;
