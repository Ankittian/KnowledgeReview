# PLAN: UI card generation

Status: proposed. Date: 2026-11-16.

## 1. Goal

An admin generates flashcards from the frontend instead of running scripts or a weekly job. The admin picks a module, then either specific forms, module-wide common questions, or both. The system generates the cards as JSON, saves the file in `data/generated-cards/`, and pushes the cards to Postgres through the same code that `scripts/push-cards.ts` uses.

## 2. Design decisions

| Decision | Choice | Why |
|---|---|---|
| Push trigger | The worker saves the file, then calls the push library directly | A folder watcher can see half-written files, behaves differently on Windows, and can fire twice |
| Approval | Default is review, then Approve. An "Auto-push if checks pass" toggle is available | Some statements are inferred from KB evidence, so an expert should see cards before learners do |
| Purge | Not offered in the UI | It deletes reviews and feedback and cannot be undone. If ever added, require a typed confirmation |
| Concurrency | One running job per module | The existing-cards ledger is read at job start; two jobs would create duplicates |
| Long running | Background worker, not the web request | A job takes minutes |
| Storage | Generated JSON is stored in the database as well as the folder | Server folders may not persist (Docker, EC2 redeploys) and server-made files are not in git |
| Model access | The model returns JSON only, with no shell or file tools | The server chooses the file name from the validated module key, so a custom prompt cannot reach the file system |

## 3. Pipeline

```
Admin UI form
   | server action (admin only): insert card_generation_jobs row (queued)
   v
Worker (separate process)
   1. Resolve scope to a list of items (forms, common flows)
   2. Build prompt: prompt5 + KB source for each item + {{EXISTING_CARDS}}
      (titles from Postgres, same query as cards:ledger) + admin's custom instructions
   3. Call Claude in batches of 3-5 forms
   4. Parse JSON, then validate: schema, word and line limits, leak check,
      title similarity, source_refs resolve
   5. One repair call per failing card; if still failing, drop it and report it
   6. Write data/generated-cards/<MODULE>.<scope>.<timestamp>.json (temp file, then rename)
   7. Dry-run the push and record the report (similar titles, revisions, unresolved refs)
   v
Status: ready for review
   v
Admin previews, rejects or edits cards, clicks Approve
   v
Worker calls pushCatalog in append mode; status: pushed (counts stored)
```

Auto-push skips the review step only when there are no validator warnings and the dry-run is clean.

## 4. UI options

### 4.1 What to generate
- Module: dropdown of modules that have forms.
- Scope: Form questions, Common questions, or Both (matches the Browse buttons).
- Forms (Form questions or Both):
  - Multi-select with search, filtered by area.
  - Each form shows its current card count.
  - Quick picks: no cards yet, fewer than N cards, all forms in module.
- Common questions: choose the flow(s) (for example procure-to-pay) or module-wide common cards.

### 4.2 Card settings
- Audience: functional (technical later).
- Cards per form as easy/medium/hard counts, with a default mix.
- Focus angles (optional checkboxes): approvals and roles, tolerances, cascade effects, reversal, scenarios, and so on.
- Fill gaps only: use the ledger to avoid angles already covered.

### 4.3 Custom prompt
- Free-text "Additional instructions", with a character cap and a few example chips.
- Placed after the fixed rules in a separate block. The card contract and leak checks still apply, and the UI says so.
- Optional extra source: pick a learning file (for example S17) or paste a note. It is reference only; cards must stay answer-first and free of IDs.

### 4.4 Run settings
- Model: Sonnet by default, Opus for hard cards.
- After generation: Save as draft, or Auto-push if checks pass.
- Duplicate strictness (similarity threshold, default 0.6).
- Safety cap on forms or cost per job, with an estimate shown before starting.

### 4.5 Job and review screens
- Jobs list: status, live progress (batch 3 of 8), cost, requester.
- Review page:
  - Cards grouped by form and common flow, rendered as learners see them.
  - Validator warnings (similar title, unresolved source, inferred statement).
  - Per-card reject or edit, then Approve and push.
  - Post-push report: created, revised, links, unresolved refs.
  - Download JSON.

## 5. Data model

New table `card_generation_jobs` (add to `db/schema.ts`, then `npm run db:export-schema`):

| Column | Notes |
|---|---|
| id | primary key |
| requested_by | user id (admin) |
| params | jsonb: module, scope, items, levels, angles, custom prompt, model, after-generation mode, threshold |
| status | queued, running, validating, ready, pushed, failed, cancelled |
| result_json | jsonb: the generated catalog |
| report | jsonb: validator warnings, dropped cards, dry-run result, push result |
| file_path | saved file under `data/generated-cards/` |
| model, input_tokens, output_tokens, cost | usage tracking |
| created_at, started_at, finished_at, error | timing and failure |

A partial unique index on `(module)` where status is running enforces one job per module.

## 6. Code layout

| Path | Purpose |
|---|---|
| `lib/cards/generate/validate.ts` | Card checks, extracted from the validation script used for the MM set; reuses `lib/cards/spec.ts` and `lib/cards/push/dedupe.ts` |
| `lib/cards/generate/prompt.ts` | Fills prompt5 placeholders, adds the custom-instructions block |
| `lib/cards/generate/run.ts` | Batching, Claude call, repair step, file write, dry-run |
| `lib/cards/generate/jobs.ts` | Job table access, lock, status transitions |
| `scripts/card-worker.ts` | Worker loop; `npm run cards:worker` |
| `app/actions/card-generation.ts` | Server actions: create job, cancel, approve, reject card |
| `app/admin/cards/...` | New-job form, jobs list, review page |
| `tests/generate.*.test.ts` | Validator, prompt builder, and job lock tests; push tests already exist |

The Claude call can use `@anthropic-ai/claude-agent-sdk` (already a dependency) or the Anthropic API directly; with no tools allowed either works, and the API call is simpler.

## 7. Build order

1. **Validator and job table.** Extract the validator; add the table and job access functions. Tests.
2. **Worker.** Prompt builder, batched Claude calls, repair step, file write, dry-run. Run from the command line first.
3. **Admin pages.** New-job form, jobs list, review and approve.
4. **Extras.** Auto-push toggle, cost estimate, cancel, download JSON.

## 8. Open decisions

- **Worker location.** A separate `npm run cards:worker` process (recommended for EC2) or inside the Next server.
- **Word limits.** `lib/cards/spec.ts` still has easy 20-70, medium 90-200, hard 180-380 words, while prompt5 says 20-50, 50-130, 120-220. The validator must enforce one set, so reconcile before step 1.
- **Credentials.** The worker needs an Anthropic API key in the server environment.
- **Deploy behaviour.** `deploy:init` pushes every JSON in `data/generated-cards/`. Server-generated files are not in git, so either commit exported files or rely on the database copy.
- **Old catalogs.** Remove `MM.functional.json` and `PM.functional.json` (already purged from the database) so they are not reloaded.

## 9. Risks

- Inferred or wrong statements reaching learners. Mitigation: review gate, validator warnings, expert sign-off.
- Cost overrun. Mitigation: per-job caps and the estimate before start.
- Duplicate or near-duplicate cards. Mitigation: ledger in the prompt, similarity check in validation and in the push.
- Custom prompt tries to weaken the rules. Mitigation: checks run in code after generation; the model cannot skip them.
