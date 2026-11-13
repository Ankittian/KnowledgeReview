-- Reporting views. Re-created on every `npm run db:migrate` (drop + create, so column changes are safe).
-- They hold no data: they only combine card_reviews, card_feedback and the KB tables into scores.
-- All traceability to YAML (item type/key, yaml_file, field, linked forms/processes) lives here, server-side only.

DROP VIEW IF EXISTS needs_change CASCADE;
DROP VIEW IF EXISTS kb_item_health CASCADE;
DROP VIEW IF EXISTS card_health CASCADE;
DROP VIEW IF EXISTS user_knowledge CASCADE;

-- One row per card, current version only, each user's latest verdict counted once.
-- Admin reliability weight bonus +0.25.
CREATE VIEW card_health AS
WITH answers AS (
    SELECT r.id, r.user_id, r.knew_it, r.verdict, r.created_at, r.card_version_id, cv.card_id
    FROM card_reviews r
    JOIN card_versions cv ON cv.id = r.card_version_id
), weight AS (
    SELECT u.id AS user_id,
           (0.5 + 0.5 * ((coalesce(sum(CASE WHEN a.knew_it THEN 1 ELSE 0 END), 0) + 2.5) / (count(a.id) + 5.0))
                + CASE WHEN ro.name = 'admin' THEN 0.25 ELSE 0 END)::numeric(6, 4) AS weight
    FROM users u
    JOIN roles ro ON ro.id = u.role_id
    LEFT JOIN answers a ON a.user_id = u.id
    GROUP BY u.id, ro.name
), latest AS (
    SELECT DISTINCT ON (a.user_id, a.card_id) a.*
    FROM answers a
    JOIN cards c ON c.id = a.card_id AND a.card_version_id = c.current_version_id
    ORDER BY a.user_id, a.card_id, a.created_at DESC, a.id DESC
), agg AS (
    SELECT l.card_id,
           count(*) AS reviewers,
           sum(CASE WHEN l.knew_it THEN 1 ELSE 0 END) AS knew,
           sum(CASE WHEN l.verdict = 'correct' THEN 1 ELSE 0 END) AS correct_votes,
           sum(CASE WHEN l.verdict = 'needs_improvement' THEN 1 ELSE 0 END) AS improve_votes,
           sum(CASE WHEN l.verdict = 'unsure' THEN 1 ELSE 0 END) AS unsure_votes,
           sum(CASE WHEN l.verdict = 'correct' THEN w.weight ELSE 0 END) AS correct_w,
           sum(CASE WHEN l.verdict = 'needs_improvement' THEN w.weight ELSE 0 END) AS improve_w,
           sum(CASE WHEN l.verdict = 'unsure' THEN w.weight ELSE 0 END) AS unsure_w
    FROM latest l
    JOIN weight w ON w.user_id = l.user_id
    GROUP BY l.card_id
), fb AS (
    SELECT cv.card_id,
           count(*) FILTER (WHERE f.status = 'open') AS open_feedback,
           count(*) AS total_feedback
    FROM card_feedback f
    JOIN card_versions cv ON cv.id = f.card_version_id
    GROUP BY cv.card_id
)
SELECT c.id AS card_id,
       c.kb_item_id,
       c.kind,
       c.source_field,
       i.module,
       c.audience,
       c.level,
       c.status,
       c.current_version_id,
       coalesce(a.reviewers, 0) AS reviewers,
       coalesce(a.knew, 0) AS knew,
       coalesce(a.correct_votes, 0) AS correct_votes,
       coalesce(a.improve_votes, 0) AS improve_votes,
       coalesce(a.unsure_votes, 0) AS unsure_votes,
       coalesce(a.correct_w, 0) AS correct_w,
       coalesce(a.improve_w, 0) AS improve_w,
       coalesce(a.unsure_w, 0) AS unsure_w,
       CASE WHEN coalesce(a.reviewers, 0) = 0 THEN NULL ELSE round(a.knew::numeric / a.reviewers, 4) END AS knew_rate,
       round((coalesce(a.improve_w, 0) + 0.25 * coalesce(a.unsure_w, 0))
             / (coalesce(a.correct_w, 0) + coalesce(a.improve_w, 0) + 0.25 * coalesce(a.unsure_w, 0) + 1), 4) AS needs_change_score,
       coalesce(fb.open_feedback, 0) AS open_feedback,
       coalesce(fb.total_feedback, 0) AS total_feedback,
       (coalesce(a.correct_votes, 0) > 0 AND coalesce(a.improve_votes, 0) > 0) AS conflicting
