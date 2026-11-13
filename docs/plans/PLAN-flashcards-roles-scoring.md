# Plan: role-based, level-based flashcards with card weights and a leaderboard

Status: **revision 2** (decisions of 2026-11-13 applied, see "Decisions taken" below). Source of truth for behavior is `docs/specs/Knowledge Assistant & Flashcards — Requirements.pdf` (REQ ids below). Where this plan differs from the PDF, it says so in section 2.

This plan sits on top of the modular schema already applied to `knowledge_review_test` (`auth`, `kb`, `learning`) and the authentication work that comes first (section 10, phase A).

---

## 0. What we are building (one paragraph)

For every form in the knowledge base (KB), Claude generates cards at three levels (Easy, Medium, Hard), **twice**: a **functional** set written for business users and a **technical** set written for developers. A general user is either functional or technical and only ever receives their own set. An admin sees and can test both. Each card has a **weight** set by its level (Easy 1, Medium 3, Hard 5). A valid answer earns the card's weight; weights feed a leaderboard that every signed-in user can see, **overall and per module** (and per form). Admins can open any general user's progress.

```
KB (YAML now, graph later)
   │  split per form into two evidence bundles
   ├── functional bundle ──► Claude (functional skill) ─┐
   └── technical bundle  ──► Claude (technical skill)  ─┤
                                                        ▼
                          validate (schema, word limits, leak lint, grounding)
                                                        ▼
                     kb.cards (audience, level, topic) + versions (draft)
                                                        ▼
                         admin review ──► published ──► players
                                                        ▼
        answer ─► anti-cheat ─► score_ledger ─► leaderboard (overall / module / form)
```

---

## Decisions taken (revision 2)

| Topic | Decision |
|---|---|
| Publishing | **No admin review before publishing.** Cards that pass the automatic checks publish straight away. The corrections queue (users flag wrong cards, admin decides) stays as the after-the-fact safety net. |
| Scoring | **No "points" system. Cards carry a weight:** Easy **1**, Medium **3**, Hard **5**. A user's score is the sum of the weights of the cards they answered validly. The weights live in settings (`scoring_rules`), not on each card. |
| Time monitoring | The clock starts when the card is **shown** and stops when an **option is selected**. The options are **locked until the card's designated read time has passed** (section 6). |
| Scope | Modules **MM, PM and FI** (270 forms), functional and technical sets. |
| Delivery | Generate as **JSON files first** (`generated-cards/`); the owner reviews them; then the old template cards are removed and the JSON is loaded into Postgres. |

## 1. Decisions still open (recommendation first)

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | A card is a **statement to verify** (PDF, REQ-GEN-03), not a quiz question. "Answers correctly" then means: *Known and correct* or *New to me* earn the card's weight (Easy 1, Medium 3, Hard 5); *Incorrect* earns a correction score once an admin confirms it. | Follow the PDF. | It is built to find KB errors, which is the goal of the product, and it cannot be gamed by guessing. If you want true multiple-choice questions with right and wrong answers, that is a different card type and a different scoring model; say so now. |
| D2 | Roles in the PDF are **Technical, Functional, Product**. You named two. | Build for two now. Keep `product` as a third role row in `auth.roles`, switched off. | Adding a role later is then a data change, not a schema change. |
| D3 | The existing 5,257 template cards (`rule.summary`, `concept.summary`, …) mix business and code wording. | **Quarantine them**: they get no audience, so no general user is served them. They stay in the database for history. | It is the only way to guarantee a functional user never sees a technical card. |
| D4 | The app today has a **daily deck** (spaced repetition + daily limit). The PDF has a **player** with form and level filters and no daily deck. | Keep both: the daily deck for habit, a "Practice" player with module, form and level filters for the PDF flow. Weights count the same in both. | No feature is thrown away; the daily 200 cap covers both. |
| D5 | Admins in the leaderboard? (PDF open question) | Admins are **not ranked** but can see the full board and every user's detail. | Keeps the competition between general users. |
| D6 | One board or one per role? | One board per scope with a role chip (default: your own role, plus "Everyone"). | Functional and technical pools have different card sets, so comparing within a track is fairer, but a combined view stays available. |
| D7 | ~~Pilot scope~~ | Superseded: MM, PM and FI in full (see Decisions taken). | |

