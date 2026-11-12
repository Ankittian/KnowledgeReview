# Postgres structure: current vs the requirements PDF, and the recommended target

Sources: `db/schema.ts` + migrations `0000` to `0002` + `db/views.sql` (current), and section 13 of *Knowledge Assistant & Flashcards, Requirements* (PDF). Current figures are read from the real database: **14 tables and 7 views**.

---

## 1. Current structure (14 tables, 7 views)

| Group | Tables | What they hold |
|---|---|---|
| Login | `users` (12 cols), `sessions` (5), `refresh_tokens` (10) | Accounts, login sessions, rotating refresh tokens |
| Knowledge base mirror | `kb_entities` (10) | One row per YAML item (module, concept, rule, form, usercontrol, process) with content hash and the YAML file it came from |
| Cards | `cards` (10), `card_versions` (11), `card_links` (3) | Card identity (text id like `rule.summary:<key>`), each version's text and source hash, links from a card to related KB items |
| Player | `reviews` (18), `srs_state` (7), `daily_decks` (7) | One answer per card per day (knew it, verdict, timings, device), Leitner box and due date, the daily random deck |
| Corrections | `feedback` (17) | Suggested corrections with status open / accepted / rejected / applied / stale |
| Logs and settings | `interaction_events` (11), `audit_log` (7), `settings` (3) | Two separate logs, and key/value settings |
| Views | `v_card_health`, `v_entity_health`, `v_rollup_health`, `v_needs_change`, `v_reviewer_weight`, `v_user_knowledge_module`, `v_user_knowledge_process` | Admin reports |

Roles today: `employee`, `reviewer`, `admin`. Status: `pending`, `active`, `disabled`.

## 2. Structure in the PDF (about 20 entities)
`user`, `conversation`, `message`, `tool_call`, `feedback` (chat thumbs), `form`, `card`, `card_version`, `card_view`, `card_response`, `flag_review`, `kb_fix_item`, `points_ledger`, `scoring_rule_set`, `batch_run`, `setting`, `audit_log`.

## 3. Side-by-side

| PDF entity | Current equivalent | Gap |
|---|---|---|
| `user` | `users` | PDF needs **user_type** (admin/general) and a separate **answer role** (technical/functional/product), `auth_source` (ess/local), `is_active`. We have one mixed role (employee/reviewer/admin) and a signup-with-approval status. Lockout counters are derived from event rows, not stored |
| (sessions) | `sessions`, `refresh_tokens` | PDF REQ-AUTH-04 asks for exactly this. Already matches |
| `conversation`, `message`, `tool_call`, chat `feedback` | **none** | Whole chat area is missing (planned in `PLAN-spectrum-chat.md`) |
| `form` | `kb_entities` where type = form (56 rows) | PDF needs a real form table: code, name, module, `kb_node_id` (the graph node), loaded from the KB. Ours is a snapshot of a YAML copy, not the 402 forms in the graph |
| `card` | `cards` | PDF identity = **form + level + topic key**, plus `is_control`, `altered_fact`. Ours = a text id from a rule/concept/process, and **no level**, no form link |
| `card_version` | `card_versions` | Close. Missing: `title`/`body` as statements, `word_count`, `kb_node_ids`, `status` (draft/published/disputed/retired) and `batch_id`. We have `source_hash` and `generated_by`, which cover the content hash |
| `card_view` | inside `reviews` (shown/flipped/answered times) | PDF wants a server-side open event for **every** card shown, with active vs raw time, hidden/idle time, and an `abandoned` outcome. Ours only exists when an answer is saved, and timings are client-measured |
| `card_response` | `reviews` (`knew_it`, `verdict`) | PDF: answer = known / new / incorrect, plus reason, a correction of 15+ characters, `too_fast`. Ours: a yes/no plus correct / needs improvement / unsure |
| `flag_review` | `feedback` (`status`, `resolved_by`, `resolution_note`) | PDF keeps the user's flag and the admin's decision (confirmed / rejected / partial) separately, with a flag count that marks a card **disputed** at 2 flags. Ours is one row doing both |
| `kb_fix_item` | view `v_needs_change` + a report script | PDF wants a stored hand-over list (open / fixed) the KB team can mark. We only have a report |
| `points_ledger`, `scoring_rule_set` | **none** | No points, rules versions, reliability, leaderboard |
| `batch_run` | **none** (sync result goes to `audit_log`) | PDF wants run history and per-form resume |
| `setting` | `settings` | Matches |
| `audit_log` | `audit_log` + `interaction_events` | PDF has one log (time, user, IP, event, payload, request id). We have two overlapping ones, and `audit_log` has no IP or request id |
| (not in PDF) | `srs_state`, `daily_decks`, `card_links`, views | Spaced repetition and random daily decks are not in the PDF (it says: answer each card version **once**, pick by form and level). `card_links` is an extra, useful for corrections |

**Summary:** about 8 of the PDF's 17 entities exist in some form (user, card, card version, response, flag, setting, audit log, form partly). Missing outright: the 4 chat tables, `card_view`, `kb_fix_item`, the 2 scoring tables and `batch_run`.

---

## 4. Recommended target structure (about 26 tables)

Principle: **keep what works, add what the PDF needs, merge what overlaps.** One database, one schema, additive migrations (no big-bang rewrite).

### A. Identity and access (3 tables, mostly done)
- `users`: keep, and add `user_type` ('admin' | 'general'), `answer_role` ('technical' | 'functional' | 'product' | null for admin), `auth_source` ('local' | 'ess'), `must_change_password`, `failed_logins`, `locked_until`, `deactivated_at`. Keep `status`, but drop `pending` if there is no self-signup (REQ-AUTH-01).
- `sessions`, `refresh_tokens`: keep as built.

