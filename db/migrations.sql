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

-- Saved SMTP connections for the one-time-code emails (Admin > Email settings). At most one is active.
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
