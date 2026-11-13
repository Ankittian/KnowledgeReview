# EC2 setup, step by step: from a blank instance to a running app

Every command to run, in order. Lines starting with `#` are comments. Run the commands on the EC2 instance unless a step says "on your PC".
How the stack works inside (what runs at each step) is in [DEPLOY-IMPLEMENTATION.md](DEPLOY-IMPLEMENTATION.md).

## Step 0. What you need before you start

| Item | Notes |
|---|---|
| AWS account and a key pair (`.pem`) | To launch the instance and SSH in. |
| The repository URL | `https://github.com/Ankittian/KnowledgeReview.git`. If it is private you need a GitHub personal access token (or a deploy key). |
| A Claude credential | `ANTHROPIC_API_KEY`, or a `CLAUDE_CODE_OAUTH_TOKEN` (made on your PC with `claude setup-token`). Needed for the Knowledge Assistant only. |
| The knowledge-base MCP server URL and token | `KG_MCP_URL` must be a **host name that matches its TLS certificate** (a bare IP fails with `kb_unavailable`), and `KG_MCP_TOKEN`. Needed for the Assistant only. |

## Step 1. Launch the EC2 instance (AWS console)

1. EC2, **Launch instance**.
2. **AMI:** Amazon Linux 2023 or Ubuntu 24.04.
3. **Type:** `t3.large` (x64) or `t4g.large` (ARM). 2 vCPU and 8 GB RAM is the minimum for the build.
4. **Key pair:** choose yours.
5. **Storage:** 30 GB gp3.
6. **Security group, inbound rules:**

   | Port | Source | Why |
   |---|---|---|
   | 22 (SSH) | your IP only | Admin access. |
   | 3000 (custom TCP) | the people who use the app | The app, over plain http. |
   | 80 and 443 | the users | Only if you add HTTPS later (step 11). |
   | 5432 | **never** | Postgres stays private. |

7. Launch, then copy the **public IPv4 address**.

The ports are not fixed: they come from `.env` (step 5). The table uses the defaults; if you change `APP_PORT`, open that port instead of 3000.

**Ports used by the deployment**

| What | `.env` setting | Default | Notes |
|---|---|---|---|
| Frontend **and** backend | `APP_PORT` | 3000 | One Next.js process serves the pages and the `/api` routes, so there is a single app port. Open it in the security group. The container listens on the same number (`PORT` is set from it). |
| Postgres (on the host) | `POSTGRES_PORT` | 5432 | Containers always reach it as `postgres:5432` on the private network. Keep `POSTGRES_BIND=127.0.0.1`; never open it in the security group. |
| nginx HTTP / HTTPS | `HTTP_PORT` / `HTTPS_PORT` | 80 / 443 | Only with `--profile tls`. |
| Interface for each | `APP_BIND`, `POSTGRES_BIND`, `NGINX_BIND` | `0.0.0.0`, `127.0.0.1`, `0.0.0.0` | `127.0.0.1` = reachable from the instance only. |

After changing a port: `docker compose --profile app up -d` (no rebuild needed). Container names can also be set (`POSTGRES_CONTAINER`, `WEB_CONTAINER`, `NGINX_CONTAINER`), for example to run a second copy on the same machine.

## Step 2. Connect

On your PC:

```bash
ssh -i /path/to/key.pem ec2-user@<EC2_PUBLIC_IP>      # Amazon Linux
ssh -i /path/to/key.pem ubuntu@<EC2_PUBLIC_IP>        # Ubuntu
```

## Step 3. Install Docker, Compose and Git

**Amazon Linux 2023:**

```bash
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER

# Compose plugin (not included in Amazon Linux)
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m) \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
```

**Ubuntu:**

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

**Log out and back in** (so the `docker` group applies), then check:

```bash
docker --version
docker compose version
git --version
```

## Step 4. Pull the code from Git

```bash
cd ~
git clone https://github.com/Ankittian/KnowledgeReview.git knowledge-review
cd knowledge-review
git log --oneline -3          # check you have the latest commits
```

