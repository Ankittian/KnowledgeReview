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

// ---------------------------------------------------------------- users & sessions

export const userRole = pgEnum("user_role", ["employee", "reviewer", "admin"]);
export const userStatus = pgEnum("user_status", ["pending", "active", "disabled"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(), // stored lower-case
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  department: text("department"),
  primaryModule: text("primary_module"), // module code, e.g. MM
  role: userRole("role").notNull().default("employee"),
  status: userStatus("status").notNull().default("pending"),
  approvedBy: uuid("approved_by"),
  approvedAt: ts("approved_at"),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256(token); the raw token only lives in the cookie
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------- knowledge base (backend-only traceability)

export const entityType = pgEnum("entity_type", ["module", "concept", "rule", "form", "usercontrol", "process"]);

/** One row per YAML item. This is the unit that "needs change". */
export const kbEntities = pgTable(
  "kb_entities",
  {
    id: serial("id").primaryKey(),
    type: entityType("type").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    module: text("module"),
    yamlFile: text("yaml_file").notNull(),
    contentHash: text("content_hash").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    lastSyncedAt: ts("last_synced_at").notNull().defaultNow(),
  },
  (t) => [unique("kb_entities_type_key").on(t.type, t.key)],
);

export const cardStatus = pgEnum("card_status", ["active", "retired", "draft"]);

export const cards = pgTable(
  "cards",
  {
    id: text("id").primaryKey(), // stable: {kind}:{source_key}[:{n}]
    entityId: integer("entity_id")
      .notNull()
      .references(() => kbEntities.id),
    kind: text("kind").notNull(), // rule.summary, form.field, ...
    sourceField: text("source_field").notNull(), // YAML field the back text came from
    module: text("module"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    status: cardStatus("status").notNull().default("active"),
    currentVersionId: integer("current_version_id"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("cards_entity_idx").on(t.entityId), index("cards_module_idx").on(t.module, t.status)],
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
    sourceHash: text("source_hash").notNull(),
    generatedBy: text("generated_by").notNull().default("template"), // template | llm
    approvedBy: uuid("approved_by"),
    createdAt: createdAt(),
  },
  (t) => [unique("card_versions_card_version").on(t.cardId, t.version)],
);

/** Card -> related YAML entities (forms, processes, concepts, rules). Never exposed to employees. */
export const cardLinks = pgTable(
  "card_links",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    entityId: integer("entity_id")
      .notNull()
      .references(() => kbEntities.id),
    relation: text("relation").notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.entityId, t.relation] }), index("card_links_entity_idx").on(t.entityId)],
);

// ---------------------------------------------------------------- spaced repetition & decks

export const srsState = pgTable(
  "srs_state",
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
    lastReviewedAt: ts("last_reviewed_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.cardId] }), index("srs_due_idx").on(t.userId, t.dueDate)],
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
    cardIds: text("card_ids").array().notNull(),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [index("daily_decks_user_day_idx").on(t.userId, t.deckDate), index("daily_decks_session_idx").on(t.sessionId, t.deckDate)],
);

// ---------------------------------------------------------------- reviews, feedback, events

export const verdict = pgEnum("verdict", ["correct", "needs_improvement", "unsure"]);

export const reviews = pgTable(
  "reviews",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    cardVersionId: integer("card_version_id")
      .notNull()
      .references(() => cardVersions.id),
    // stamped server-side so every verdict maps to a YAML file + key + field
    entityId: integer("entity_id")
      .notNull()
      .references(() => kbEntities.id),
    sourceField: text("source_field").notNull(),
    deckDate: date("deck_date"),
    deckId: integer("deck_id"), // which sign-in deck the answer came from
    knewIt: boolean("knew_it").notNull(),
    verdict: verdict("verdict").notNull(),
    shownAt: ts("shown_at"),
    flippedAt: ts("flipped_at"),
    answeredAt: ts("answered_at"),
    timeToFlipMs: integer("time_to_flip_ms"),
    timeToAnswerMs: integer("time_to_answer_ms"),
    device: text("device"),
    clientEventId: text("client_event_id").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    index("reviews_user_idx").on(t.userId, t.createdAt),
    index("reviews_card_idx").on(t.cardId),
    index("reviews_entity_idx").on(t.entityId),
    // one scored answer per card per daily deck (NULL deck_date = outside a deck, not constrained)
    uniqueIndex("reviews_user_card_day").on(t.userId, t.cardId, t.deckDate),
  ],
);

export const feedbackCategory = pgEnum("feedback_category", ["incorrect", "incomplete", "outdated", "unclear", "other"]);
export const feedbackStatus = pgEnum("feedback_status", ["open", "accepted", "rejected", "applied", "stale"]);

export const feedback = pgTable(
  "feedback",
  {
    id: serial("id").primaryKey(),
    reviewId: bigint("review_id", { mode: "number" }).references(() => reviews.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id),
    cardVersionId: integer("card_version_id")
      .notNull()
      .references(() => cardVersions.id),
    entityId: integer("entity_id")
      .notNull()
      .references(() => kbEntities.id),
    sourceField: text("source_field").notNull(),
    category: feedbackCategory("category").notNull(),
    currentText: text("current_text").notNull(),
    suggestedText: text("suggested_text"),
    comment: text("comment"),
    status: feedbackStatus("status").notNull().default("open"),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: ts("resolved_at"),
    resolutionNote: text("resolution_note"),
    appliedCommit: text("applied_commit"),
    createdAt: createdAt(),
  },
  (t) => [index("feedback_entity_idx").on(t.entityId, t.status), index("feedback_status_idx").on(t.status)],
);

/** Append-only log of every interaction. */
export const interactionEvents = pgTable(
  "interaction_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id"),
    cardId: text("card_id"),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    sessionId: text("session_id"),
    userAgent: text("user_agent"),
    ip: text("ip"),
    clientEventId: text("client_event_id").unique(),
    occurredAt: ts("occurred_at"),
    createdAt: createdAt(),
  },
  (t) => [index("events_user_idx").on(t.userId, t.createdAt), index("events_type_idx").on(t.eventType, t.createdAt)],
);

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
