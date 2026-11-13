DROP VIEW IF EXISTS public.v_needs_change, public.v_rollup_health, public.v_entity_health, public.v_card_health, public.v_reviewer_weight, public.v_user_knowledge_module, public.v_user_knowledge_process CASCADE;
--> statement-breakpoint
CREATE SCHEMA auth;
--> statement-breakpoint
CREATE SCHEMA kb;
--> statement-breakpoint
CREATE SCHEMA learning;
--> statement-breakpoint
-- ============ auth: roles + users
CREATE TABLE auth.roles (id serial PRIMARY KEY, name text NOT NULL UNIQUE);
--> statement-breakpoint
INSERT INTO auth.roles (name) VALUES ('employee'), ('reviewer'), ('admin');
--> statement-breakpoint
ALTER TYPE public.user_status SET SCHEMA auth;
--> statement-breakpoint
ALTER TABLE public.users SET SCHEMA auth;
--> statement-breakpoint
ALTER TABLE auth.users ADD COLUMN role_id integer;
--> statement-breakpoint
UPDATE auth.users u SET role_id = r.id FROM auth.roles r WHERE r.name = u.role::text;
--> statement-breakpoint
ALTER TABLE auth.users ALTER COLUMN role_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE auth.users ADD CONSTRAINT users_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES auth.roles(id);
--> statement-breakpoint
ALTER TABLE auth.users DROP COLUMN role, DROP COLUMN approved_by, DROP COLUMN approved_at;
--> statement-breakpoint
DROP TYPE public.user_role;
--> statement-breakpoint
-- ============ auth: login sessions + refresh tokens
ALTER TABLE public.sessions SET SCHEMA auth;
--> statement-breakpoint
ALTER TABLE auth.sessions RENAME TO login_sessions;
--> statement-breakpoint
ALTER INDEX auth.sessions_user_idx RENAME TO login_sessions_user_idx;
--> statement-breakpoint
ALTER TABLE public.refresh_tokens SET SCHEMA auth;
--> statement-breakpoint
ALTER TABLE auth.refresh_tokens DROP COLUMN user_id, DROP COLUMN expires_at, DROP COLUMN ip, DROP COLUMN user_agent;
--> statement-breakpoint
-- ============ auth: one activity log (was interaction_events + audit_log), settings
CREATE TABLE auth.activity_log (id bigserial PRIMARY KEY, user_id uuid, action text NOT NULL, target_type text, target_id text, details jsonb NOT NULL DEFAULT '{}'::jsonb, session_id text, ip text, client_event_id text UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
INSERT INTO auth.activity_log (user_id, action, target_type, target_id, details, session_id, ip, client_event_id, created_at) SELECT user_id, action, target_type, target_id, details, session_id, ip, client_event_id, created_at FROM (SELECT user_id, event_type AS action, CASE WHEN card_id IS NULL THEN NULL ELSE 'card' END AS target_type, card_id AS target_id, CASE WHEN occurred_at IS NULL THEN payload ELSE payload || jsonb_build_object('occurred_at', occurred_at) END AS details, session_id, ip, client_event_id, created_at FROM public.interaction_events UNION ALL SELECT actor_id, action, target_type, target_id, details, NULL, NULL, NULL, created_at FROM public.audit_log) x ORDER BY created_at;
--> statement-breakpoint
CREATE INDEX activity_log_user_idx ON auth.activity_log (user_id, created_at);
--> statement-breakpoint
CREATE INDEX activity_log_action_idx ON auth.activity_log (action, created_at);
--> statement-breakpoint
DROP TABLE public.interaction_events;
--> statement-breakpoint
DROP TABLE public.audit_log;
--> statement-breakpoint
ALTER TABLE public.settings SET SCHEMA auth;
--> statement-breakpoint
ALTER TABLE auth.settings RENAME TO app_settings;
--> statement-breakpoint
-- ============ kb
ALTER TYPE public.entity_type SET SCHEMA kb;
--> statement-breakpoint
ALTER TYPE kb.entity_type RENAME TO kb_item_type;
--> statement-breakpoint
ALTER TYPE public.card_status SET SCHEMA kb;
--> statement-breakpoint
ALTER TABLE public.kb_entities SET SCHEMA kb;
--> statement-breakpoint
ALTER TABLE kb.kb_entities RENAME TO kb_items;
--> statement-breakpoint
ALTER TABLE kb.kb_items RENAME CONSTRAINT kb_entities_type_key TO kb_items_type_key;
--> statement-breakpoint
ALTER TABLE kb.kb_items DROP COLUMN last_synced_at;
--> statement-breakpoint
ALTER TABLE public.cards SET SCHEMA kb;
--> statement-breakpoint
ALTER TABLE kb.cards RENAME COLUMN entity_id TO kb_item_id;
--> statement-breakpoint
ALTER TABLE kb.cards DROP COLUMN module, DROP COLUMN tags, DROP COLUMN updated_at;
--> statement-breakpoint
ALTER INDEX kb.cards_entity_idx RENAME TO cards_kb_item_idx;
--> statement-breakpoint
CREATE INDEX cards_status_idx ON kb.cards (status);
--> statement-breakpoint
ALTER TABLE public.card_versions SET SCHEMA kb;
--> statement-breakpoint
ALTER TABLE kb.card_versions DROP COLUMN generated_by, DROP COLUMN approved_by;
--> statement-breakpoint
ALTER TABLE public.card_links SET SCHEMA kb;
--> statement-breakpoint
ALTER TABLE kb.card_links RENAME TO card_related_items;
--> statement-breakpoint
ALTER TABLE kb.card_related_items RENAME COLUMN entity_id TO kb_item_id;
--> statement-breakpoint
ALTER INDEX kb.card_links_entity_idx RENAME TO card_related_items_item_idx;
--> statement-breakpoint
-- ============ learning
ALTER TYPE public.verdict SET SCHEMA learning;
--> statement-breakpoint
ALTER TYPE public.feedback_category SET SCHEMA learning;
--> statement-breakpoint
ALTER TYPE public.feedback_status SET SCHEMA learning;
--> statement-breakpoint
ALTER TABLE public.srs_state SET SCHEMA learning;
--> statement-breakpoint
ALTER TABLE learning.srs_state RENAME TO review_schedule;
--> statement-breakpoint
ALTER TABLE learning.review_schedule DROP COLUMN last_reviewed_at;
--> statement-breakpoint
ALTER INDEX learning.srs_due_idx RENAME TO review_schedule_due_idx;
--> statement-breakpoint
ALTER TABLE public.daily_decks SET SCHEMA learning;
--> statement-breakpoint
CREATE TABLE learning.deck_cards (deck_id integer NOT NULL REFERENCES learning.daily_decks(id) ON DELETE CASCADE, card_id text NOT NULL REFERENCES kb.cards(id), position integer NOT NULL, PRIMARY KEY (deck_id, card_id));
--> statement-breakpoint
INSERT INTO learning.deck_cards (deck_id, card_id, position) SELECT d.id, c.card_id, c.ord - 1 FROM learning.daily_decks d, unnest(d.card_ids) WITH ORDINALITY AS c(card_id, ord) ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE INDEX deck_cards_card_idx ON learning.deck_cards (card_id);
--> statement-breakpoint
ALTER TABLE learning.daily_decks DROP COLUMN card_ids;
--> statement-breakpoint
ALTER TABLE public.reviews SET SCHEMA learning;
--> statement-breakpoint
ALTER TABLE learning.reviews RENAME TO card_reviews;
--> statement-breakpoint
ALTER TABLE learning.card_reviews DROP COLUMN card_id, DROP COLUMN entity_id, DROP COLUMN source_field, DROP COLUMN deck_date, DROP COLUMN time_to_flip_ms, DROP COLUMN time_to_answer_ms, DROP COLUMN device;
--> statement-breakpoint
ALTER TABLE learning.card_reviews ALTER COLUMN deck_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE learning.card_reviews ADD CONSTRAINT card_reviews_deck_id_daily_decks_id_fk FOREIGN KEY (deck_id) REFERENCES learning.daily_decks(id);
--> statement-breakpoint
ALTER INDEX learning.reviews_user_idx RENAME TO card_reviews_user_idx;
--> statement-breakpoint
CREATE INDEX card_reviews_version_idx ON learning.card_reviews (card_version_id);
--> statement-breakpoint
CREATE UNIQUE INDEX card_reviews_deck_version ON learning.card_reviews (deck_id, card_version_id);
--> statement-breakpoint
ALTER TABLE public.feedback SET SCHEMA learning;
--> statement-breakpoint
ALTER TABLE learning.feedback RENAME TO card_feedback;
--> statement-breakpoint
ALTER TABLE learning.card_feedback DROP COLUMN card_id, DROP COLUMN entity_id, DROP COLUMN source_field, DROP COLUMN current_text;
--> statement-breakpoint
ALTER INDEX learning.feedback_status_idx RENAME TO card_feedback_status_idx;
--> statement-breakpoint
CREATE INDEX card_feedback_version_idx ON learning.card_feedback (card_version_id, status);
