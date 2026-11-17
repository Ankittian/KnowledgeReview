# PLAN: UI card generation

Status: implemented (revision 4). Run the worker with `npm run cards:worker`; test with `CLAUDE_RUNNER=mock`. Date: 2026-11-17. Mock-ups of every screen are in `PLAN-ui-card-generation.pdf`.

## 1. Goal

An admin generates flashcards from the frontend instead of running scripts. The admin:

1. chooses **Module level** or **Form level**;
2. picks the modules or forms from **one multi-select dropdown**;
3. sets **how many cards** and their **difficulty** (easy / medium / hard);
4. clicks **Generate**. Generation runs in the background; the admin can leave the page and keep working;
5. gets an **in-app notification** when the cards are ready;
6. **reviews** the cards: edit or delete any card;
7. clicks **Push**, which runs the same code as `scripts/push-cards.ts` (`pushCatalog` in append mode) and writes the cards to Postgres.

Nothing reaches learners until step 7.

## 2. Design decisions

| Decision | Choice | Why |
|---|---|---|
| Approval | Always review, then Push. No auto-push | Some statements are inferred from KB evidence; an expert sees them first |
| Background work | A worker process picks up queued jobs; the web request only creates the job row | Generation takes minutes; the admin must be free to navigate |
| Notification | `notifications` table, bell icon in the top bar, plus a toast. The client polls every 10 s | Works on one server with no extra infrastructure. Upgrade to SSE later if needed |
| Review storage | One row per generated card in `generated_cards` (status `draft` / `deleted`, `edited` flag) | Edit and delete are single-row updates and cannot race with each other |
| Push | Build the catalog from the non-deleted rows, write it to `data/generated-cards/<MODULE>.<scope>.<timestamp>.json` (temp file, then rename), call `pushCatalog(db, catalog, { mode: "append" })` | Identical to `cards:push`; the saved file is the audit trail and can be committed |
| Purge | Not offered in the UI | It deletes reviews and feedback and cannot be undone |
| Concurrency | The worker runs one job at a time (FIFO queue) | The existing-cards ledger is read at job start; parallel jobs would create duplicates |
| Model access | Claude runs through the Agent SDK with only the read-only knowledge-graph tools (`spectrum-kg` MCP: search, get_node, expand, run_cypher). No shell, no file, no web tools. It returns the catalog JSON as its answer; the server validates it and chooses the file name | `data/templates/flashcards/generation-prompt.<audience>.txt` requires the model to read the graph and look up element ids with `run_cypher`, so it cannot be a no-tools call. A prompt still cannot reach the file system |
| Duplicates | The existing-card ledger for the selected forms or modules is filled into `{{EXISTING_CARDS}}` before every run, and checked again in code afterwards | See section 3A |
| Credentials | One server-side Claude credential shared by all admin requests, same as the Knowledge Assistant | See section 3B |
| Cost control | A cards-per-job cap and an estimate shown before Generate | Prevents a runaway selection of 200 forms |

## 3. Pipeline

```
Admin: New generation  ->  server action (admin only)
   inserts card_generation_jobs (queued)
        |
        v
Worker (npm run cards:worker), one job at a time
   1. Resolve targets: module-level -> module common cards; form-level -> each form
   2. Build prompt: prompt5 with {{MODULE}}, {{TARGET_ITEMS}}, counts per level, and
      {{EXISTING_CARDS}} = ledger (titles) of the selected forms/modules from Postgres
   3. Call Claude (Agent SDK, read-only KG tools) in batches of 3-5 targets, status "generating"
      with progress (batch 3 of 8). The ledger is refreshed between batches with the new titles
   4. Parse JSON, validate (schema, word/line limits, leak check, title similarity, source_refs resolve)
   5. One repair call per batch for failing cards; still failing -> keep with warnings; unusable -> drop and list
   6. Insert the cards into generated_cards (status draft)
   7. Dry-run pushCatalog and store the report (similar titles, revisions, unresolved refs)
   8. status "ready"; insert a notification for the requester
        |
        v
Admin: bell shows "12 cards ready"  ->  Review page
   edit card / delete card / (re-check warnings)
        |
        v
Push button -> confirm dialog (shows dry-run result)
   -> write catalog file, pushCatalog (append), status "pushed", notification with counts
```

If a push is refused (`PushRefused`, for example a title too close to a stored card), the review page shows those cards with a warning. The admin edits or deletes them and pushes again. Nothing is saved on a refusal, because each push is one transaction.

## 3A. Avoiding similar cards (the ledger)