Private repository: use a token as the password when asked, or

```bash
git clone https://<GITHUB_USER>:<TOKEN>@github.com/Ankittian/KnowledgeReview.git knowledge-review
```

(Do not paste the token into scripts or commit it.)

## Step 5. Create the `.env`

```bash
cp .env.production.example .env
chmod 600 .env
```

Generate the two secrets:

```bash
openssl rand -hex 24         # use as POSTGRES_PASSWORD
openssl rand -base64 48      # use as JWT_SECRET
```

Edit the file (`nano .env`) and set at least:

| Setting | Value |
|---|---|
| `POSTGRES_PASSWORD` | The hex string from above. **Required**, compose will not start without it. |
| `JWT_SECRET` | The base64 string from above. **Required**, different on every server. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin@123` (already in the template). |
| `APP_PORT` | `3000`: frontend and backend (one app). Must match the port opened in step 1. |
| `POSTGRES_PORT` | `5432`: Postgres on the host (keep `POSTGRES_BIND=127.0.0.1`). |
| `HTTP_PORT` / `HTTPS_PORT` | `80` / `443`: only for the nginx HTTPS profile. |
| `POSTGRES_BIND` | `127.0.0.1` (already in the template). |
| `COOKIE_SECURE` | `false` while you use plain `http://`. `true` only behind HTTPS. |
| `ANTHROPIC_API_KEY` **or** `CLAUDE_CODE_OAUTH_TOKEN` | The Assistant's Claude credential. |
| `KG_MCP_URL` / `KG_MCP_TOKEN` | The knowledge-base MCP server (host name, not an IP). |

Quick check that nothing required is empty:

```bash
grep -E '^(POSTGRES_PASSWORD|JWT_SECRET)=' .env
```

## Step 6. Build and start everything

```bash
docker compose --profile app up -d --build
```

This is the only deploy command. It does, in order:

1. Builds the `init` and `web` images (first time: 5 to 10 minutes).
2. Starts **postgres** (empty database) and waits until it is healthy.
3. Runs **init** once: `npm run deploy:init` which runs
   `scripts/db-init.ts` (create tables from `db/schema.sql`),
   `scripts/seed-admin.ts --if-missing` (create the admin),
   `scripts/sync-cards.ts --entities-only` (load the knowledge base),
   `scripts/push-cards.ts` (push `data/generated-cards/*.json`).
4. Starts **web** after init succeeded.

## Step 7. Watch it and verify

```bash
docker compose --profile app logs -f init       # Ctrl+C to leave
```

Expected lines: `Empty database: tables created from db/schema.sql`, `Admin 'admin' created.`, the knowledge-base sync report, and a card summary ending with `Total Active Cards: 436`.

```bash
docker compose --profile app ps
```

Expected: `kr-postgres` healthy, `kr-web` healthy, `init` exited (0).

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login      # 200
```

Optional database check:

```bash
docker exec kr-postgres psql -U kr_app -d knowledge_review_final -c \
  "select (select count(*) from users) users, (select count(*) from kb_items) kb_items, (select count(*) from cards where status='active') cards;"
```

Expected about 1 user, 5,862 KB items, 436 cards.

## Step 8. First login

1. In a browser open `http://<EC2_PUBLIC_IP>:3000/login`.
2. Sign in as `admin` / `admin@123`.
3. **Change the admin password now** (Admin, Users). `admin@123` is a known default.
4. Check Today, Browse, and Admin, Health.
5. Create employee users (Admin, Users) and give each an answer style for the Assistant.
6. Try the Knowledge Assistant. If it says Claude or the knowledge base is unavailable, see step 12.

## Step 9. Updating later (new code or new cards)

```bash
cd ~/knowledge-review
git pull
docker compose --profile app up -d --build
```

`init` runs again and is safe: tables are only created on an empty database, the admin keeps its password, unchanged cards are skipped, nothing is purged.

New or changed flashcards: put the JSON in `data/generated-cards/`, commit, `git pull` on the server, then the command above. To preview a push first:

