import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();

// ================================================================ auth

export const userStatus = pgEnum("user_status", ["pending", "active", "disabled"]);

/** Answer style (Claude skill). General users have one, set by an admin (null = default); admins pick one per conversation. */
export const answerRole = pgEnum("answer_role", ["technical", "functional", "product"]);

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // admin | functional | technical
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(), // stored lower-case
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  department: text("department"),
  primaryModule: text("primary_module"), // module code, e.g. MM
  answerRole: answerRole("answer_role"), // chat answer style set by an admin; null = default (functional)
  roleId: integer("role_id")
    .notNull()
    .references(() => roles.id),
  status: userStatus("status").notNull().default("active"),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
});

/** One row per sign-in (its id is the JWT `sid` claim). */
export const loginSessions = pgTable(
  "login_sessions",
  {
    id: text("id").primaryKey(), // sha256(token); the raw token only lives in the cookie
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(), // absolute expiry of the sign-in
    createdAt: createdAt(),
  },
  (t) => [index("login_sessions_user_idx").on(t.userId)],
);

/**
 * Rotating refresh tokens of a login session (user and absolute expiry come from the session). Every refresh marks the
 * presented token as used and inserts a new one. Presenting a used token again (outside the short grace window)
 * means it was stolen, so the whole session is deleted. Only the sha256 of the token is stored.
 */
export const refreshTokens = pgTable(
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
export const activityLog = pgTable(
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

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ================================================================ kb

export const kbItemType = pgEnum("kb_item_type", ["module", "concept", "rule", "form", "usercontrol", "process"]);

/** One row per YAML item. This is the unit that "needs change". */
export const kbItems = pgTable(
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

export const cardStatus = pgEnum("card_status", ["active", "retired", "draft"]);
/** Who a generated card is written for. NULL = a legacy template card (kept for history, never served). */
export const cardAudience = pgEnum("card_audience", ["functional", "technical"]);
export const cardLevel = pgEnum("card_level", ["easy", "medium", "hard"]);

export const cards = pgTable(
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

export const cardVersions = pgTable(
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
export const cardRelatedItems = pgTable(
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

export const verdict = pgEnum("verdict", ["correct", "needs_improvement", "unsure"]);
export const feedbackCategory = pgEnum("feedback_category", ["incorrect", "incomplete", "outdated", "unclear", "other"]);
export const feedbackStatus = pgEnum("feedback_status", ["open", "accepted", "rejected", "applied", "stale"]);

/** Leitner-box schedule: when a user should see a card again. */
export const reviewSchedule = pgTable(
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
export const dailyDecks = pgTable(
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
export const deckCards = pgTable(
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
export const cardReviews = pgTable(
  "card_reviews",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    cardVersionId: integer("card_version_id")
      .notNull()
      .references(() => cardVersions.id),
    /** null for answers given while browsing (they are not part of a daily deck) */
    deckId: integer("deck_id").references(() => dailyDecks.id),
    /** daily = answered from today's deck; browse = answered while browsing (scores, but not in the daily deck) */
    source: text("source").notNull().default("daily"),
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
export const cardFeedback = pgTable(
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
export const roleIdOf = (name: string) => sql<number>`(SELECT id FROM roles WHERE name = ${name})`;

// ---------------------------------------------------------------- knowledge assistant (chat)

export const chatSender = pgEnum("chat_sender", ["user", "assistant"]);
/** streaming = answer still being written; stopped = user pressed Stop (partial text kept). */
export const chatMessageStatus = pgEnum("chat_message_status", ["ok", "streaming", "stopped", "error"]);
export const chatFeedbackValue = pgEnum("chat_feedback_value", ["up", "down"]);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    roleUsed: answerRole("role_used").notNull(), // fixed for the whole conversation
    claudeSessionId: text("claude_session_id"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"), // soft delete: kept for admins and the audit trail
  },
  (t) => [index("conversations_user_idx").on(t.userId, t.updatedAt)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    sender: chatSender("sender").notNull(),
    /** For assistant messages: the user message being answered (a retry adds another answer to the same question). */
    replyToId: bigint("reply_to_id", { mode: "number" }),
    content: text("content").notNull().default(""),
    status: chatMessageStatus("status").notNull().default("ok"),
    errorCode: text("error_code"), // timeout | usage_limit | kb_unavailable | claude_unavailable | error
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    durationMs: integer("duration_ms"),
    numTurns: integer("num_turns"),
    model: text("model"),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [index("chat_messages_conv_idx").on(t.conversationId, t.id), index("chat_messages_created_idx").on(t.sender, t.createdAt)],
);

/** Every tool call Claude made or tried, including denied attempts. */
export const chatToolCalls = pgTable(
  "chat_tool_calls",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    messageId: bigint("message_id", { mode: "number" })
      .notNull()
      .references(() => chatMessages.id),
    toolUseId: text("tool_use_id"),
    toolName: text("tool_name").notNull(),
    arguments: jsonb("arguments").$type<Record<string, unknown>>().notNull().default({}),
    allowed: boolean("allowed").notNull(),
    isError: boolean("is_error"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("chat_tool_calls_msg_idx").on(t.messageId), index("chat_tool_calls_denied_idx").on(t.allowed, t.createdAt)],
);

export const chatFeedback = pgTable(
  "chat_feedback",
  {
    id: serial("id").primaryKey(),
    messageId: bigint("message_id", { mode: "number" })
      .notNull()
      .references(() => chatMessages.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    value: chatFeedbackValue("value").notNull(),
    comment: text("comment"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("chat_feedback_msg_user").on(t.messageId, t.userId)],
);
