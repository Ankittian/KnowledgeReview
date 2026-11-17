-- Idempotent upgrades for databases created from an OLDER db/schema.sql. Applied on every `npm run db:init`,
-- before db/views.sql. A fresh database already gets these columns from db/schema.sql, so each statement is a no-op there.
-- Add new statements at the end; every one must be safe to run repeatedly.

-- card_related_items: graph node id (`form:fGRN`) and graph element id (`4:<uuid>:<number>`) of the linked node.
-- Both are nullable: a link whose element id is not known simply keeps NULL.
ALTER TABLE card_related_items ADD COLUMN IF NOT EXISTS node_id text;
ALTER TABLE card_related_items ADD COLUMN IF NOT EXISTS element_id text;

-- node_id follows from the linked kb_item (type:key is the graph id convention), but ONLY for generated cards' `source`
-- links: those were written from graph nodes. Cards that were not curated from the knowledge graph (the older YAML
-- template cards, audience IS NULL) keep NULL, because they have no graph node to point at. Only fills rows still NULL.
UPDATE card_related_items l SET node_id = k.type || ':' || k.key
  FROM kb_items k, cards c
  WHERE k.id = l.kb_item_id AND c.id = l.card_id AND c.audience IS NOT NULL AND l.relation = 'source' AND l.node_id IS NULL;

-- Email on every account (added and verified with a one-time code) and the one-time codes themselves.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  purpose text NOT NULL,
  code_hash text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS email_otps_user_idx ON email_otps (user_id, purpose, created_at);

-- chat_feedback: one thumbs up/down per (message, user). The feedback upsert (ON CONFLICT) needs this unique index; databases
-- created from an older schema do not have it. Fresh databases already get it from db/schema.sql.
CREATE UNIQUE INDEX IF NOT EXISTS chat_feedback_msg_user ON chat_feedback (message_id, user_id);

-- Saved SMTP connections for the one-time-code emails (Admin > Settings & exports > Email). At most one is active.
CREATE TABLE IF NOT EXISTS mail_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  host text NOT NULL,
  port integer NOT NULL,
  security text DEFAULT 'starttls' NOT NULL,
  username text DEFAULT '' NOT NULL,
  password_enc text,
  from_name text DEFAULT '' NOT NULL,
  from_email text NOT NULL,
  is_active boolean DEFAULT false NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS mail_connections_name_unique ON mail_connections (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS mail_connections_one_active ON mail_connections (is_active) WHERE is_active;

-- Second knowledge-graph MCP (docs/plans/PLAN-kg-mcp-new.md D1, D2): the KB a conversation uses (fixed per chat) and the
-- per-user permission to choose SpectrumERP-new. Existing conversations become 'spectrumerp'; existing users get false.
-- Kept on ONE line: db/client.ts splitSql() cuts statements at a ';' that ends a line.
DO $$ BEGIN CREATE TYPE "public"."kb_source" AS ENUM('spectrumerp', 'spectrumerp_new'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS kb_source kb_source NOT NULL DEFAULT 'spectrumerp';
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_use_kg_new boolean NOT NULL DEFAULT false;

-- Intent classifier (docs/INTENT-CLASSIFIER.md): the category that made the classifier refuse a question
-- (jailbreak | out_of_domain | restricted_object | classifier_error). NULL = answered normally.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS blocked_category text;

-- Card generation from the admin UI: jobs, the cards waiting for review, and in-app notifications.
CREATE TABLE IF NOT EXISTS card_generation_jobs (
	id serial PRIMARY KEY NOT NULL,
	requested_by uuid NOT NULL,
	level text NOT NULL,
	params jsonb NOT NULL,
	status text DEFAULT 'queued' NOT NULL,
	progress jsonb DEFAULT '{"done":0,"total":0}'::jsonb NOT NULL,
	report jsonb DEFAULT '{}'::jsonb NOT NULL,
	file_paths text[] DEFAULT ARRAY[]::text[] NOT NULL,
	model text,
	input_tokens integer DEFAULT 0 NOT NULL,
	output_tokens integer DEFAULT 0 NOT NULL,
	cancel_requested boolean DEFAULT false NOT NULL,
	error text,
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	started_at timestamp with time zone,
	finished_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS card_generation_jobs_status_idx ON card_generation_jobs USING btree (status, created_at);
CREATE TABLE IF NOT EXISTS generated_cards (
	id serial PRIMARY KEY NOT NULL,
	job_id integer NOT NULL REFERENCES card_generation_jobs(id) ON DELETE cascade,
	module text NOT NULL,
	scope text NOT NULL,
	group_key text NOT NULL,
	group_title text NOT NULL,
	context text,
	level card_level NOT NULL,
	topic_key text NOT NULL,
	title text NOT NULL,
	body text NOT NULL,
	source_refs text[] DEFAULT ARRAY[]::text[] NOT NULL,
	status text DEFAULT 'draft' NOT NULL,
	edited boolean DEFAULT false NOT NULL,
	warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS generated_cards_job_idx ON generated_cards USING btree (job_id, group_key);
CREATE TABLE IF NOT EXISTS notifications (
	id serial PRIMARY KEY NOT NULL,
	user_id uuid NOT NULL,
	kind text NOT NULL,
	job_id integer,
	message text NOT NULL,
	read_at timestamp with time zone,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications USING btree (user_id, read_at, created_at);
