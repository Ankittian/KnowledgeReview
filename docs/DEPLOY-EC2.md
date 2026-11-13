# Deploying Knowledge Review on EC2 with Docker

One build brings up the whole application: Postgres, the one-time setup, and the web app. This guide is the step-by-step.

## 1. What happens when you start it

`docker compose --profile app up -d --build` builds the images and starts, in this order:

| Step | Container | What it does |
|---|---|---|
| 1 | `postgres` | Starts an empty Postgres 16. Data lives in the `kr_pgdata` volume. Ready when its health check passes. |
| 2 | `init` (runs once, then exits) | `npm run deploy:init`: **creates the tables** from `db/schema.sql` (only if the database is empty), **creates the admin user** from `ADMIN_USERNAME` / `ADMIN_PASSWORD` (only if it does not exist), **loads the knowledge base** from `kb/` into `kb_items`, **pushes the flashcards** from `data/generated-cards/*.json` (append mode). |
| 3 | `web` | Starts the app on `APP_PORT` once `init` finished successfully. |
| (optional) | `nginx` | TLS in front of the app (`--profile tls`), see section 7. |

Everything is repeatable: running it again on a database that already has data changes nothing. The tables are only created on an empty database, an existing admin keeps its password, cards that are unchanged are skipped, and nothing is ever purged.

## 2. Prepare the EC2 instance (once)

1. **Launch** an Amazon Linux 2023 or Ubuntu instance. `t4g.large` (ARM) or `t3.large` (x64) with 30 GB disk is enough. The Dockerfile builds on both.
2. **Security group, inbound:** port 22 from your IP only, and your app port (default 3000) from the people who need it. With TLS: 8080 and 8443 instead (`HTTP_PORT` / `HTTPS_PORT`). **Never open 5432.**
3. **Install Docker and Git.**
   Amazon Linux: `sudo dnf install -y docker git && sudo systemctl enable --now docker && sudo usermod -aG docker $USER`, then log out and back in.
   Ubuntu: `sudo apt-get install -y docker.io docker-compose-v2 git && sudo usermod -aG docker $USER`, then log out and back in.
   Amazon Linux also needs the compose plugin: `sudo mkdir -p /usr/local/lib/docker/cli-plugins && sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m) -o /usr/local/lib/docker/cli-plugins/docker-compose && sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose`.
4. Check: `docker compose version`.

## 3. Get the code and configure it

```bash
git clone <your repository url> knowledge-review
cd knowledge-review
cp .env.production.example .env
chmod 600 .env
```

Edit `.env` and fill in:

| Setting | Value |
|---|---|
| `POSTGRES_PASSWORD` | A new secret. Use hex so it is safe in a URL: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` (or `openssl rand -hex 24`). |
| `JWT_SECRET` | A new secret per server: `openssl rand -base64 48`. Changing it later logs everyone out. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin@123` as set in the template. Used only when the admin does not exist yet. |
| `APP_PORT` | The port you will open in the browser (default 3000). |
| `COOKIE_SECURE` | `false` over plain http, `true` over https. With `true` on plain http nobody can log in. |
| `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` | The assistant's Claude credential. There is no `claude login` inside the container. |
| `KG_MCP_URL` / `KG_MCP_TOKEN` | The knowledge-base MCP server. Use a host name that matches the server's TLS certificate (a bare IP gives `kb_unavailable`). |

`.env` is git-ignored. Do not commit it.

## 4. Build and start

```bash
docker compose --profile app up -d --build
```

The first build takes several minutes (it installs the dependencies and builds the Next.js app). Watch the setup:

```bash
docker compose --profile app logs -f init
```

Expected: `Empty database: tables created`, `Admin 'admin' created.`, the knowledge-base sync report, and a card summary ending in `Total Active Cards: 436`. Then:

```bash
docker compose --profile app ps          # postgres: healthy, web: healthy, init: exited (0)
```

## 5. Log in and check

1. Open `http://<EC2 public IP>:<APP_PORT>/login` and sign in as `admin` / `admin@123`.
2. **Change the password straight away** (Admin > Users). `admin@123` is a known default.
3. Look at Today, Browse and, as admin, Admin > Health. Create employee users under Admin > Users and give each an answer style for the assistant.

## 6. Operating it

| Task | Command |
|---|---|
| See what is running | `docker compose --profile app ps` |
| App logs | `docker compose --profile app logs -f web` |
| Update to new code | `git pull && docker compose --profile app up -d --build` (init runs again; nothing is lost) |
| Add or change flashcards | Put the JSON in `data/generated-cards/`, then `git pull` and update as above. Or run now: `docker compose --profile app run --rm init npx tsx scripts/push-cards.ts --dry-run` and without `--dry-run` to apply. Purge is never run automatically. |
| Replace a module's cards (deletes reviews) | `docker compose --profile app run --rm init npx tsx scripts/push-cards.ts --mode purge MM.functional.json` after a `--dry-run`. See [PUSH-FLASHCARDS.md](PUSH-FLASHCARDS.md). |
| Reset the admin password | `docker compose --profile app run --rm init npx tsx scripts/seed-admin.ts --password '<new>'` (without `--if-missing` it resets). |
| Database backup | `docker exec kr-postgres pg_dump -U kr_app knowledge_review_final \| gzip > kr-$(date +%F).sql.gz` |
| Restore | `gunzip -c kr-DATE.sql.gz \| docker exec -i kr-postgres psql -U kr_app knowledge_review_final` into an empty database |
| Stop (keeps data) | `docker compose --profile app down` |
| Wipe everything and start over | `docker compose --profile app down -v` (deletes the database volume) |

Back up the database daily (cron) and copy the file off the instance, for example to S3.

## 7. HTTPS with nginx (optional)

With a domain name pointing at the instance:

1. Put `fullchain.pem` and `privkey.pem` in `infra/certs/`.
2. In `.env` set `COOKIE_SECURE=true` and `APP_BIND=127.0.0.1` (only nginx reaches the app).
3. Open ports 8080 and 8443 (close the app port). Override with `HTTP_PORT` / `HTTPS_PORT` in `.env`; the site is then at `https://<domain>:8443`.
4. `docker compose --profile app --profile tls up -d --build`.

## 8. The database schema

There are no migration files. `db/schema.sql` is the full schema (every table, column, index and foreign key) and is applied when the database is empty. It is generated from `db/schema.ts`:

```bash
npm run db:export-schema      # after any change to db/schema.ts; commit the result
```

An existing database is never altered by the setup. If you change the schema later, write the `ALTER TABLE` yourself and run it against the live database (`docker exec -i kr-postgres psql -U kr_app knowledge_review_final`), and regenerate `db/schema.sql` so new installs match.

## 9. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `POSTGRES_PASSWORD` error on start | Set it in `.env`. |
| `init` exits with an error | `docker compose --profile app logs init` shows it. `web` does not start until `init` succeeds. Fix the cause and run the compose command again. |
| Cannot log in, no error | `COOKIE_SECURE=true` over plain http. Set it to `false` (or use https). |
| Assistant answers "knowledge base is not reachable" | `KG_MCP_URL` unreachable or its certificate does not match the host name. Test from the instance: `curl -v $KG_MCP_URL`. |
| Assistant says Claude is unavailable | No `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` in `.env`. |
| Password with special characters breaks the database URL | Use a hex `POSTGRES_PASSWORD`. |
| Port already in use | Change `APP_PORT`. |
