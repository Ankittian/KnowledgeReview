# Docker Compose implementation: what runs, in what order

How `docker compose --profile app up -d --build` works today, and which script runs at each step. For the operator's step-by-step see [EC2-SETUP.md](EC2-SETUP.md).

## 1. Overview

```
 .env ──► docker compose --profile app up -d --build
              │
              ▼
 ┌────────────┐   healthy   ┌──────────────────────┐  exit 0   ┌───────────┐
 │ 1 postgres │ ──────────► │ 2 init (one-shot)    │ ────────► │ 3 web     │ ──► (4 nginx, profile "tls")
 │ postgres:16│             │ npm run deploy:init  │           │ next start│
 └────────────┘             └──────────────────────┘           └───────────┘
```

Each step starts only when the previous one succeeded (`depends_on` with `service_healthy` / `service_completed_successfully`). If `init` fails, `web` never starts.

## 2. Build phase (`--build`)

`Dockerfile` is multi-stage. Compose builds two targets from it:

| Stage | Used by | What it does |
|---|---|---|
| `deps` | all | `npm ci` (installs all dependencies, including dev tools such as `tsx`). |
| `build` | `web` | `COPY . .`, then `npm run build` (= `next build`), then `npm prune --omit=dev`. |
| `init` | `init` service | From `deps`: `COPY . .`, runs as user `node`, `CMD ["npm","run","deploy:init"]`. Keeps dev dependencies because the setup scripts run with `tsx`. Sets `KB_DIR=/app/kb`. |
| `run` | `web` service | Slim runtime. Copies `.next`, `node_modules` (production only), `db/`, `claude-harness/`, `kb/`, `public/`. Runs as user `app` (uid 10001). `CMD next start -H 0.0.0.0 -p 3000`. Health check fetches `/login`. |

## 3. Step by step

### Step 1: `postgres` (container `kr-postgres`)

- Image `postgres:16`. Creates the user, password and database from `POSTGRES_USER`, `POSTGRES_PASSWORD` (required, compose stops if empty) and `POSTGRES_DB`.
- Data: volume `kr_pgdata`. The database starts **empty** on the first run and keeps its data afterwards.
- Mounts `infra/initdb` into `docker-entrypoint-initdb.d` (dev only: creates the extra empty test databases). Runs only when the volume is new.
- Health check: `pg_isready` every 5 s, up to 12 retries. `init` waits for this.
- Host port: `${POSTGRES_BIND}:${POSTGRES_PORT}:5432` (use `127.0.0.1` on EC2). Inside the compose network it is always `postgres:5432`.

No application script runs here.

### Step 2: `init` (one-shot, then exits)

Runs `npm run deploy:init`, defined in `package.json` as four commands chained with `&&` (the first failure stops the chain and fails the container):

```
tsx scripts/db-init.ts
&& tsx scripts/seed-admin.ts --if-missing
&& tsx scripts/sync-cards.ts --entities-only
&& tsx scripts/push-cards.ts
```

`DATABASE_URL` is built by compose for host `postgres`; everything else comes from `.env`.

| # | Script | What it does | Reruns on a populated DB |
|---|---|---|---|
| 2a | `scripts/db-init.ts` (`npm run db:init`) | Calls `applySchema()` in `db/client.ts`. If `public.users` does not exist (empty database) it runs every statement of **`db/schema.sql`** in one transaction (all tables, indexes, foreign keys, and the seed rows for roles `admin`, `functional`, `technical`). Then it **always** re-runs `db/views.sql` (the reporting views, `CREATE OR REPLACE`). | Tables untouched; views refreshed. |
| 2b | `scripts/seed-admin.ts --if-missing` | Creates the user from `ADMIN_USERNAME` / `ADMIN_PASSWORD` (default `admin` / `admin@123`) with an argon2 hash and the `admin` role. With `--if-missing` an existing admin is never changed. | No change. |
| 2c | `scripts/sync-cards.ts --entities-only` (`runKbSync` with `entitiesOnly`) | Reads the YAML knowledge-base snapshot from `kb/` (`KB_DIR`) and loads `kb_items` (about 5,862 rows) plus their links. `--entities-only` skips the ~3,000 old template cards. It deactivates KB items that are not in the YAML, which includes the 18 generated items from step 2d. | Applies only differences. |
| 2d | `scripts/push-cards.ts` (`lib/cards/push/*`) | Reads every JSON in `data/generated-cards/` (MM and PM functional catalogs), default mode **append**: each file in one transaction. Creates missing `kb_items`, inserts new cards, adds a new version when the text changed, skips unchanged cards, links cards to KB items from `source_refs`, then re-activates the generated KB items it used (so Browse shows them). Never purges. | Skips unchanged cards. |

Expected end state on an empty database: 1 admin, 5,862 `kb_items`, 436 active cards, 1,781 links. The container then exits with code 0.

Mode and scope of the card push are never changed by compose. Purge (`--mode purge`) deletes a module's cards with their reviews and feedback, so it is only run by hand (see [PUSH-FLASHCARDS.md](PUSH-FLASHCARDS.md)).

### Step 3: `web` (container `kr-web`)