---

## 2. How this lines up with the requirements PDF

| PDF area | Covered by | Notes |
|---|---|---|
| REQ-ROLE-01..05 roles and user types | Section 5, phase A | `users.user_type` (admin/general) plus one `role` for general users; admins have no role. |
| REQ-GEN-01..10 weekly generation, JSON, validation, versioning, control cards, run log | Section 4 | The weekly schedule is built, but the pilot runs by hand first. |
| REQ-CARD-01..08 player, timing, abandoned | Section 6 | Adds server-side `opened_at`, hidden-tab subtraction, 1/2/3 shortcuts. |
| REQ-SCORE-01..08, scoring table, ledger | Section 7 | Weights 1/3/5 replace the PDF's level base. Unit test for every row of the scoring table. |
| REQ-LB-01..05 | Section 7 | **Adds a per-module board**, which the PDF does not have (it has global and per form). Module = sum over its forms, so no extra data. |
| REQ-AN-01 per-user detail | Section 8 | |
| Not in the PDF | **Functional/technical content contract** (section 3) | The PDF defines the role only as an answer *style* for chat. Here it also decides which *cards* a user gets. Needs sign-off. |

Deliberate differences from the PDF: the module leaderboard, the quarantined legacy cards, and keeping the daily deck (D3, D4).

---

## 3. Functional vs technical: the content contract

This is the part that must never leak, so it is enforced **three times**: in the *input* the model sees, in the *prompt*, and in an *automatic check* before saving.

### 3.1 What each audience may talk about

| | Functional card | Technical card |
|---|---|---|
| Audience | Business user: storekeeper, buyer, accountant | Developer, support engineer, implementer |
| Allowed | What the form is for, who uses it, when, the business flow before and after it (PO → GRN → Bill), statuses and approvals in business words, business rules and their effect ("a GRN cannot exceed the PO quantity plus tolerance"), what error messages *mean* for the user, calculations in plain words | Tables and columns, stored procedures, method and layer names, how a save/load/validate runs, field types and lengths, mandatory flags, posting and stock effects at table level, validation conditions, edge cases, which rule is implemented by which procedure |
| **Forbidden** | Table, column, stored procedure, schema or method names; form **codes** (`fGRN`, `mItemMaster`); control types (dropdown, text box, tab, grid, popup, check box); field lengths; keyboard shortcuts; "the code", "the database", "the screen's backend"; rule ids (`BR-12`, `MSG-09`) | Pure business-process questions with no system detail (those belong to the functional set); rule ids and message ids as the only content |
| Naming | Form **display title** only ("Material Receipt Note (GRN)") | Form code allowed alongside the title |
| Test question | "Could a user who has never seen the system's internals answer and understand this?" | "Does it teach something about how the system works that the functional set does not?" |

Edge: the *same fact* can appear in both sets in different words (functional: "you cannot receive more than ordered plus the allowed tolerance"; technical: which table holds the tolerance and which check raises the message). They are separate cards with separate topic keys.

### 3.2 Three layers of enforcement

1. **Input split.** The functional generation call is given only the functional evidence bundle (3.3). It never sees table names, procedures or method notes, so it cannot repeat them.
2. **Prompt.** Each audience has its own generation skill (`/generate-functional-cards`, `/generate-technical-cards`) with the allowed and forbidden lists above, the level length rules, and "one topic, one statement".
3. **Automatic leak check (functional cards only), before saving.** A card is rejected and logged if it matches any of:
   - form-code or table-style tokens: `\bf[A-Z][A-Za-z]+\b`, `\b[mt][A-Z][A-Za-z]+\b`, `\b[A-Za-z]+\.[A-Za-z]+\b` when it looks like `schema.table`;
   - rule/message ids: `\b(BR|MSG|VAL)-?\d+\b`;
   - words: stored procedure, table, column, schema, query, database, method, control, dropdown, textbox, grid, popup, tab, checkbox, button, Ctrl+, API, code;
   - field-length patterns: `\(\d+\)`, "\d+ characters".
   Then a second, cheap model pass (a judge) is asked "does this mention anything only a developer would know? yes/no + the phrase". Any yes is rejected. The denylist is a file (`kb/lint/functional-denylist.yaml`) so reviewers can extend it.

