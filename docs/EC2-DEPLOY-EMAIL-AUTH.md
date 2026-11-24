# EC2: deploying email, OTP and password recovery

Applies to the server that is currently running commit **`86e6027ab16b487b8dab2d7c8edf68b3980d6551`**
("feat: add knowledge graph to admin nav with full-width layout"). This branch (`feature/forget-pass-and-login`) has
`main` merged into it, so one rebuild brings the server from 86e6027 to everything on `main` **plus** the email and
OTP work. Besides the email changes below, that includes what `main` added since 86e6027: the SpectrumERP-new knowledge
base (chat can pick it, per-user access switch), the intent classifier, and the `chat_messages.blocked_category` column.

What changes on the server:

| Area | Change | Needs |
|---|---|---|
| Code | New pages `/profile`, `/forgot-password`; `/account` redirects to `/profile` | image rebuild |
| Dependency | `nodemailer` added to `package.json` / `package-lock.json` | image rebuild (`npm ci` runs again) |
| Database | `users.email`, `users.email_verified_at`, unique index on `lower(email)`, new tables `email_otps` and `mail_connections` (saved SMTP connections), plus a missing unique index on `chat_feedback` | applied automatically by the `init` container (`db/migrations.sql`); additive only |
| `.env` | New `OTP_SECRET` (one random string). **No SMTP settings go in `.env`** at all: an admin enters the connection in Settings, Email | edit by hand, never committed |
| `.env` (from `main`, all optional) | `KG_NEW_MCP_URL`, `KG_NEW_MCP_TOKEN_TECHNICAL`, `KG_NEW_MCP_TOKEN_FUNCTIONAL`, `CHAT_NEW_TIMEOUT_SECONDS`, `CHAT_NEW_MAX_TURNS`, and the commented `CLASSIFIER_*` block. Leave them **empty**: an empty `KG_NEW_MCP_URL` hides SpectrumERP-new, empty limits fall back to `CHAT_TIMEOUT_SECONDS` / `CHAT_MAX_TURNS`, and the classifier stays off unless `CLASSIFIER_ENABLED=true`. See `.env.production.example` | copy only the keys you need |
| Database (from `main`) | `conversations.kb_source` (+ enum), `users.can_use_kg_new`, `chat_messages.blocked_category` | applied automatically by `init`, same as the email tables |
| Network | Outbound TCP 587 to the mail provider | EC2 security groups allow all outbound by default; check if you restricted it |

The Dockerfile and `docker-compose.yml` themselves are unchanged. "Rebuilding the Docker files" here means rebuilding the
images (`--build`), because the source code and `node_modules` inside them changed.

## Before you start (on your PC)

1. Gmail account for testing: turn on **2-step verification**, then create an **app password** (Google Account, Security, App passwords). Keep the 16 characters; spaces do not matter. You will type it into the admin page in Step 7, not into `.env`.
2. Decide the test recipient (any inbox you can read, including the Gmail account itself).
3. Merge or push the branch so the server can pull it:
   ```bash
   git push -u origin feature/forget-pass-and-login
   ```

## Step 1. Check the server is where you think it is

```bash
ssh ubuntu@<EC2_PUBLIC_IP>
cd ~/knowledge-review
git status            # should be clean
git rev-parse HEAD    # 86e6027ab16b487b8dab2d7c8edf68b3980d6551 (or the docs-only commit after it)
docker compose --profile app ps
```

If `git status` shows local changes, stop and sort them out first (`git stash` or commit) so the pull cannot clash.

## Step 2. Back up the database

The schema change is additive, but take a dump anyway:

```bash
docker exec kr-postgres pg_dump -U kr_app knowledge_review_final > ~/kr-before-email-$(date +%F).sql
ls -lh ~/kr-before-email-*.sql
```

(Use your own container name and database name if you changed them in `.env`.)

## Step 3. Add one secret to `.env`

Email is **not** configured in `.env`. The SMTP host, port, login and sender are entered later in the Email section of
Admin > Settings and saved in the database, with the password encrypted. The only thing `.env` needs is one
random secret:

```bash
cd ~/knowledge-review
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # copy the output
nano .env
```

```
OTP_SECRET=<the random string>
```

- `OTP_SECRET` hashes the one-time codes **and** is the key that encrypts the saved SMTP password. Set it once and do not change it: if it changes, codes in flight stop working and the saved SMTP password must be entered again on the admin page.
- If `OTP_SECRET` is left empty the app falls back to `JWT_SECRET`, but a separate value is cleaner.
- `.env` is git-ignored; do not commit it. Lock it down if it is not already: `chmod 600 .env`.

## Step 4. Get the new code

```bash
git fetch origin
git checkout feature/forget-pass-and-login     # or: git checkout main && git pull   once the branch is merged
git log -1 --oneline
```

## Step 5. Rebuild the images and restart

```bash
docker compose --profile app up -d --build
```

What this does: rebuilds the `init` and `web` images (a few minutes: `npm ci` now installs `nodemailer`), runs `init`
(applies the migration, keeps the admin and cards), then starts the new `web`. If you use nginx/TLS add `--profile tls`
exactly as you did when you first deployed.

Watch it:

```bash
docker compose --profile app logs -f init     # ends with "Tables already exist (left untouched). Views refreshed." and exits 0
docker compose --profile app ps               # web: healthy
```

## Step 6. Verify the database change

