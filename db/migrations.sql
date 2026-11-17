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
