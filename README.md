# Knowledge Review

Daily flashcards built from the SpectrumERP functional knowledge base (the curated YAML behind the knowledge graph).
Employees review a small deck every day. For each card they answer two questions:

1. **Did you know it?** Yes / No. This measures employee knowledge.
2. **Is the card correct?** Correct / Needs fix (with a suggested correction) / Not sure. This verifies the knowledge base.

Every interaction is logged in Postgres. Every card is traced **in the backend only** to the YAML file, key and field it
came from, and linked to the related forms, processes, rules and concepts. Admins can therefore see exactly which
knowledge needs to change, and export it in a form that maps straight back onto the YAML.

This folder is self-contained. Apart from a copy of the YAML in `kb/`, it does not depend on the SpectrumERP repo.

## Quick start (local, needs Docker)

Postgres runs in Docker (the same setup is used on EC2).

```powershell
npm install
copy .env.example .env        # set POSTGRES_PASSWORD (and the same password inside the three *_DATABASE_URL lines) and ADMIN_PASSWORD
npm run db:up                 # starts Postgres 16 in Docker and waits until it is healthy
npm run db:setup              # migrate + build cards from kb/ + create the admin
npm run dev                   # http://localhost:3000
```

Postgres listens on `127.0.0.1:5432` only. Data lives in the `kr_pgdata` Docker volume: `npm run db:down` keeps it,
`docker compose down -v` deletes it. The first start also creates `knowledge_review_test` and `knowledge_review_e2e`,
which `npm test` and `npm run e2e` wipe on every run.

## Knowledge Assistant (chat)

`/chat` lets employees ask questions about the SpectrumERP knowledge base. Claude answers through the Claude Agent SDK
using the KB MCP server, in the user's answer style (Technical / Functional / Product, set by an admin under
Admin → Users). Admins pick the style per chat and see every conversation under Admin → All chats.
Set `KG_MCP_URL`, `KG_MCP_TOKEN` and Claude credentials in `.env`, run `npm run db:init`, then
`npm run chat:check` to verify the setup. Design, security and deployment: [docs/CHAT-HARNESS.md](docs/CHAT-HARNESS.md).

## Access from other devices on the LAN

```powershell
npm run dev:lan                     # dev server on 0.0.0.0:3000
# or, faster for daily use:
npm run build; npm run start:lan    # production server on 0.0.0.0:3000
```

Open `http://<this PC's LAN IP>:3000` (e.g. `http://192.168.0.59:3000`; find the IP with `ipconfig`) on phones and
other PCs on the same network.

* **Windows Firewall:** allow inbound TCP 3000 on the Private profile once, from an *administrator* PowerShell:
  `New-NetFirewallRule -DisplayName "Knowledge Review (TCP 3000)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private`
  The network must be set to **Private** (Settings → Network → Wi-Fi → Network profile type).
* **Dev mode:** `next.config.ts` adds this machine's own IPv4 addresses to `allowedDevOrigins` automatically. For other
  host names (e.g. `mypc.local`), set `LAN_DEV_ORIGINS=mypc.local`.
* **Plain HTTP:** keep `COOKIE_SECURE=false` on the LAN. Set it to `true` only behind HTTPS.
* Only one `next dev` can run per project folder. Stop an existing one (or use it; it already listens on all
  interfaces) before starting `dev:lan`.

## Production (EC2)

Full guide: [docs/DEPLOY-EC2.md](docs/DEPLOY-EC2.md). In short: copy `.env.production.example` to `.env`, fill in the secrets,
then `docker compose --profile app up -d --build`. That starts Postgres, creates the tables, the first admin and the flashcards
(`npm run deploy:init`), and serves the app on `APP_PORT`. Never open port 5432 in the security group.

## Refreshing the knowledge base

```powershell
npm run kb:import -- D:\SpectrumERP\KnowledgeGraph\domain   # copies modules/concepts/rules/processes/forms into kb/
npm run cards:sync                                          # or Admin -> Settings -> Sync now
```

The sync is idempotent: run it twice and the second run changes nothing.

* **Changed text** creates a new card version. Old answers keep pointing at the version they saw. Open feedback on
  the changed card becomes `stale` so it gets re-verified.
* **Removed YAML items** retire their cards.
* **Data-quality findings** (for example rule summaries cut off after a colon) are reported
  on every sync and listed under Admin → Settings. The current snapshot has 13 findings (all truncated rule summaries).

## The review → fix loop

1. Employees answer their cards at `/today` (a new random set each sign-in, up to the daily limit). It works on mobile (tap, swipe, bottom sheet) and on desktop
   (keyboard: `Space` flip · `←`/`→` knew · `C`/`I`/`U` verdict).
2. **Admin → What needs change** lists flagged cards worst first, plus roll-ups *by form / process / rule / concept*,
   with drill-down to each YAML item.
3. **Admin → Feedback** is where reviewers triage suggestions: accept, reject, or mark applied with the commit SHA.
4. **Export needs-change** (`/api/admin/export/needs-change?format=jsonl|csv|md`, or `npm run report:needs-change`)
   gives one row per `yaml_file + entity_key + field`. Each row has the current text, vote counts, the score, the
   linked forms, processes and rules, and every suggestion. Apply the fixes to the YAML (by hand or with Claude Code),
   commit, re-import and sync, then mark the feedback *applied*.

