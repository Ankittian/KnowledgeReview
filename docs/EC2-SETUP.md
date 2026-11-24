# EC2 setup, step by step: from a blank instance to a running app

Every command to run, in order. Lines starting with `#` are comments. Run the commands on the EC2 instance unless a step says "on your PC".
How the stack works inside (what runs at each step) is in [DEPLOY-IMPLEMENTATION.md](DEPLOY-IMPLEMENTATION.md).

## Step 0. What you need before you start

| Item | Notes |
|---|---|
| AWS account and a key pair (`.pem`) | To launch the instance and SSH in. |
| The repository URL | `https://github.com/Ankittian/KnowledgeReview.git`. If it is private you need a GitHub personal access token (or a deploy key). |
| A Claude credential | `ANTHROPIC_API_KEY`, or a `CLAUDE_CODE_OAUTH_TOKEN` (made on your PC with `claude setup-token`). Needed for the Knowledge Assistant only. |
| The knowledge-base MCP server URL and token | `KG_MCP_URL` must be a **host name that matches its TLS certificate** (a bare IP fails with `kb_unavailable`), and `KG_MCP_TOKEN`. Needed for the Assistant only. Setting up the second MCP server (`https://spectrum-mcp.forceintellect.com/mcp-new`) is covered in [`kg-mcp-new/EC2-SETUP.md`](../../kg-mcp-new/EC2-SETUP.md). |

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
   | 8080 and 8443 (`HTTP_PORT` / `HTTPS_PORT`) | the users | Only if you add HTTPS later (step 11). |
   | 5432 | **never** | Postgres stays private. |

7. Launch, then copy the **public IPv4 address**.

The ports are not fixed: they come from `.env` (step 5). The table uses the defaults; if you change `APP_PORT`, open that port instead of 3000.

**Ports used by the deployment**

| What | `.env` setting | Default | Notes |
|---|---|---|---|
| Frontend **and** backend | `APP_PORT` | 3000 | One Next.js process serves the pages and the `/api` routes, so there is a single app port. Open it in the security group. The container listens on the same number (`PORT` is set from it). |
| Postgres (on the host) | `POSTGRES_PORT` | 5432 | Containers always reach it as `postgres:5432` on the private network. Keep `POSTGRES_BIND=127.0.0.1`; never open it in the security group. |
| nginx HTTP / HTTPS | `HTTP_PORT` / `HTTPS_PORT` | 8080 / 8443 | Only with `--profile tls`. |
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
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Set the username and a strong first-admin password. The deployment fails on an empty database if `ADMIN_PASSWORD` is blank. |
| `APP_PORT` | `3000`: frontend and backend (one app). Must match the port opened in step 1. |
| `POSTGRES_PORT` | `5432`: Postgres on the host (keep `POSTGRES_BIND=127.0.0.1`). |
| `HTTP_PORT` / `HTTPS_PORT` | `8080` / `8443`: only for the nginx HTTPS profile (80/443 are often taken). |
| `POSTGRES_BIND` | `127.0.0.1` (already in the template). |
| `COOKIE_SECURE` | `false` while you use plain `http://`. `true` only behind HTTPS. |
| `ANTHROPIC_API_KEY` **or** `CLAUDE_CODE_OAUTH_TOKEN` | The Assistant's Claude credential. |
| `KG_MCP_URL` / `KG_MCP_TOKEN` | The knowledge-base MCP server (host name, not an IP). |
| `CLASSIFIER_ENABLED`, `CLASSIFIER_MODE`, `CLASSIFIER_API_KEY` | Optional intent classifier in front of the Assistant (jev). Off by default; start with `CLASSIFIER_ENABLED=true`, `CLASSIFIER_MODE=shadow` and the TypeSafe AI key. Also `CLASSIFIER_TIMEOUT_MS`, `CLASSIFIER_MODEL`, `CLASSIFIER_BASE_URL`, `CLASSIFIER_THRESHOLDS`. See [INTENT-CLASSIFIER.md](INTENT-CLASSIFIER.md). After editing: `docker compose --profile app up -d`. |

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

**Email, OTP and password recovery** (branch `feature/forget-pass-and-login`) adds one secret (`OTP_SECRET`) to `.env`, a small database migration that `init` applies by itself, and an Email section in Admin, Settings where the SMTP connection is entered (no SMTP values go in `.env`). Follow [EC2-DEPLOY-EMAIL-AUTH.md](EC2-DEPLOY-EMAIL-AUTH.md) for that update.

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