- Starts after `init` exited 0 (`service_completed_successfully`).
- Runs `next start` on `PORT`, which compose sets from `APP_PORT`, and publishes `${APP_BIND}:${APP_PORT}:${APP_PORT}`. Frontend and backend are the same process, so this is the only app port. The Dockerfile `CMD` and health check read `PORT`; no rebuild is needed to change it.
- Environment: `.env` plus `DATABASE_URL` (host `postgres`), `COOKIE_SECURE` (default `false`), `CLAUDE_CONFIG_DIR=/home/app/.claude`, `CLAUDE_HARNESS_DIR=/app/claude-harness`.
- Volume `kr_claude` holds Claude credentials and session transcripts (needed to resume chats).
- The Knowledge Assistant runs the Claude engine from `claude-harness/` as a child process. It gets only an allow-list of environment variables (never `DATABASE_URL`, `JWT_SECRET` or `KG_MCP_TOKEN`), and needs `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` and a working `KG_MCP_URL`.
- Health check: `GET /login` on `PORT` every 30 s.

No setup script runs here; the schema and data already exist.

### Step 4 (optional): `nginx` (profile `tls`)

Only with `--profile tls`. `nginx:1.27-alpine`, host ports `HTTP_PORT` / `HTTPS_PORT` (default 80/443) mapped to 80/443 inside. Config template `infra/nginx/default.conf.template`: the nginx image fills in `APP_PORT` (upstream `web:${APP_PORT}`) and `HTTPS_PORT` (the http-to-https redirect) at start, certificates from `infra/certs/` (`fullchain.pem`, `privkey.pem`). Requires `COOKIE_SECURE=true` and `APP_BIND=127.0.0.1`.

## 3a. Ports

Every port is set in `.env`; nothing is fixed in the Dockerfile or compose file.

| Setting | Default | What |
|---|---|---|
| `APP_PORT` | 3000 | Web app (frontend and backend, one process). Host and container side. |
| `POSTGRES_PORT` | 5432 | Postgres on the host. Containers use `postgres:5432`. |
| `HTTP_PORT` / `HTTPS_PORT` | 80 / 443 | nginx, `tls` profile only. |
| `APP_BIND` / `POSTGRES_BIND` / `NGINX_BIND` | `0.0.0.0` / `127.0.0.1` / `0.0.0.0` | Host interface each port is published on. |
| `POSTGRES_CONTAINER` / `WEB_CONTAINER` / `NGINX_CONTAINER` | `kr-postgres` / `kr-web` / `kr-nginx` | Container names (change to run a second copy). |

## 4. Scripts and files reference

| File | Role |
|---|---|
| `docker-compose.yml` | Service order, env wiring, volumes, ports. |
| `Dockerfile` | Stages `deps`, `build`, `init`, `run`. |
| `.env.production.example` | Template for the server's `.env`, including the ports block. |
| `infra/nginx/default.conf.template` | nginx config with `${APP_PORT}` and `${HTTPS_PORT}` placeholders. |
| `scripts/db-init.ts` | Create tables if empty, refresh views. |
| `db/schema.sql` | Baseline schema (generated, no migrations). |
| `db/views.sql` | Reporting views, re-applied every run. |
| `db/client.ts` | `applySchema()`, `createDb()`. |
| `scripts/export-schema.mjs` | `npm run db:export-schema`: regenerates `db/schema.sql` from `db/schema.ts` after a schema change. |
| `scripts/seed-admin.ts` | First admin (`--if-missing`) or password reset (without the flag). |
| `scripts/sync-cards.ts` | KB YAML to `kb_items` (`--entities-only` for deploys). |
| `scripts/push-cards.ts` | CLI over `lib/cards/push/` (`types`, `catalog`, `purge`, `kb-items`, `cards`, `index`). Options: `--mode append|purge`, `--scope audience|module`, `--dry-run`. |
| `data/generated-cards/*.json` | The card catalogs that get pushed. |
| `kb/` | The knowledge-base YAML snapshot. |

## 5. Re-deploys and what is preserved

| Action | Effect |
|---|---|
| `docker compose --profile app up -d --build` again | `init` runs again; nothing is lost or duplicated. |
| New card JSON in `data/generated-cards/` | Appended on the next deploy (new cards inserted, changed text becomes a new version). |
| `docker compose down` | Stops containers, keeps `kr_pgdata` and `kr_claude`. |
| `docker compose down -v` | Deletes the database and Claude volumes. Everything restarts from empty. |
| Schema change in `db/schema.ts` | Run `npm run db:export-schema` and commit. Existing databases are **not** altered by the setup: apply an `ALTER TABLE` by hand. |

## 6. Failure behaviour

| Failure | Result |
|---|---|
| `POSTGRES_PASSWORD` empty | Compose refuses to start. |
| Any of 2a to 2d fails | `init` exits non-zero, `web` is not started. Read it with `docker compose --profile app logs init`, fix, run the compose command again. |
| Push of one catalog file fails | That file's transaction rolls back; the database stays as it was before that file. |
| Postgres not healthy within about 60 s | `init` does not start. |

## 7. Useful commands

```bash
docker compose --profile app up -d --build          # everything
docker compose --profile app logs -f init           # watch the setup
docker compose --profile app ps                     # postgres healthy, web healthy, init exited (0)
docker compose --profile app run --rm init npx tsx scripts/push-cards.ts --dry-run   # preview a push
```