### 3.3 Evidence bundles from the YAML

Each form file has `summary`, `purpose`, `users`, `functional_description`, `actions`, `validations`, `method_notes`, `manages`, `uses_concepts`; rules and concepts come from `rules.yaml` and `concepts.yaml`; processes from `processes/*.yaml`.

| Source field | Functional bundle | Technical bundle | Note |
|---|---|---|---|
| `title`, `summary`, `purpose` ("What it is / When it applies") | yes | yes | Business words already. |
| `users` | yes | yes | |
| Process steps (previous and next form), `manages` | yes, **as display titles** | yes, with codes | Gives the PO → GRN → Bill flow. |
| `rules.yaml`: `summary` and `type` for rules that `applies_to` the form | yes (the summary only) | yes (summary + `description` + `implemented_by`) | Rule `description` mixes code evidence, so it is technical-only. |
| `validations` (message text) | **cleaned list only** (`user_messages`: full sentences, fragments, row suffixes and anything that trips the leak check removed) | yes, raw | Raw strings contain field names and "in row". |
| `functional_description` (controls, types, lengths, tabs) | **no** (it is a UI-component list) | yes | Names controls and lengths: technical. For Medium functional cards, an *extracted list of business field names with no control types* is derived by a small script, not the raw text. |
| `actions` (New, Save, Open, shortcuts) | no | yes | |
| `method_notes` (procedure names per method) | no | yes | |
| `concepts.yaml`: `summary`, `related_to` | yes | yes | |
| `concepts.yaml`: `tables`, `description` evidence | no | yes | |
| Graph (MCP): tables, columns, stored procedures, reads/writes | no | optional extra for Hard | Only if the YAML is too thin. |

Forms whose bundle is too thin produce **fewer cards, never padding** (REQ counts 5 / 8 / 10 are ceilings per audience, per level). The pilot includes the thin PP forms to prove this.

---

## 4. Generation pipeline

### 4.1 Card shape and levels

| Level | Length (PDF) | Functional covers | Technical covers | Ceiling per form |
|---|---|---|---|---|
| Easy | 3–4 lines, ≤ 60 words | What the form is for, who uses it, where it sits in the flow | Which module and tables it belongs to, the master/transaction type, the main method it runs through | 5 |
| Medium | 6–10 lines, 100–180 words | Key business fields, statuses, approval steps, forms before and after | Key fields and types, status handling, the procedures behind save and load, linked masters | 8 |
| Hard | 10–20 lines, 200–350 words | Business rules and calculations in plain words, effects on stock and accounts, edge cases for the user | Validations with conditions, posting and stock effects at table level, tables and procedures involved, edge cases | 10 |

Each card: `form`, `audience`, `level`, `topic_key`, `title`, `body` (a statement), `source_refs` (KB keys it came from, never shown to users), optional `altered_fact` for control cards.
Card identity = **form + audience + level + topic_key** (PDF identity plus audience).

### 4.2 Steps (one run = one batch)

1. **Plan.** List the forms in scope (`kb.kb_items`, type form/usercontrol, filtered by module). Create a `generation_batch` row.
2. **Bundle.** For each form build the functional and technical bundles (3.3) with a script. No model involved; the output is a small JSON file per form, saved for audit.
3. **Generate.** Two Claude calls per form, one per audience, using that audience's skill. Output is JSON: an array of cards across the three levels, with `topic_key`s. Tool permissions follow REQ-HARN-10 (the same harness, same denied tools).
4. **Validate** (reject and log, never repair silently):
   - schema: required fields, level in set, form exists, unique `topic_key` per form/audience/level;
   - word and line limits per level;
   - **leak check** (3.2) for functional cards;
   - **grounding check**: every number, quoted message and named status in the body must appear in the cited `source_refs`; otherwise reject;
   - **duplication**: a card too similar (token overlap) to another in the same form and audience is rejected.