1. Point a DNS name at the instance's public IP and open ports 8080 and 8443 (close 3000); the site is then at `https://<your domain>:8443`. Set `HTTP_PORT=80` / `HTTPS_PORT=443` in `.env` to use the standard ports.
2. Put `fullchain.pem` and `privkey.pem` in `infra/certs/`.
3. In `.env` set `COOKIE_SECURE=true` and `APP_BIND=127.0.0.1`.
4. Start with nginx:

```bash
docker compose --profile app --profile tls up -d --build
```

Open `https://<your domain>:8443/login` (or without the port if `HTTPS_PORT=443`).

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
| Build fails with `no space left on device` (`ResourceExhausted ... no space left`) | The disk is full. See step 13. |

## Step 13. When the disk is full

A full `docker compose --profile app up -d --build` needs about **7 GB free** on top of the images that are already
running: the `init` image (~2.5 GB), the new `web` image (~2 GB) and the build cache (~3 GB). Docker keeps both a packed
and an unpacked copy of each image, so a small disk (about 30 GB) with other services on it runs out halfway through
the build. A failed build leaves the running app as it was.

A full disk is also a risk for Postgres, which is on the same disk. Free space before you retry.

**1. See where the space went**

```bash
df -h /
docker system df
sudo du -xh --max-depth=1 / 2>/dev/null | sort -rh | head
```

**2. Clear caches (safe, no downtime)**

```bash
docker builder prune -af                            # build cache, rebuilt on the next build
docker image prune -f                               # dangling (untagged) images
docker compose --profile app rm -f init             # the finished one-shot init container...
docker rmi knowledgereview-init:latest              # ...and its image (2.5 GB), rebuilt when needed
npm cache clean --force                             # only if npm is installed on the host
sudo apt-get clean                                  # apt package cache (on Amazon Linux: sudo dnf clean all)
sudo journalctl --vacuum-size=50M                   # old system logs
df -h /
```

Do **not** run `docker volume prune` or `docker compose down -v` (they delete the database). Also leave alone model
caches (for example `~/.cache/huggingface`) and data folders that other services on the same machine use.

**3. Deploy only the web image**

The web image is all the app needs at run time; `init` only prepares the database. If step 2 left about 5 GB free,
the app can keep running while the new image builds:

```bash
cd ~/knowledge-review
set -a; . ./.env; set +a                            # POSTGRES_USER / POSTGRES_DB for the psql lines below

# Database changes first. Every statement is safe to run again, and the running app ignores the new columns.
docker exec -i kr-postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" < db/migrations.sql
docker exec -i kr-postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" < db/views.sql

docker compose --profile app build web
docker compose --profile app up -d --no-deps --no-build web   # swaps the container, a few seconds of downtime
docker builder prune -af && docker image prune -f             # drop the build cache and the old web image
```

**Still not enough space?** Stop the app and delete its image, so the build can use that space too. The app is down
until the build finishes (about 5 to 10 minutes); Postgres stays up.

```bash
docker stop kr-web && docker rm kr-web
docker rmi knowledgereview-web:latest
docker compose --profile app build web
docker compose --profile app up -d --no-deps --no-build web
docker builder prune -af
```

**Check**

```bash
docker compose --profile app ps                                            # kr-web healthy
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login       # 200
df -h /
```

This path skips the rest of `init`: the admin check and the flashcard sync and push. Run those only when the release
changes cards, once there is space for the `init` image again (step 9). The lasting fix is a bigger disk: in the AWS
console, raise the EBS volume size (EC2, Volumes, Modify volume), then grow the file system on the instance
(`sudo growpart /dev/nvme0n1 1`, then `sudo xfs_growfs -d /` on Amazon Linux or `sudo resize2fs /dev/nvme0n1p1` on Ubuntu;
check the device and partition names with `lsblk` first).

## Checklist

- [ ] Instance launched, security group has 22 (your IP) and 3000, not 5432
- [ ] Docker, Compose, Git installed; `docker compose version` works
- [ ] Repository cloned
- [ ] `.env` created with `POSTGRES_PASSWORD`, `JWT_SECRET`, Claude credential, `KG_MCP_URL`
- [ ] `docker compose --profile app up -d --build` finished
- [ ] `init` exited 0, `web` healthy, `/login` returns 200
- [ ] Logged in as admin and changed the password
- [ ] Backup cron job set up
- [ ] Disk has room for a build (`df -h /`: about 7 GB free; otherwise step 13)
