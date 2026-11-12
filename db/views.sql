-- Reporting views. Re-created on every `npm run db:migrate` (drop + create, so column changes are safe).
-- All traceability to YAML (entity type/key, yaml_file, field, linked forms/processes) lives here, server-side only.

DROP VIEW IF EXISTS v_needs_change CASCADE;
DROP VIEW IF EXISTS v_rollup_health CASCADE;
DROP VIEW IF EXISTS v_entity_health CASCADE;
DROP VIEW IF EXISTS v_card_health CASCADE;
DROP VIEW IF EXISTS v_reviewer_weight CASCADE;
DROP VIEW IF EXISTS v_user_knowledge_module CASCADE;
DROP VIEW IF EXISTS v_user_knowledge_process CASCADE;

-- Reviewer reliability in [0.5, 1.25]: people who know the material are more credible judges of it.
-- knew-rate is shrunk toward 50% with a 5-review prior; reviewers/admins get +0.25.
CREATE VIEW v_reviewer_weight AS
SELECT u.id AS user_id,
       count(r.id) AS reviews,
       (0.5 + 0.5 * ((sum(CASE WHEN r.knew_it THEN 1 ELSE 0 END) + 2.5) / (count(r.id) + 5.0))
            + CASE WHEN u.role IN ('reviewer', 'admin') THEN 0.25 ELSE 0 END)::numeric(6, 4) AS weight
FROM users u
LEFT JOIN reviews r ON r.user_id = u.id
GROUP BY u.id, u.role;

-- Per card, current version only, each user's latest verdict counted once.
CREATE VIEW v_card_health AS
WITH latest AS (
    SELECT DISTINCT ON (r.user_id, r.card_id) r.*
    FROM reviews r
    JOIN cards c ON c.id = r.card_id AND r.card_version_id = c.current_version_id
    ORDER BY r.user_id, r.card_id, r.created_at DESC, r.id DESC
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
    JOIN v_reviewer_weight w ON w.user_id = l.user_id
    GROUP BY l.card_id
), fb AS (
    SELECT card_id,
           count(*) FILTER (WHERE status = 'open') AS open_feedback,
           count(*) AS total_feedback
    FROM feedback
    GROUP BY card_id
)
SELECT c.id AS card_id,
       c.entity_id,
       c.kind,
       c.source_field,
       c.module,
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
       -- needs-change score in [0,1): weighted share of "needs improvement" (+25% of "unsure"), smoothed by +1
       round((coalesce(a.improve_w, 0) + 0.25 * coalesce(a.unsure_w, 0))
             / (coalesce(a.correct_w, 0) + coalesce(a.improve_w, 0) + 0.25 * coalesce(a.unsure_w, 0) + 1), 4) AS needs_change_score,
       coalesce(fb.open_feedback, 0) AS open_feedback,
       coalesce(fb.total_feedback, 0) AS total_feedback,
       (coalesce(a.correct_votes, 0) > 0 AND coalesce(a.improve_votes, 0) > 0) AS conflicting
FROM cards c
LEFT JOIN agg a ON a.card_id = c.id
LEFT JOIN fb ON fb.card_id = c.id;

-- Per YAML item, over its own cards.
CREATE VIEW v_entity_health AS
SELECT e.id AS entity_id, e.type, e.key, e.name, e.module, e.yaml_file, e.active,
       count(ch.card_id) AS cards,
       count(ch.card_id) FILTER (WHERE ch.reviewers > 0) AS cards_reviewed,
       coalesce(sum(ch.reviewers), 0) AS verdicts,
       coalesce(sum(ch.correct_votes), 0) AS correct_votes,
       coalesce(sum(ch.improve_votes), 0) AS improve_votes,
       coalesce(sum(ch.unsure_votes), 0) AS unsure_votes,
       coalesce(sum(ch.open_feedback), 0) AS open_feedback,
       CASE WHEN coalesce(sum(ch.reviewers), 0) = 0 THEN NULL ELSE round(sum(ch.knew)::numeric / sum(ch.reviewers), 4) END AS knew_rate,
       round((coalesce(sum(ch.improve_w), 0) + 0.25 * coalesce(sum(ch.unsure_w), 0))
             / (coalesce(sum(ch.correct_w), 0) + coalesce(sum(ch.improve_w), 0) + 0.25 * coalesce(sum(ch.unsure_w), 0) + 1), 4) AS needs_change_score,
       bool_or(coalesce(ch.conflicting, false)) AS conflicting
FROM kb_entities e
LEFT JOIN v_card_health ch ON ch.entity_id = e.id AND ch.status = 'active'
GROUP BY e.id;

-- Roll-up to forms / processes / concepts / rules: their own cards PLUS every card linked to them
-- (e.g. a rule card linked to fGRN via applies_to_form counts toward fGRN and toward procure-to-pay).
CREATE VIEW v_rollup_health AS
WITH rel AS (
    SELECT c.entity_id AS target_id, c.id AS card_id FROM cards c
    UNION
    SELECT l.entity_id, l.card_id FROM card_links l
)
SELECT e.id AS entity_id, e.type, e.key, e.name, e.module, e.yaml_file, e.active,
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
FROM kb_entities e
JOIN rel ON rel.target_id = e.id
JOIN v_card_health ch ON ch.card_id = rel.card_id AND ch.status = 'active'
GROUP BY e.id;