## How cards are generated (`lib/cards/build.ts`)

Cards are generated **only at the business level**: business rules, business concepts and processes. There are no
form-level cards (screen purpose, screen elements, on-screen messages) and no code-level cards.

| Kind | From | Count (current KB) |
|---|---|---|
| `rule.summary` | `rules.yaml`: business rules (summary + messages) | 677 |
| `concept.summary` | `concepts.yaml` | 62 |
| `process.summary` / `process.steps` / `process.next` | `processes/*.yaml` | 10 / 10 / 59 |

The 163 `shared-write-*` rules ("table X is written by N screens") are code-level and get no cards
(`isTechnicalRule`). Forms and user controls stay in the database as entities without cards of their own. That way a
rule or process card can still be linked to its forms, and admins can see "what needs change" rolled up **by form**.

Links (backend only, table `card_links`):
* rule `applies_to` gives forms and concepts; rule `processes` gives processes; plus the processes of those forms
* concept `related_to` / `parent_of` give concepts; forms that manage the concept; processes that use it
* process steps give their forms (`has_step`); process `concepts` give concepts

## Traceability stays out of the frontend

Employees only receive `{ v, context, front, back, module }` for each card. `v` is an opaque card-version id. The
server resolves the card, YAML entity and field, and stamps them on every `reviews` and `feedback` row. The e2e
suite checks that no card ids, YAML paths or link data appear in employee pages, requests or responses.

## Data model (`db/schema.ts`, views in `db/views.sql`)

* `users`, `sessions`: username + argon2id password, self sign-up as `pending` until an admin approves. Roles are
  employee, reviewer and admin.
* `kb_entities` (one row per YAML item), `cards`, `card_versions`, `card_links`
* `daily_decks` (one random set per sign-in per day), `srs_state` (Leitner boxes 1–5: 1/3/7/14/30 days)
* `reviews` (knew_it, verdict, timings, device, version, entity, field), `feedback` (category, current text,
  suggested text, comment, status)
* `interaction_events`: append-only log of sign-up, login, deck started, card shown, flipped, knew answered,
  feedback opened/cancelled/submitted, review submitted, deck completed, browse, and so on
* `audit_log` (admin actions, syncs, exports) and `settings` (deck size)
* Views:
  * `v_card_health`: each user's latest verdict on the current version; needs-change score weighted by
    reviewer reliability
  * `v_entity_health` and `v_rollup_health`: per YAML item, plus everything linked to it
  * `v_needs_change`: the actionable list
  * `v_user_knowledge_module` and `v_user_knowledge_process`: recency-weighted knowledge and coverage

### Cards per sign-in and the daily limit
Every **sign-in gets a new random set of cards**. Reloading the page within the same sign-in keeps the set. Admins
set **Cards per day** under Admin → Settings (1–100, default 10). It's the most cards an employee is shown in one
day across all of their sign-ins:

* The first sign-in of the day gets `limit` cards. A later sign-in gets a new random `limit − answered today` cards,
  and cards already answered today never repeat that day.
* Once the limit is reached, further sign-ins show "All done for today". The server also refuses extra answers.
* Changing the limit applies immediately. Raising it tops up the current sign-in; lowering it hides open cards
  beyond the new limit.

Cards are drawn at random from three pools:
* spaced-repetition cards that are due (Leitner)
* *verification priority* cards in the user's own area that are part-way to the 3-reviewer quorum, or that have
  conflicting verdicts
* new cards, from the user's area first

Each set is logged as `deck_created` (size, limit, answered today, unanswered cards from earlier sets). Each answer
records the `deck_id` it came from, and `daily_limit_reached` is logged once per day.

### Offline tolerance
Answers and events are written to `localStorage` first, then sent with retry and backoff. They are idempotent on
`client_event_id`, and the server stores at most one scored answer per card per deck.

## Scripts

| Command | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run db:init` | create the tables on an empty database (`db/schema.sql`) + (re)create views |
| `npm run db:setup` | init + sync + seed admin |
| `npm run deploy:init` | what Docker runs at start: init, admin if missing, KB items, flashcards (append) |
| `npm run db:studio` | browse every table in the browser (Drizzle Studio on `DATABASE_URL`) |
| `npm run db:query -- "SELECT ..."` | run one read-only SQL query and print the rows |
| `npm run kb:import -- <dir>` | copy a `domain/` folder into `kb/` |
| `npm run cards:sync` | build cards from `kb/` and upsert (`-- --entities-only`: KB items only) |
| `npm run cards:push` | push `data/generated-cards/*.json` (append, or `-- --mode purge`); see docs/PUSH-FLASHCARDS.md |
| `npm run seed:admin -- --username x --password y` | create or reset an admin |
| `npm run report:needs-change` | write `reports/needs-change.{jsonl,md}` |
| `npm run chat:check` | ask the KB one question through the Claude harness and try a prompt injection (no database) |
| `npm test` | unit + DB integration tests (in-memory Postgres) |
| `npm run build && npm run e2e` | Playwright: full flow on desktop + mobile, plus screenshots in `test-results/screens` |
| `npm run db:export-schema` | regenerate `db/schema.sql` after editing `db/schema.ts` |