```bash
docker compose --profile app run --rm init npx tsx scripts/push-cards.ts --dry-run
```

Replacing a module's cards (purge) deletes their reviews and feedback, so it is never automatic. Preview with `--dry-run`, then run it by hand: `docker compose --profile app run --rm init npx tsx scripts/push-cards.ts --mode purge MM.functional.json`. See [PUSH-FLASHCARDS.md](PUSH-FLASHCARDS.md).

**Schema changes.** There are no migration files. `db/schema.sql` (generated by `npm run db:export-schema` from `db/schema.ts`) is applied only to an empty database; the setup never alters an existing one. After a schema change, write the `ALTER TABLE` yourself and run it on the live database (`docker exec -i kr-postgres psql -U kr_app knowledge_review_final`), and commit the regenerated `db/schema.sql` so new installs match.

## Step 10. Backups and day-to-day operation

```bash
# Backup (run daily from cron and copy the file off the instance, for example to S3)
docker exec kr-postgres pg_dump -U kr_app knowledge_review_final | gzip > ~/kr-$(date +%F).sql.gz

# Restore into an EMPTY database
gunzip -c ~/kr-YYYY-MM-DD.sql.gz | docker exec -i kr-postgres psql -U kr_app knowledge_review_final

docker compose --profile app logs -f web        # app logs
docker compose --profile app restart web        # restart the app
docker compose --profile app down               # stop, keep the data
docker compose --profile app down -v            # stop AND DELETE the database (start over)
```

Reset the admin password:

```bash
docker compose --profile app run --rm init npx tsx scripts/seed-admin.ts --password '<new password>'
```

Start on reboot: the containers use `restart: unless-stopped`, and Docker is enabled at boot (step 3), so the stack returns after a reboot without action.

## Step 11. HTTPS (optional, needs a domain)

1. Point a DNS name at the instance's public IP and open ports 80 and 443 (close 3000).
2. Put `fullchain.pem` and `privkey.pem` in `infra/certs/`.
3. In `.env` set `COOKIE_SECURE=true` and `APP_BIND=127.0.0.1`.
4. Start with nginx:

```bash
docker compose --profile app --profile tls up -d --build
```

Open `https://<your domain>/login`.

## Step 12. Troubleshooting

| Symptom | Fix |
|---|---|
| `POSTGRES_PASSWORD` error at start | Set it in `.env`. |
| `permission denied` on `docker` | Log out and back in after `usermod -aG docker`. |
| `init` exited with an error | `docker compose --profile app logs init`, fix the cause, run step 6 again. `web` does not start until init succeeds. |
| Build killed or very slow | Not enough memory: use at least 8 GB RAM, or add swap. |
| Cannot log in, no error message | `COOKIE_SECURE=true` over plain http. Set it to `false` (or use HTTPS) and `docker compose --profile app up -d`. |
| Page not reachable from the browser | Security group does not allow `APP_PORT`; or `APP_BIND=127.0.0.1`. |
| Assistant: "knowledge base is not reachable" | `KG_MCP_URL` is unreachable or its certificate does not match the host name. Test from the instance: `curl -v $KG_MCP_URL`. |
| Assistant: Claude unavailable | `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` missing in `.env`. After editing: `docker compose --profile app up -d`. |
| Database URL error with a special-character password | Use a hex `POSTGRES_PASSWORD`. |
| Port in use | Change `APP_PORT`, `POSTGRES_PORT`, `HTTP_PORT` or `HTTPS_PORT` in `.env`, then `docker compose --profile app up -d`. |

## Checklist

- [ ] Instance launched, security group has 22 (your IP) and 3000, not 5432
- [ ] Docker, Compose, Git installed; `docker compose version` works
- [ ] Repository cloned
- [ ] `.env` created with `POSTGRES_PASSWORD`, `JWT_SECRET`, Claude credential, `KG_MCP_URL`
- [ ] `docker compose --profile app up -d --build` finished
- [ ] `init` exited 0, `web` healthy, `/login` returns 200
- [ ] Logged in as admin and changed the password
- [ ] Backup cron job set up