-- The actionable list: one row per card (= YAML file + key + field) that someone flagged.
CREATE VIEW v_needs_change AS
SELECT e.type AS entity_type,
       e.key AS entity_key,
       e.name AS entity_name,
       e.module,
       e.yaml_file,
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
       coalesce((SELECT array_agg(DISTINCT le.key ORDER BY le.key) FROM card_links l JOIN kb_entities le ON le.id = l.entity_id
                 WHERE l.card_id = ch.card_id AND le.type IN ('form', 'usercontrol')), '{}') AS linked_forms,
       coalesce((SELECT array_agg(DISTINCT le.key ORDER BY le.key) FROM card_links l JOIN kb_entities le ON le.id = l.entity_id
                 WHERE l.card_id = ch.card_id AND le.type = 'process'), '{}') AS linked_processes,
       coalesce((SELECT array_agg(DISTINCT le.key ORDER BY le.key) FROM card_links l JOIN kb_entities le ON le.id = l.entity_id
                 WHERE l.card_id = ch.card_id AND le.type = 'rule'), '{}') AS linked_rules,
       coalesce((SELECT array_agg(DISTINCT le.key ORDER BY le.key) FROM card_links l JOIN kb_entities le ON le.id = l.entity_id
                 WHERE l.card_id = ch.card_id AND le.type = 'concept'), '{}') AS linked_concepts,
       coalesce((SELECT json_agg(json_build_object(
                     'feedback_id', f.id, 'category', f.category, 'suggested_text', f.suggested_text, 'comment', f.comment,
                     'status', f.status, 'username', u.username, 'card_version_id', f.card_version_id, 'created_at', f.created_at)
                     ORDER BY f.created_at)
                 FROM feedback f JOIN users u ON u.id = f.user_id
                 WHERE f.card_id = ch.card_id AND f.status IN ('open', 'accepted')), '[]'::json) AS suggestions
FROM v_card_health ch
JOIN kb_entities e ON e.id = ch.entity_id
JOIN card_versions cv ON cv.id = ch.current_version_id
WHERE ch.status = 'active' AND (ch.improve_votes > 0 OR ch.open_feedback > 0);

-- Employee knowledge per module (recency-weighted: a review's weight halves every ~3 weeks).
CREATE VIEW v_user_knowledge_module AS
WITH r AS (
    SELECT r.*, c.module,
           exp(-extract(epoch FROM (now() - r.created_at)) / 86400.0 / 30.0) AS w
    FROM reviews r JOIN cards c ON c.id = r.card_id
), totals AS (
    SELECT module, count(*) AS total_cards FROM cards WHERE status = 'active' GROUP BY module
)
SELECT u.id AS user_id, u.username, u.display_name, u.department, u.primary_module,
       coalesce(r.module, '-') AS module,
       count(*) AS reviews,
       count(DISTINCT r.card_id) AS cards_seen,
       max(t.total_cards) AS total_cards,
       round(count(DISTINCT r.card_id)::numeric / nullif(max(t.total_cards), 0), 4) AS coverage,
       round((sum(CASE WHEN r.knew_it THEN r.w ELSE 0 END) / nullif(sum(r.w), 0))::numeric, 4) AS knowledge,
       round(avg(CASE WHEN r.knew_it THEN 1.0 ELSE 0.0 END), 4) AS knew_rate_all_time,
       max(r.created_at) AS last_review_at
FROM users u
JOIN r ON r.user_id = u.id
LEFT JOIN totals t ON t.module IS NOT DISTINCT FROM r.module
GROUP BY u.id, coalesce(r.module, '-');

-- Employee knowledge per business process (via the process's own cards and cards linked to it).
CREATE VIEW v_user_knowledge_process AS
WITH rel AS (
    SELECT c.entity_id AS process_id, c.id AS card_id FROM cards c JOIN kb_entities e ON e.id = c.entity_id AND e.type = 'process'
    UNION
    SELECT l.entity_id, l.card_id FROM card_links l JOIN kb_entities e ON e.id = l.entity_id AND e.type = 'process'
), r AS (
    SELECT r.*, exp(-extract(epoch FROM (now() - r.created_at)) / 86400.0 / 30.0) AS w FROM reviews r
)
SELECT u.id AS user_id, u.username, u.display_name,
       p.key AS process_key, p.name AS process_name,
       count(*) AS reviews,
       count(DISTINCT r.card_id) AS cards_seen,
       round((sum(CASE WHEN r.knew_it THEN r.w ELSE 0 END) / nullif(sum(r.w), 0))::numeric, 4) AS knowledge,
       max(r.created_at) AS last_review_at
FROM users u
JOIN r ON r.user_id = u.id
JOIN rel ON rel.card_id = r.card_id
JOIN kb_entities p ON p.id = rel.process_id
GROUP BY u.id, p.key, p.name;