`data/templates/flashcards/generation-prompt.<audience>.txt` already has this built in; the UI job fills it exactly as the operator does today.

- **In the prompt:** section 0 has `{{EXISTING_CARDS}}`, "one line per card already in the database ... you see ONLY the title and keys, never the body". Section 6 says a new title must not be the same topic as any existing title of that item, "even reworded", and must never reuse an existing `topic_key`. Section 7 is a step-by-step no-duplicates procedure (list angles used, compare titles, discard and replan).
- **Where the lines come from:** the same query as `npm run cards:ledger` (`scripts/export-ledger.ts`): `item key | level | topic_key | title` for every active card. That query moves into `lib/cards/generate/ledger.ts` and both the script and the worker call it, so there is one source of truth.
- **Scope of the ledger:** form level sends the titles of only the selected forms (`--items fGRN,fGateEntry`). Module level sends the module's common cards, plus the forms' titles when the run touches them. Cards generated in an earlier job but not yet pushed are included too, so two pending jobs cannot repeat each other.
- **Second check in code (the model cannot skip it):** after generation the validator compares every new title with the ledger and with the other new cards, using `lib/cards/push/dedupe.ts` (about 60 percent shared key words). Cards that fail a check (length, wording, too close to another title) are sent back in ONE repair call per batch ("write a different angle"). A card that still fails is kept with its warning so the admin can edit or delete it; only cards that are structurally unusable (same topic key twice, topic key already stored, more than requested) are dropped and listed in the job notes. The dry run before Push repeats the check against the live database, and `pushCatalog` refuses a repeat.
- **Review page:** any remaining near-duplicate shows a warning with the stored card's title beside it.

## 3B. Models and the shared Claude account

**Which model.** The choice is made in the form (Run settings: *Sonnet, faster and cheaper* or *Opus, for hard cards*) and stored in `params.model`. The worker maps it to a model id from a server allowlist and passes it to the SDK `query({ options: { model } })`. If the admin does not choose, the default is `CARDS_MODEL`, then `CLAUDE_MODEL` (the setting the chat already uses), then the SDK default. The model used and its token counts are saved on the job.

**One account for every user on EC2.** Generation reuses the setup in `lib/chat/runner.ts`: the credential (`ANTHROPIC_API_KEY`, or `CLAUDE_CODE_OAUTH_TOKEN`) is read from the server environment and passed to the SDK child process. Admins never see or enter a key.

- Only admins can create a job (server action checks the role). Learners cannot reach it.
- Jobs run one at a time from a queue, so generation uses at most one Claude session. It counts against the shared `MAX_CONCURRENT_CLAUDE` limit, so it cannot starve the Knowledge Assistant.
- Limits: a cards-per-job cap and a jobs-per-day cap for admins (env settings, like `CHAT_DAILY_LIMIT`), and a visible cost estimate before Generate.
- Models and token counts are recorded per job with the requesting admin, so the shared bill can be traced (cost in dollars is only estimated before Generate, not stored).
- **Recommendation:** use a pay-per-use `ANTHROPIC_API_KEY` for the worker. A subscription token has usage windows shared with the chat, and a long generation run could use them up. If one credential must be shared, run the worker with its own `CLAUDE_CONFIG_DIR` and give it a lower priority than chat.
- The worker needs `KG_MCP_URL` and `KG_MCP_TOKEN` as well, because it reads the knowledge graph through the same MCP server as the chat.

## 4. UI

New admin tab **Cards** (`/admin/cards`) next to Feedback, Health, Users and the rest. It has three views.

### 4.1 New generation (`/admin/cards/new`)

- **Level** segmented control: *Module level* or *Form level*.
  - Module level generates the common questions of a whole module (cross-form, process-level cards).
  - Form level generates questions about individual forms.
- **Select** dropdown, multi-select with search, selected items shown as chips:
  - Module level: the modules that have forms.
  - Form level: forms grouped by module, each with its current card count; a module header row selects all its forms. Quick picks: *No cards yet*, *Fewer than 6 cards*.
- **Cards per item**, a table with one row per selected item:
  - Easy, Medium, Hard counts as number steppers (default 3 / 3 / 2).
  - "Apply to all" sets every row at once; each row can then be changed.
  - A live total and cost estimate: "10 items, 80 cards, about $X".
- **Model** (small dropdown): Sonnet (default) or Opus. Below the table a note shows how many existing cards will be sent as the do-not-repeat list, for example "31 existing card titles will be sent so similar cards are not generated".
- Optional **Additional instructions** (free text, capped). The fixed card rules and checks still apply.
- **Generate cards** button. The admin lands on the jobs list with the new job at the top.

