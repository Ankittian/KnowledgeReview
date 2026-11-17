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