```bash
docker exec -i kr-postgres psql -U kr_app knowledge_review_final -c "\d users" | grep -E "email|users_email_unique"
docker exec -i kr-postgres psql -U kr_app knowledge_review_final -c "\d email_otps" | head -15
docker exec -i kr-postgres psql -U kr_app knowledge_review_final -c "\d mail_connections" | head -20
```

You should see `email`, `email_verified_at`, the `users_email_unique` index and the `email_otps` and `mail_connections` tables.

## Step 7. Add the Gmail connection on the admin page and test it

1. Open `http://<EC2_PUBLIC_IP>:3000/login`, sign in as the admin, open **Admin, Settings** and scroll to **Email**.
2. Press the **Gmail** preset (host `smtp.gmail.com`, port 587, STARTTLS), then fill in:
   Name `Gmail (testing)`, Username = the Gmail address, Password = the **16-character app password**,
   Sender email = the same Gmail address. Tick **Use this connection for sending now** and **Save connection**.
3. In **Send a test email**, enter your own address and press **Send test email**. A green confirmation appears and the message
   arrives (check spam the first time). If it fails, the page explains why:

| Message | Meaning / fix |
|---|---|
| The mail server rejected the username or password | Wrong app password, or 2-step verification is off. Create a new app password and edit the connection. |
| Could not connect to the server | Outbound 587 blocked (security group / firewall) or wrong host or port. |
| Microsoft is refusing password sign-in for this mailbox | Microsoft 365: the admin must enable Authenticated SMTP for the mailbox and stop Security Defaults / Conditional Access blocking basic auth. A personal Outlook.com / Hotmail account cannot be used. |
| Authenticated SMTP is switched off for this mailbox | Microsoft 365: ask the admin to enable it for the sending mailbox (or the organisation). |
| The secure connection failed | Security does not match the port: 587 = STARTTLS, 465 = SSL/TLS. |
| The server refused the sender or recipient address | The sender email must be the mailbox you log in with. |

The same check works from the command line, using whatever is active on the admin page:

```bash
docker compose --profile app run --rm init npx tsx scripts/mail-test.ts your.test.account@gmail.com
```

## Step 8. Test in the browser

1. Open `http://<EC2_PUBLIC_IP>:3000/login`, sign in, open **Profile** (key icon in the top bar).
2. Add your email, enter the code from the email, see it saved.
3. Sign out, sign in with the **email** and password.
4. Profile, Password, **Use email code**: change the password with a code.
5. Sign out, **Forgot password?**: reset with a code.
6. Admin, Users: each user shows their email; **Reset password** gives a temporary password for people with no email.

Troubleshooting from the server:

```bash
docker compose --profile app logs --tail=100 web | grep -i "mail"
```

## Step 9. Move to Outlook / Microsoft 365 (the real test)

Ask the Microsoft 365 admin for a dedicated mailbox (for example `no-reply@forceintellect.com`) and to enable
**Authenticated SMTP (SMTP AUTH)** for it (Exchange admin center, Mailboxes, Manage email apps). Basic-auth SMTP has been
getting phased out by Microsoft, so confirm it is still allowed for your tenant before relying on it. If the account has MFA
the admin may need to allow an app password or exempt the mailbox.

No `.env` edit, rebuild or restart is needed. On **Admin, Settings, Email**:

1. Press the **Outlook / Microsoft 365** preset (host `smtp.office365.com`, port 587, STARTTLS), enter the mailbox address and
   password, name it `Outlook (real)` and **Save connection** (leave "Use this connection now" unticked).
2. In **Send a test email**, choose `Outlook (real)` and send to yourself. The Gmail connection is still the active one, so
   nothing changes for users while you test.
3. When the test mail arrives, press **Use** on the Outlook row. It becomes active at once and Gmail stays saved.

Switching back is the same: press **Use** on the other row. If Microsoft refuses basic authentication, add an AWS SES connection
(host `email-smtp.<region>.amazonaws.com`, SMTP credentials from SES) in the same way.

## Rollback

```bash
cd ~/knowledge-review
git checkout 86e6027ab16b487b8dab2d7c8edf68b3980d6551
docker compose --profile app up -d --build
```

The old code ignores the new columns and table, so the database does not need to be rolled back. Restore the dump from
Step 2 only if something else went wrong:
`docker exec -i kr-postgres psql -U kr_app knowledge_review_final < ~/kr-before-email-<date>.sql` (stop `web` first).

## Notes

- **Admin account.** The first admin (`admin`) has no email until you add one on `/profile`. Add one first, so you are not locked out if you forget its password.
- **Session lifetime.** After a password reset the user's other devices are signed out when their 15-minute access token expires (`ACCESS_TOKEN_MINUTES`), same as disabling a user. The refresh tokens are revoked immediately.
- **Per-IP limits.** The per-IP limits on codes (20 sends per hour, 30 failures per 15 minutes) only apply when `TRUSTED_PROXY=true` (behind the nginx `tls` profile); the per-account limits (60 s between codes, 5 per hour, 5 guesses per code) always apply.
- **Who can see the SMTP password.** Nobody: it is stored encrypted, never shown again on the page (editing shows a dots placeholder and a blank field keeps it), and never written to the activity log. Only admins can open the page. Anyone who also gets both the database and `OTP_SECRET` could decrypt it, so keep `.env` private.
- **Never set `MAIL_CAPTURE_FILE`** on a server: it is a test-only switch that writes codes to a file instead of sending them.
- **Gmail limits.** About 500 messages a day for a free account: fine for testing, not for production.