### 4.2 Jobs list (`/admin/cards`)

- One row per job: scope, items, requested cards, status badge, progress bar while generating, time, requester.
- Statuses: Queued, Generating (batch 3 of 8), Ready for review, Pushed, Failed, Cancelled.
- Row actions: Review, Cancel (queued or running), Retry (failed).
- Admins can leave this page at any time. The job keeps running.

### 4.3 Notifications (any page)

- A **bell** in the top bar with an unread count.
- A toast appears wherever the admin is: "Cards ready: MM, 3 forms, 24 cards. [Review]".
- The bell panel lists the latest events: ready, failed, pushed. Clicking one opens the job. Mark all read.

### 4.4 Review (`/admin/cards/[jobId]`)

- Header: job summary, counts by difficulty, number of warnings.
- Cards grouped by form (or module common questions), each rendered as learners will see it: level badge, title, body, source links.
- Per card:
  - **Edit**: inline editor for title, body, level and topic key; the card is re-validated on save. Edited cards get an "edited" tag.
  - **Delete**: removes the card from this job (undo available until Push).
  - **Warnings**: similar title, unresolved source, over the word limit.
- A sticky bottom bar: "21 cards will be pushed, 3 deleted" and the **Push cards** button.
- Push shows a confirm dialog with the dry-run result (new, updated, unchanged, links) and then runs the push. A result summary and a notification follow. *Download JSON* is available.

## 5. Data model

Add to `db/schema.ts`, then run `npm run db:export-schema`.

**card_generation_jobs**

| Column | Notes |
|---|---|
| id | primary key |
| requested_by | admin user id |
| level | `module` or `form` |
| params | jsonb: items with their easy/medium/hard counts, custom instructions, model |
| status | queued, generating, ready, pushing, pushed, failed, cancelled |
| progress | jsonb: batch done / total |
| report | jsonb: validator warnings, dropped cards, dry-run result, push result |
| file_paths | text[]: files saved under `data/generated-cards/` after Push |
| model, input_tokens, output_tokens, cost | usage |
| created_at, started_at, finished_at, error | timing and failure |

**generated_cards**

| Column | Notes |
|---|---|
| id, job_id | primary key, job |
| module, scope, group_key, group_title, context | which form or module the card is for |
| level, topic_key, title, body, source_refs | the card, same shape as the catalog JSON |
| status | `draft` or `deleted` |
| edited, warnings | admin changed it; validator warnings (jsonb) |

**notifications**

| Column | Notes |
|---|---|
| id, user_id | recipient |
| kind | `cards_ready`, `cards_failed`, `cards_pushed` |
| job_id, message, read_at, created_at | link and state |

## 6. Code layout

| Path | Purpose |
|---|---|
| `lib/cards/generate/validate.ts` | Card checks; reuses `lib/cards/spec.ts` and `lib/cards/push/dedupe.ts` |
| `lib/cards/generate/ledger.ts` | Existing-card titles for chosen forms or modules (shared with `scripts/export-ledger.ts`) |
| `lib/cards/generate/prompt.ts` | Fills prompt5 placeholders, the requested counts and the ledger |
| `lib/cards/generate/run.ts` | Batching, Claude call, repair step, dry-run |
| `lib/cards/generate/jobs.ts` | Job, card and notification table access; status transitions |
| `lib/cards/generate/push.ts` | Builds the catalog from the draft cards, writes the file, calls `pushCatalog` |
| `scripts/card-worker.ts` | Worker loop; `npm run cards:worker` |
| `app/actions/card-generation.ts` | Server actions: create job, cancel, edit card, delete or restore card, push |
| `app/api/notifications/route.ts` | Unread notifications for the bell (polled) |
| `app/admin/cards/...` | New generation form, jobs list, review page |
| `components/admin/cards/...`, `components/shell/NotificationBell.tsx` | UI pieces |
| `tests/generate.*.test.ts` | Validator, prompt builder, job transitions, catalog build |

`scripts/push-cards.ts` stays as the command-line entry. Both it and the UI call `pushCatalog`, so the rules are identical.

## 7. Build order

1. **Validator and tables.** Extract the validator; add the three tables and access functions. Tests.
2. **Worker.** Prompt builder, batched Claude calls, repair, dry-run, notification on finish. Run from the command line first.
3. **New generation screen and jobs list.** Level toggle, multi-select, counts, estimate, progress.
4. **Notifications.** Bell, polling endpoint, toast.
5. **Review page.** Edit, delete, undo, warnings, push dialog, push action.
6. **Extras.** Cancel, retry, download JSON, cost cap.

