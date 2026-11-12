CREATE TYPE "public"."card_status" AS ENUM('active', 'retired', 'draft');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('module', 'concept', 'rule', 'form', 'usercontrol', 'process');--> statement-breakpoint
CREATE TYPE "public"."feedback_category" AS ENUM('incorrect', 'incomplete', 'outdated', 'unclear', 'other');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('open', 'accepted', 'rejected', 'applied', 'stale');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('employee', 'reviewer', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('correct', 'needs_improvement', 'unsure');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_links" (
	"card_id" text NOT NULL,
	"entity_id" integer NOT NULL,
	"relation" text NOT NULL,
	CONSTRAINT "card_links_card_id_entity_id_relation_pk" PRIMARY KEY("card_id","entity_id","relation")
);
--> statement-breakpoint
CREATE TABLE "card_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"version" integer NOT NULL,
	"context" text NOT NULL,
	"front" text NOT NULL,
	"back" text NOT NULL,
	"source_text" text NOT NULL,
	"source_hash" text NOT NULL,
	"generated_by" text DEFAULT 'template' NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_versions_card_version" UNIQUE("card_id","version")
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"kind" text NOT NULL,
	"source_field" text NOT NULL,
	"module" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "card_status" DEFAULT 'active' NOT NULL,
	"current_version_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_decks" (
	"user_id" uuid NOT NULL,
	"deck_date" date NOT NULL,
	"card_ids" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "daily_decks_user_id_deck_date_pk" PRIMARY KEY("user_id","deck_date")
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" bigint,
	"user_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"card_version_id" integer NOT NULL,
	"entity_id" integer NOT NULL,
	"source_field" text NOT NULL,
	"category" "feedback_category" NOT NULL,
	"current_text" text NOT NULL,
	"suggested_text" text,
	"comment" text,
	"status" "feedback_status" DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"applied_commit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interaction_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"card_id" text,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"session_id" text,
	"user_agent" text,
	"ip" text,
	"client_event_id" text,
	"occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interaction_events_client_event_id_unique" UNIQUE("client_event_id")
);
--> statement-breakpoint
CREATE TABLE "kb_entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "entity_type" NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"module" text,
	"yaml_file" text NOT NULL,
	"content_hash" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_entities_type_key" UNIQUE("type","key")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"card_version_id" integer NOT NULL,
	"entity_id" integer NOT NULL,
	"source_field" text NOT NULL,
	"deck_date" date,
	"knew_it" boolean NOT NULL,
	"verdict" "verdict" NOT NULL,
	"shown_at" timestamp with time zone,
	"flipped_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"time_to_flip_ms" integer,
	"time_to_answer_ms" integer,
	"device" text,
	"client_event_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_client_event_id_unique" UNIQUE("client_event_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srs_state" (
	"user_id" uuid NOT NULL,
	"card_id" text NOT NULL,
	"box" integer DEFAULT 1 NOT NULL,
	"due_date" date NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	CONSTRAINT "srs_state_user_id_card_id_pk" PRIMARY KEY("user_id","card_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"department" text,
	"primary_module" text,
	"role" "user_role" DEFAULT 'employee' NOT NULL,
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "card_links" ADD CONSTRAINT "card_links_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_links" ADD CONSTRAINT "card_links_entity_id_kb_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."kb_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_versions" ADD CONSTRAINT "card_versions_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_entity_id_kb_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."kb_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_decks" ADD CONSTRAINT "daily_decks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_card_version_id_card_versions_id_fk" FOREIGN KEY ("card_version_id") REFERENCES "public"."card_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_entity_id_kb_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."kb_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_card_version_id_card_versions_id_fk" FOREIGN KEY ("card_version_id") REFERENCES "public"."card_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_entity_id_kb_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."kb_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "srs_state" ADD CONSTRAINT "srs_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "srs_state" ADD CONSTRAINT "srs_state_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_links_entity_idx" ON "card_links" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "cards_entity_idx" ON "cards" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "cards_module_idx" ON "cards" USING btree ("module","status");--> statement-breakpoint
CREATE INDEX "feedback_entity_idx" ON "feedback" USING btree ("entity_id","status");--> statement-breakpoint
CREATE INDEX "feedback_status_idx" ON "feedback" USING btree ("status");--> statement-breakpoint
CREATE INDEX "events_user_idx" ON "interaction_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "interaction_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "reviews_user_idx" ON "reviews" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_card_idx" ON "reviews" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "reviews_entity_idx" ON "reviews" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_user_card_day" ON "reviews" USING btree ("user_id","card_id","deck_date");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "srs_due_idx" ON "srs_state" USING btree ("user_id","due_date");