5. **Control cards.** For about 10% of cards, a second call copies a card and changes **one** fact; the changed fact is stored in `altered_fact`. Control cards are published beside real ones and look identical (REQ-CARD-07).
6. **Version.** Compare the content hash with the live version of the same identity: unchanged → keep; changed → new version, retire the old; no longer produced → retire (REQ-GEN-06).
7. **Status.** Cards that pass step 4 are **published automatically** (REQ-GEN-07 setting = auto-publish). Cards that fail are rejected and logged, never saved as drafts.
8. **Log.** The batch row stores start/end, forms done, cards created/changed/retired/rejected, tokens, errors. A failed run resumes with the forms not yet done (REQ-GEN-09, -10).

### 4.3 Review

There is **no admin approval gate** on publishing. Quality comes from the automatic checks (schema, limits, leak check, grounding, duplicates).
For the **first load** the project owner reviews the generated JSON (`generated-cards/`, plus a readable per-module review file) before anything is removed or pushed. After that, wrong cards are caught by user flags and the corrections queue.

### 4.4 Where the old template builder goes

`lib/cards/build.ts` and `lib/sync.ts` keep working for the knowledge-base item catalog and the card-to-item links. The new generator is a separate module (`lib/generation/*`, `scripts/generate-cards.ts`) that writes only the new card fields. The earlier "level 1–3 by length" plan (`PLAN-flashcard-levels.md`) is replaced by this one: levels are now generated intent, not computed from length.

---

## 5. Who gets which cards

| User | Receives | Enforced where |
|---|---|---|
| General, role **functional** | `audience = functional`, published versions only | Server: the audience comes from the session, never from the client. Applied in the deck builder, practice player, browse, and `recordReview`. |
| General, role **technical** | `audience = technical`, published only | Same. |
| **Admin** | Both audiences, any status (can preview drafts) | A "view as" switch (Functional / Technical / Both) in the player and browse. Admin answers are stored, but not ranked (D5). |

Rules that make leakage impossible to get wrong:

- Every query that serves cards goes through **one function** (`cardsVisibleTo(user)`), tested.
- `recordReview` rejects an answer for a card whose audience does not match the user's role, even if the client sends a valid version id.
- Legacy cards have no audience and are never served to general users (D3).
- The client payload keeps the existing opaque version id; it never carries audience, form code or KB references.

Prerequisite (phase A, the authentication work): `auth.users` gets `user_type` and `role`; `auth.roles` becomes technical / functional (/ product, off). Admins have no role. Signup is replaced by admin-created accounts (REQ-AUTH-01).

---

## 6. Player and daily deck

- **Filters** (practice player): module → form → level. Unanswered first, random within (REQ-CARD-01). A progress bar shows answered over total for the filter; "All done" when empty.
- **Daily deck** (kept): composed as today (due, priority, new) but restricted to the user's audience and mixed by level (default 50% Easy, 35% Medium, 15% Hard, configurable).
- **Three answers** (REQ section 8): *Known and correct*, *New to me*, *Incorrect or incomplete* (needs a reason and a correction of at least 15 characters). Keys 1, 2, 3. The reason list maps to the existing feedback categories (Wrong fact → incorrect, Outdated → outdated, Missing detail → incomplete, Does not apply → other).
- **Time monitoring and the read-time lock.** The clock runs from the moment the card is **shown** (server stores `opened_at`) to the moment an option is **selected** (`answered_at`, server clock).
  - **Designated time** for a card = `max(4 s, words ÷ 5)` (an Easy card of 60 words: 12 s; a Hard card of 300 words: 60 s). It is computed from the card's word count, so it is not stored.
  - **Locked until then.** The three answer buttons (and keys 1, 2, 3) are disabled and show a countdown. The countdown only runs while the tab is visible and the user is active (pauses when the tab is hidden or the user is idle for more than 60 s).
  - **The server enforces it too**, not just the screen: an answer is refused (409, "read the card first") if `now − opened_at` is below the designated time, or if the active time the browser reports (it can only subtract hidden/idle time, never add; REQ-SCORE-06) is below it. A forged request therefore cannot skip the wait.
  - Stored per view: raw time, active time (capped at 10 minutes), and the designated time in force at the time. Admin analytics (average and median time per card, per level, per form) read from these.
  - Because early answers are impossible, "too fast" answers cannot happen on the normal path; the five-in-a-row pause is kept only as a guard against a modified client.
- **Abandoned** cards are recorded with their time and stay unanswered.
- **My answers**: read-only history.
- One scored answer per user per card version; a new version can be answered again (REQ-CARD-02).