FROM cards c
JOIN kb_items i ON i.id = c.kb_item_id
LEFT JOIN agg a ON a.card_id = c.id
LEFT JOIN fb ON fb.card_id = c.id
-- only the cards users can actually be shown (generated, with an audience); legacy template cards are excluded
WHERE c.audience IS NOT NULL;

-- Per KB item (form, process, concept, rule...): its own cards PLUS every card linked to it
CREATE VIEW kb_item_health AS
WITH rel AS (
    SELECT c.kb_item_id AS target_id, c.id AS card_id FROM cards c
    UNION
    SELECT l.kb_item_id, l.card_id FROM card_related_items l
)
SELECT i.id AS kb_item_id, i.type, i.key, i.name, i.module, i.yaml_file, i.active,
       count(ch.card_id) AS cards,
       count(ch.card_id) FILTER (WHERE ch.reviewers > 0) AS cards_reviewed,
       coalesce(sum(ch.reviewers), 0) AS verdicts,
       coalesce(sum(ch.correct_votes), 0) AS correct_votes,
       coalesce(sum(ch.improve_votes), 0) AS improve_votes,
       coalesce(sum(ch.unsure_votes), 0) AS unsure_votes,
       coalesce(sum(ch.open_feedback), 0) AS open_feedback,
       count(ch.card_id) FILTER (WHERE ch.improve_votes > 0) AS cards_flagged,
       CASE WHEN coalesce(sum(ch.reviewers), 0) = 0 THEN NULL ELSE round(sum(ch.knew)::numeric / sum(ch.reviewers), 4) END AS knew_rate,
       round((coalesce(sum(ch.improve_w), 0) + 0.25 * coalesce(sum(ch.unsure_w), 0))
             / (coalesce(sum(ch.correct_w), 0) + coalesce(sum(ch.improve_w), 0) + 0.25 * coalesce(sum(ch.unsure_w), 0) + 1), 4) AS needs_change_score
FROM kb_items i
LEFT JOIN rel ON rel.target_id = i.id
LEFT JOIN card_health ch ON ch.card_id = rel.card_id AND ch.status = 'active'
GROUP BY i.id, i.type, i.key, i.name, i.module, i.yaml_file, i.active;

-- The actionable list: one row per card (= YAML file + key + field) that someone flagged.
CREATE VIEW needs_change AS
SELECT i.type AS entity_type,
       i.key AS entity_key,
       i.name AS entity_name,
       i.module,
       i.yaml_file,
       ch.source_field AS field,
       ch.card_id,
       ch.kind,
       cv.version AS card_version,
       cv.source_text AS current_text,
       ch.reviewers,
       ch.correct_votes,
       ch.improve_votes,
       ch.unsure_votes,
       ch.knew_rate,
       ch.needs_change_score,
       ch.open_feedback,
       ch.conflicting,
       coalesce((SELECT array_agg(DISTINCT le.key ORDER BY le.key) FROM card_related_items l JOIN kb_items le ON le.id = l.kb_item_id
                 WHERE l.card_id = ch.card_id AND le.type IN ('form', 'usercontrol')), '{}') AS linked_forms,
       coalesce((SELECT array_agg(DISTINCT le.key ORDER BY le.key) FROM card_related_items l JOIN kb_items le ON le.id = l.kb_item_id
                 WHERE l.card_id = ch.card_id AND le.type = 'process'), '{}') AS linked_processes,
       coalesce((SELECT array_agg(DISTINCT le.key ORDER BY le.key) FROM card_related_items l JOIN kb_items le ON le.id = l.kb_item_id
                 WHERE l.card_id = ch.card_id AND le.type = 'rule'), '{}') AS linked_rules,
       coalesce((SELECT array_agg(DISTINCT le.key ORDER BY le.key) FROM card_related_items l JOIN kb_items le ON le.id = l.kb_item_id
                 WHERE l.card_id = ch.card_id AND le.type = 'concept'), '{}') AS linked_concepts,
       coalesce((SELECT json_agg(json_build_object(
                     'feedback_id', f.id, 'category', f.category, 'suggested_text', f.suggested_text, 'comment', f.comment,
                     'status', f.status, 'username', u.username, 'card_version_id', f.card_version_id, 'created_at', f.created_at)
                     ORDER BY f.created_at)
                 FROM card_feedback f
                 JOIN card_versions fv ON fv.id = f.card_version_id
                 JOIN users u ON u.id = f.user_id
                 WHERE fv.card_id = ch.card_id AND f.status IN ('open', 'accepted')), '[]'::json) AS suggestions