## 8. Open decisions

- **Worker location.** A separate `npm run cards:worker` process (recommended for EC2) or inside the Next server.
- **Word limits.** `lib/cards/spec.ts` has easy 20-70, medium 90-200, hard 180-380 words; prompt5 says 20-50, 50-130, 120-220. The validator enforces one set, so reconcile before step 1.
- **Credentials.** API key (recommended) or shared OAuth token for the worker; see section 3B.
- **Model list.** Which models the admin may pick (Sonnet default, Opus optional) and the cost caps.
- **Prompt5 and the UI.** `data/templates/flashcards/generation-prompt.<audience>.txt` still starts with an operator note and writes a file (`{{OUTPUT_PATH}}`). The worker needs a copy as a template without the note, with the output as the final message. Keep one source so the two do not drift.
- **Deploy behaviour.** `deploy:init` pushes every JSON in `data/generated-cards/`. Files written by the server are not in git: commit them from the download button, or rely on the database copy.
- **Old catalogs.** Remove `MM.functional.json` and `PM.functional.json` (already purged from the database) so they are not reloaded.
- **Notification delivery.** Polling every 10 s (this plan) or server-sent events.

## 9. Risks

- Inferred or wrong statements reaching learners. Mitigation: review gate, validator warnings, expert sign-off.
- Cost overrun. Mitigation: per-job card cap and the estimate before Generate.
- Duplicate cards. Mitigation: ledger in the prompt, similarity check in validation and again in the push.
- Lost work if the browser closes during editing. Mitigation: every edit and delete is saved immediately to `generated_cards`.
- A card edited into something invalid. Mitigation: the same validator runs on save, and `pushCatalog` validates again.

## 10. As built

- Tables `card_generation_jobs`, `generated_cards`, `notifications` are in `db/schema.ts`, `db/schema.sql` and (idempotent, for existing databases) `db/migrations.sql`; `npm run db:init` creates them.
- Prompt templates: `data/templates/flashcards/generation-prompt.functional.txt` (the former `prompt5-final.txt`; the older generation prompt there was replaced) and `generation-prompt.technical.txt` (to be written). `lib/cards/generate/prompt.ts` strips the operator note and fills the placeholders.
- Worker: starts by itself inside the web server (`instrumentation.ts`), so a queued job is picked up within about 3 seconds. Set `CARDS_WORKER=off` to run it as a separate process instead with `npm run cards:worker`; running both at once is safe (a job is claimed once, and only jobs stuck for 45 minutes are re-queued).
- Old note: `npm run cards:worker` (`-- --once` for one pass). It needs `DATABASE_URL`, `KG_MCP_URL`, `KG_MCP_TOKEN` and a Claude credential, or `CLAUDE_RUNNER=mock`. The production Docker image does not yet include the worker, `scripts/` or `data/templates/`; add them (or a `worker` compose service) before deploying this to EC2.
- Settings: `CARDS_MODEL_SONNET`, `CARDS_MODEL_OPUS`, `CARDS_MAX_PER_JOB` (default 120), `CARDS_MAX_JOBS_PER_DAY` (20), `CARDS_TIMEOUT_MINUTES` (20 per batch), `CARDS_MAX_TURNS` (60), `CARDS_OUTPUT_DIR` (default `data/generated-cards`).
- Admin screens: `/admin/cards` (jobs), `/admin/cards/new`, `/admin/cards/[id]` (progress, review, result); bell in the top bar for admins; `GET /api/notifications`.
- Tests: `tests/generate.test.ts`, `tests/generate.db.test.ts`, `e2e/card-generation.spec.ts` (runs the worker once with the mock model).

### Audience (functional or technical)

- Every card is stored with `cards.audience` (`functional` or `technical`); the card id and the ledger include it, so the two sets never overwrite or repeat each other.
- The New generation screen starts with **Who are the cards for?** (Functional / Technical). The choice is saved in the job (`params.audience`; older jobs count as functional) and decides: the prompt template (`generation-prompt.<audience>.txt`), the ledger, the checks (the business-wording leak check runs only for functional cards), the catalog `audience`, the file name and the push.
- Technical is enabled only when its template file exists; the UI shows it as "soon" and the server refuses it until then. Existing-card counts on the screen are for the chosen audience.
- A technical template should use the same `{{PLACEHOLDERS}}` and the same JSON output format (section 9 of the functional template), with `"audience": "technical"`.