---

## 7. Weights, anti-cheat and the leaderboard

### 7.1 Card weights (admin-editable, versioned)

There is no separate points table. A card's **weight** is set by its level and is what a valid answer earns:

| Level | Weight |
|---|---|
| Easy | **1** |
| Medium | **3** |
| Hard | **5** |

| Event | Score | Condition |
|---|---|---|
| Known and correct | the card's weight | The read-time lock was satisfied (always true once the server enforces it) |
| New to me | the card's weight | Same |
| Incorrect: flag submitted | 0 | Pending review |
| Incorrect: flag confirmed | 5 × weight (PDF default, adjustable) | Admin confirms |
| Incorrect: flag rejected | 0 | |
| Control card correctly flagged | 3 × weight | |
| Control card marked "Known" | −3 × weight | Blind click |

Open item: whether confirmed corrections keep the PDF's 5× multiplier on top of the new weights. It is a setting; the default above keeps the PDF's behavior.

Minimum read time is the designated time in section 6. About 10% of cards shown are controls. "Known"/"New" scores are capped at 200 a day (adjustable); correction scores are not capped. Scores are earned only on the first answer to a card version.

### 7.2 Ledger and ranking

- `learning.score_ledger` is **append-only**: user, event, score, card version, rule version, time. Nothing else stores a score; every board is computed from it, so changing a weight and recalculating is safe (REQ-SCORE-07).
- **Module rank** = sum of ledger scores for cards whose form belongs to that module. **Overall rank** = sum over all modules. **Form rank** = sum for that form. None of these is stored.
- Periods: this week and all time. Tie-break: more confirmed corrections, then who reached the score first (REQ-LB-04).
- Columns: rank, name, role, score, cards answered, confirmed corrections (REQ-LB-02).
- **Visible to every signed-in user**, general and admin. A user also sees their own rank and score to the next place. Updated on each answer (REQ-LB-05).
- Reliability score (control cards caught ÷ seen) is **admin-only** (REQ-SCORE-08).

---

## 8. What the admin sees

- **Per-user progress** (extends the existing Team page): score and rank (overall and per module), cards answered by level, form and module, answer mix (Known / New / Incorrect), average and median active time, too-fast rate, reliability, flags and their outcomes, coverage grid user × form, timeline.
- **Both audiences**: admin can filter every table by audience and see functional and technical users side by side.
- **Corrections queue** (REQ section 9): disputed cards (2 flags, configurable), side-by-side flags, confirm / reject / partly confirm with a note, then a KB fix list exportable as CSV. Control cards skip the queue (REQ-CORR-02).
- **Batch run history** and the card review sheet.
- Export to CSV and Excel with the active filters.

---

## 9. Database changes (on top of the modular schema)

| Schema | Change | Why |
|---|---|---|
| `auth` | `users.user_type` (admin/general); `users.role_id` nullable (null for admins); `roles` rows technical, functional, product (off) | REQ-ROLE |
| `kb` | `cards` + `audience` (functional/technical, **null for legacy**), `level` (easy/medium/hard), `topic_key`, `altered_fact` (null unless a control card); unique `(kb_item_id, audience, level, topic_key)` | Identity and segregation. "Is control" is `altered_fact IS NOT NULL`, not a second column. |
| `kb` | `card_versions` + `status` (draft/published/disputed/retired), `batch_id`, `source_refs text[]`, `word_count`; `cards.status` is dropped in favor of the version's status | One source of truth for a card's state (PDF model). |
| `kb` | new `generation_batches` (started/ended, trigger, counts, tokens, status, error) | REQ-GEN-09 |
| `learning` | `card_views` (user, card version, opened_at, answered_at, active_ms, raw_ms, outcome answered/abandoned); the server rejects an answer before the designated read time | REQ-CARD-05/06 and the read-time lock |
| `learning` | `card_reviews`: replace `knew_it` + `verdict` with one `answer` enum (known/new/incorrect); link to the view | Two columns were holding one fact. |
| `learning` | `card_feedback`: add `reviewer_id`, `decision` (confirmed/rejected/partial), `note`, `decided_at` | REQ-CORR-01 |
| `learning` | new `score_ledger`, `scoring_rules` (version, json: level weights 1/3/5, multipliers, daily cap; active_from) | REQ-SCORE-07 |
| `learning` | views: `leaderboard` (overall / module / form × week / all time), `card_health` and `user_knowledge` extended with audience and level | Boards are computed, not stored. |