FROM card_health ch
JOIN kb_items i ON i.id = ch.kb_item_id
JOIN card_versions cv ON cv.id = ch.current_version_id
WHERE ch.status = 'active' AND (ch.improve_votes > 0 OR ch.open_feedback > 0);

-- Employee knowledge per module AND per business process (scope = 'module' | 'process')
CREATE VIEW user_knowledge AS
WITH answers AS (
    SELECT r.user_id, r.knew_it, r.created_at, cv.card_id,
           exp(-extract(epoch FROM (now() - r.created_at)) / 86400.0 / 30.0) AS w
    FROM card_reviews r
    JOIN card_versions cv ON cv.id = r.card_version_id
), by_module AS (
    SELECT a.user_id, 'module'::text AS scope, coalesce(i.module, '-') AS scope_key, coalesce(i.module, '-') AS scope_name, a.card_id, a.knew_it, a.created_at, a.w
    FROM answers a JOIN cards c ON c.id = a.card_id JOIN kb_items i ON i.id = c.kb_item_id
), process_cards AS (
    SELECT c.kb_item_id AS process_id, c.id AS card_id FROM cards c JOIN kb_items p ON p.id = c.kb_item_id AND p.type = 'process'
    UNION
    SELECT l.kb_item_id, l.card_id FROM card_related_items l JOIN kb_items p ON p.id = l.kb_item_id AND p.type = 'process'
), by_process AS (
    SELECT a.user_id, 'process'::text, p.key, p.name, a.card_id, a.knew_it, a.created_at, a.w
    FROM answers a JOIN process_cards pc ON pc.card_id = a.card_id JOIN kb_items p ON p.id = pc.process_id
), totals AS (
    SELECT coalesce(i.module, '-') AS module, count(*) AS total_cards
    FROM cards c JOIN kb_items i ON i.id = c.kb_item_id WHERE c.status = 'active' GROUP BY 1
), scoped AS (
    SELECT * FROM by_module UNION ALL SELECT * FROM by_process
)
SELECT s.user_id, s.scope, s.scope_key, s.scope_name,
       count(*) AS reviews,
       count(DISTINCT s.card_id) AS cards_seen,
       max(t.total_cards) AS total_cards,
       round(count(DISTINCT s.card_id)::numeric / nullif(max(t.total_cards), 0), 4) AS coverage,
       round((sum(CASE WHEN s.knew_it THEN s.w ELSE 0 END) / nullif(sum(s.w), 0))::numeric, 4) AS knowledge,
       round(avg(CASE WHEN s.knew_it THEN 1.0 ELSE 0.0 END), 4) AS knew_rate_all_time,
       max(s.created_at) AS last_review_at
FROM scoped s
LEFT JOIN totals t ON s.scope = 'module' AND t.module = s.scope_key
GROUP BY s.user_id, s.scope, s.scope_key, s.scope_name;