### B. Knowledge base mirror (2 tables)
- **`forms`** (new): `id`, `code` (unique, e.g. fGRN), `name`, `module`, `kb_node_id`, `active`, `synced_at`.
- `kb_entities`: keep for rules, concepts and processes (used by corrections and traceability). Add `kb_node_id`.

### C. Cards (5 tables)
- `cards`: add `form_id` (nullable), `level` (1 to 3), `topic_key`, `is_control`, `control_of_card_id`, `altered_fact`, and `flag_count`. Unique on (`form_id`, `level`, `topic_key`). Existing rule/concept/process cards keep `entity_id` with `form_id` null.
- `card_versions`: add `word_count`, `kb_node_ids text[]`, `batch_id`, `status` (draft / published / disputed / retired). Statement cards store the statement in `front` (title) and `back` (body), or rename to `title`/`body`.
- `card_links`: keep.
- **`batch_runs`** (new): `id`, `trigger` (schedule/manual), `started_at`, `ended_at`, `status`, counts (created / changed / retired / rejected), `tokens_in/out`, `error`.
- **`batch_run_forms`** (new): `batch_id`, `form_id`, `status`, `cards_created`, `error`. This gives resume after a failure (REQ-GEN-10).

### D. Player (2 core tables, 2 optional)
- **`card_views`** (new): `id`, `user_id`, `card_version_id`, `opened_at` (server clock), `answered_at`, `hidden_ms`, `idle_ms`, `raw_ms`, `active_ms` (capped at 10 minutes), `outcome` (answered / abandoned).
- **`card_responses`** (replaces the answer part of `reviews`): `id`, `card_view_id` (unique), `answer` (known / new / incorrect), `reason`, `correction_text`, `too_fast`. Unique (`user_id`, `card_version_id`) enforces "answer once per version".
- `srs_state`, `daily_decks`: **decision needed**. The PDF does not use spaced repetition or random daily decks. Keep them only if you want a review mode on top.

### E. Corrections (3 tables)
- **`card_flags`** (evolves `feedback`): the user's flag with reason and correction.
- **`flag_reviews`** (new): `card_version_id`, `reviewer_id`, `decision` (confirmed / rejected / partial), `note`, `decided_at`.
- **`kb_fix_items`** (new): `card_version_id`, `note`, `status` (open / fixed), `fixed_by`, `fixed_at`. Exportable as CSV.

### F. Scoring (2 tables)
- **`scoring_rule_sets`**: `version`, `json_rules`, `active_from`.
- **`points_ledger`**: append-only: `user_id`, `event`, `points`, `card_version_id`, `rule_version`, `created_at`.
- Leaderboard and reliability score stay as **views** (global, per form, this week / all time).

### G. Chat (5 tables)
- `conversations` (`user_id`, `title`, `role_used`, `claude_session_id`, `deleted_at`), `messages` (`conversation_id`, `sender`, `content`, `status` ok/stopped/error, tokens, `duration_ms`), `tool_calls` (`message_id`, `tool_name`, `arguments`, `allowed`, `duration_ms`), `message_feedback` (`message_id`, `user_id`, `value`, `comment`), and **`chat_jobs`** (the queue the workers read, one active job per conversation).

### H. Operations (2 tables)
- `settings`: keep.
- **One `audit_log`**: `id`, `ts` (UTC), `user_id`, `ip`, `event_type`, `payload jsonb`, `request_id`, `session_id`. Merge `interaction_events` into it. Make it append-only by revoking UPDATE and DELETE from the app's database role. Keep everything (REQ-AUD-04); at 15 users a plain table is enough, no partitioning.

### Rules for every table
- UUID keys for things users see (users, cards, conversations), `bigserial` for logs and ledgers, `timestamptz` everywhere.
- Foreign keys with `ON DELETE` chosen deliberately: history and scores are **kept** when a user is deactivated, so use `is_active`, never delete users.
- Values likely to change (flag reasons, event types) as `text` with a `CHECK`; stable sets (levels, outcomes) as enums.
- Indexes on the access paths: (`user_id`, `created_at`) on logs, (`form_id`, `level`, `status`) on cards, (`user_id`, `card_version_id`) unique on responses.
- The app connects as a non-superuser role.

---

## 5. How to get there from today

The local database holds no users or answers yet, so this is the cheapest moment to restructure. Do it with **additive migrations**, in this order:
1. `users` columns, merge the two logs into `audit_log`.
2. `forms`, card columns (`form_id`, `level`, `topic_key`, control fields), `batch_runs`, `batch_run_forms`.
3. Split `reviews` into `card_views` and `card_responses` (backfill existing rows), evolve `feedback` into `card_flags`, add `flag_reviews` and `kb_fix_items`.
4. Chat tables and `chat_jobs`.
5. Scoring tables, ledger and leaderboard views.

Rebuild the views (`db/views.sql` already re-creates them on every migrate).

## 6. Decisions needed
1. **Spaced repetition:** keep `srs_state` / `daily_decks` as an extra mode, or follow the PDF (answer each card version once)?
2. **Reviewer role:** the PDF has only admin and general. Drop `reviewer` (merge into admin), or keep it as a permission?
3. **Signup:** the PDF says no self-signup. Remove the `pending` flow?
4. **Is there live data** in a Neon/Supabase database today? If yes, migrate additively. If no, we can reset and re-create cleanly.
5. **Statement cards:** rename `front`/`back` to `title`/`body`, or keep the names?