Level weights live in the `scoring_rules` JSON, not on the card, so changing them never touches cards.

---

## 10. Phases, in order

| Phase | Delivers | Done when |
|---|---|---|
| **A. Auth and roles** (the next task you named) | `user_type`, role, admin-created accounts, lockout and audit per REQ-AUTH | A functional user cannot open admin pages; role and type come from our database (REQ-AUTH-03). |
| **B. Schema** | Section 9 migration on `knowledge_review_test`; legacy cards quarantined | Migration runs from scratch and on a copy of the data; all existing tests pass. |
| **C. Generator (pilot)** | Bundles, two skills, validation, leak check, control cards, batch log, review sheet | A run on the pilot forms yields valid cards at all levels; **a re-run with no KB change creates no new versions** (PDF acceptance); zero functional cards fail the leak check on manual review. |
| **D. Player and access rules** | Filters, three answers, timing, `cardsVisibleTo`, admin "view as" | A functional user cannot receive or answer a technical card, even by forging a version id; active time excludes hidden-tab time. |
| **E. Scoring and leaderboard** | Ledger, anti-cheat, boards, rank widget | Every row of the scoring table has a unit test; an answer before the read time is refused by the server; a control card marked "Known" deducts score; the board shows overall and per module to every login. |
| **F. Corrections and admin analytics** | Review queue, KB fix list, per-user pages, exports | Exported numbers match the database. |
| **G. Weekly schedule** | Cron/scheduler, publish setting | A scheduled run and a manual run produce the same result. |

---

## 11. Delivery for MM, PM and FI: JSON first, then Postgres

| Step | What happens |
|---|---|
| 1 | `scripts/cards/build-bundles.ts` splits each form into a functional and a technical evidence bundle (`generated-cards/_bundles/`). 270 forms: MM 98, PM 60, FI 112 (including user controls). |
| 2 | Calibration on three forms (fGRN, fEquipmentDownPeriod, fExpenseAdvance), both audiences: read, tune prompts and the leak list. |
| 3 | Full generation per form and audience into `generated-cards/<MODULE>/<form>.<audience>.json`, each validated by `scripts/cards/validate-cards.ts`. |
| 4 | Owner review of the JSON. Fixes are made in the JSON or by re-running a form. |
| 5 | **Load:** retire (and remove from play) the old template cards, create `kb.cards` / `card_versions` from the JSON with audience, level and weight, status published. Old reviews keep pointing at their old versions. |
| 6 | Checks: counts per module/audience/level match the JSON; a functional test user gets only functional cards; the read-time lock refuses an early answer. |

Volume: at most 23 cards per form and audience (5 easy, 8 medium, 10 hard), so up to ~12,000 cards for 270 forms; thin forms produce fewer. Cards for other modules stay as they are until their turn.

Acceptance for the JSON: every file validates; zero functional cards trip the leak check **and** a human read of a sample finds none; technical cards add implementation detail the functional set lacks; a re-run with unchanged evidence changes nothing.

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Functional cards leak technical wording | Input split + prompt + automatic check + judge pass + human review in the pilot |
| Model invents facts | Grounding check against cited sources, one-off owner review of the JSON before the first load, then the corrections queue (no per-card approval gate) |
| Thin forms produce weak cards | Ceilings not quotas; skip rather than pad |
| Score farmed by speed or claiming knowledge | Read-time lock enforced on the server, control cards, daily cap, first answer only, server-side timing |
| Legacy and new cards confuse users | Legacy quarantined, not deleted; reviews and history stay intact |
| Two tracks make a small user base thin per board (10–15 users) | Role chip on the board with an "Everyone" tab; revisit after the pilot |
| Claude licence/usage limits (PDF risk 1) | The harness keeps credentials in configuration; run batches overnight; the pilot is small |

---

## 13. Next step

1. Phase A and B can start now (auth plus schema).
2. In parallel, the pilot generator (phase C) can be built and run on the three pilot modules without touching users, so we can read real cards and tune the prompts and the leak list before the player exists.
