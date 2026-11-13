CREATE TYPE kb.card_audience AS ENUM ('functional', 'technical');
--> statement-breakpoint
CREATE TYPE kb.card_level AS ENUM ('easy', 'medium', 'hard');
--> statement-breakpoint
ALTER TABLE kb.cards ADD COLUMN audience kb.card_audience, ADD COLUMN level kb.card_level, ADD COLUMN topic_key text;
--> statement-breakpoint
CREATE UNIQUE INDEX cards_generated_identity ON kb.cards (kb_item_id, audience, level, topic_key) WHERE audience IS NOT NULL;
--> statement-breakpoint
INSERT INTO auth.roles (name) VALUES ('functional'), ('technical') ON CONFLICT (name) DO NOTHING;
