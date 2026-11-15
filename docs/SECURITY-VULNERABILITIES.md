# Knowledge Review – Smoke Test & Vulnerability Report

Date: 2026-11-14 · Branch: `main` (commit `fd24f38`) · Next.js 16.4.5

## 1. Scope and method

| Check | Result |
|---|---|
| `tsc --noEmit` | Pass, no errors |
| `next build` (production) | Pass, all 30 routes compile |
| `vitest run` | 23 passed, **3 failed**, 41 skipped. See finding L-6 |
| `npm audit --omit=dev` | 6 issues (2 low, 4 moderate), all through `shadcn` |
| Production server smoke test (`next start`) | Done for the unauthenticated surface (section 2) |
| Source review | Auth, tokens, server actions, all 9 API routes, chat harness, Docker/nginx/env config |

**Not done: authenticated end-to-end testing** (login, flashcards, chat, admin). Two things blocked it:

- No Docker or local Postgres was available.
- `.env` points `DATABASE_URL` at a shared LAN host (`192.168.0.20:5439`). I did not run anything against it, because finding C-1 would overwrite every user's role.

To finish the authenticated pass, set `TEST_DATABASE_URL` and `E2E_DATABASE_URL` and run `npm test` and `npm run e2e`. That covers the 41 skipped unit tests and the browser flows.

## 2. Smoke test results (unauthenticated, live server)

| Test | Expected | Actual | |
|---|---|---|---|
| `/chat`, `/admin`, `/admin/users`, `/today` without cookie | redirect to login | 307 → `/login` | OK |
| `GET /api/admin/export/reviews` without cookie | 401 | 401 | OK |
| `POST /api/reviews`, `/api/chat/send` with no Origin | 403 | 403 "Bad origin" | OK |
| `POST /api/reviews` with `Origin: evil.com` | 403 | 403 | OK |
| JWT with `alg:none` and role admin | rejected | 401 | OK |
| Security headers | present | X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy present | **No CSP, no HSTS** (M-5) |
| `X-Powered-By`, source maps | absent | absent | OK |
| JWT signed with the right key but no real session, sent to export route | rejected | **Passed auth** (failed later at the unreachable DB, HTTP 500) | See H-2 |
| `/login?next=/%5Cevil.com` | next ignored or sanitised | Rendered as `value="/\evil.com"` in the form | See H-1 |

## 3. Findings

Severity: **Critical** (fix before any further use), **High** (fix before release), **Medium** (fix soon), **Low** (hardening).

### CRITICAL

#### C-1. Changing one user's role changes every user's role
- **Where:** `app/actions/admin.ts:44` (`setUserRole`)
- **Cause:** The `.where(...)` call is inside a `//` comment, so the statement is a bare `UPDATE users SET role_id = …, answer_role = NULL` with no `WHERE`:
  ```ts
  await db.update(users).set({ roleId: roleIdOf(role), answerRole: null }) // answer style follows the new role again.where(eq(users.id, id));
  ```
- **Impact:**
  - One admin click re-roles all users, including admins and the actor. Setting "technical" demotes every admin and locks everyone out of `/admin`.
  - Setting "admin" makes every pending and active user an admin.
  - It is also a privilege escalation if an admin makes a mistake.
  - The audit log records only one target user, so the damage is hidden.
  - `revokeUserSessions(id)` then logs out only the one user.
- **Fix:** Move the comment to its own line, restore `.where(eq(users.id, id))`, and add a unit test that checks other users are unchanged. Run `SELECT username, role FROM users` on the shared DB if this action has ever been used, and repair any roles it changed.
- **Status:** Confirmed by reading the source. Not run against a database, for the reason in section 1.

### HIGH

#### H-1. Open redirect after login
- **Where:** `app/actions/auth.ts`, end of `loginAction`
- **Cause:** The check `next.startsWith("/") && !next.startsWith("//")` accepts `/\evil.com`. Browsers treat `\` as `/`, so the redirect goes to `//evil.com`. The smoke test confirmed the login page copies `?next=` into the hidden field unchanged.
- **Impact:** A phishing link on the real login page sends the user to an attacker site straight after authentication.
- **Fix:** Accept only `^/(?![/\\])` and reject any value containing `\`, control characters or `:`. Better, resolve `new URL(next, origin)` and require the same origin.

#### H-2. Admin export trusts the JWT alone (no live role or session check)
- **Where:** `app/api/admin/export/[name]/route.ts`
- **Cause:** It uses `getSession()` and `session.user.role` from the JWT. The chat routes call `chatCaller` and admin pages call `requireRole`, both of which re-check the database. This route does not.
- **Impact:**
  - A demoted, disabled or session-revoked admin can still download all reviews, feedback, the knowledge base and the full event log (user activity, chat prompts, IPs) for up to `ACCESS_TOKEN_MINUTES` (15 minutes).
  - The smoke test showed a validly signed token with a non-existent session reaches the database query.
  - The JWT secret then becomes a single point of failure for all exported data.
- **Fix:** Reuse the live-check logic from `requireRole` or `chatCaller`, returning 401 or 403 instead of redirecting.

#### H-3. Assistant web access can reach internal networks (SSRF) and is open to prompt injection
- **Where:** `lib/chat/policy.ts`, `lib/chat/config.ts` (`CHAT_ALLOW_WEB=true` by default)
- **Cause:** `WebFetch` and `WebSearch` run in the server's Claude process. Any logged-in user can ask the assistant to fetch a URL, for example `http://169.254.169.254/latest/meta-data/…` (EC2 metadata) or other private hosts. The process environment also passes `AWS_*` credentials through (`PASS_THROUGH` in `runner.ts`).
- **Impact:**
  - Possible leak of cloud metadata and credentials, and probing of the private network.
  - Fetched web pages are untrusted input that can steer the model.
  - Replies are shown as links the user may click.
- **Fix:**
  - Default `CHAT_ALLOW_WEB=false`, or run the harness with no cloud role and block `169.254.169.254` and RFC1918 ranges at the network level (IMDSv2 with hop limit 1, egress firewall).
  - Remove `AWS_*` from `PASS_THROUGH` unless Bedrock is actually used.
  - Restrict `WebFetch` to an allow-list of domains in `canUseTool`.

#### H-4. Default admin password is published and the DB port is open by default
- **Where:** `.env.production.example` (`ADMIN_PASSWORD=admin@123`), `docker-compose.yml`
- **Impact:**
  - Anyone who copies the example verbatim gets a well-known admin login (`admin` / `admin@123`) on an internet-facing host. `seed-admin --if-missing` never rotates it.
  - Postgres defaults to `POSTGRES_BIND=0.0.0.0`, and the web app defaults to `APP_BIND=0.0.0.0`, which exposes the app directly without nginx and TLS. The comment says to override, but the safe value is not the default.
- **Fix:**
  - Leave `ADMIN_PASSWORD` empty so the seed script fails unless a password is set. Force a password change on first login.
  - Default `POSTGRES_BIND` to `127.0.0.1`, and make `COOKIE_SECURE=true` the production default.

### MEDIUM

#### M-1. Login lockout is a denial of service, and the IP limit can be spoofed
- **Where:** `app/actions/auth.ts`, `lib/request.ts`, `proxy.ts`
- **Cause:** 8 failures per username in 15 minutes blocks that account. Anyone can lock out `admin` by guessing wrong passwords, since usernames are known or guessable. The per-IP limit reads the first `X-Forwarded-For` value, which a client can set freely when the app is reached directly (default `APP_BIND=0.0.0.0`). That also bypasses the signup limit of 10 per hour.
- **Fix:**
  - Throttle on username and IP together, with progressive delays.
  - Trust `X-Forwarded-For` only from the known proxy (use the last hop appended by nginx).
  - Add CAPTCHA or a delay on signup.

#### M-2. Spreadsheet formula injection in CSV exports
- **Where:** `lib/reports.ts` (`toCsv`)
- **Cause:** Cells starting with `=`, `+`, `-` or `@` are not neutralised. User-controlled text (display names, feedback comments, suggested text, chat prompts) flows into the exports.
- **Impact:** An admin opening an export in Excel can run attacker formulas (data exfiltration, DDE).
- **Fix:** Prefix such cells with `'`, and tab-prefix them in the CSV.

#### M-3. Unbounded client-supplied data in the event log
- **Where:** `lib/validation.ts` (`eventsSchema`), `app/api/events/route.ts`
- **Cause:** `payload` is `z.record(z.string(), z.unknown())` with no size or depth limit, 100 events per request, and no per-user rate limit. `clientEventId` has a global unique index, so a user can pre-claim another user's IDs and their events are silently dropped.
- **Impact:** Table bloat and disk exhaustion by any logged-in user, and corruption of the admin event reports.
- **Fix:** Cap payload size (for example 2 KB), add a per-user rate limit, and scope idempotency to `(user_id, client_event_id)`.

#### M-4. Pending signups can reach the database and CPU resources without approval
- **Where:** `signupAction`
- **Cause:** Each signup runs an argon2 hash (about 19 MiB memory), and the only limit is the per-IP counter that M-1 shows is spoofable.
- **Impact:** CPU and memory exhaustion, and a growing queue of fake pending users in the admin list.
- **Fix:** Fix the IP trust problem (M-1), add CAPTCHA, and cap the number of pending users.

#### M-5. Missing Content-Security-Policy and HSTS at the app level
- **Where:** `next.config.ts`
- **Cause:** There is no CSP, so any future XSS runs unrestricted. HSTS exists only in the optional nginx profile, and `COOKIE_SECURE` defaults to `false`.
- **Fix:** Add a CSP (nonce-based, `default-src 'self'`, `frame-ancestors 'none'`) and HSTS when `COOKIE_SECURE=true`.

#### M-6. Role changes and approvals do not end existing sessions consistently
- **Where:** `approveUser`, `setUserRole`, `lib/auth/session.ts`
- **Cause:**
  - `approveUser` can set any user, including a disabled one, back to active, and never revokes sessions.
  - `requireUser` and `getSession` trust the JWT for up to 15 minutes, so a demoted user keeps their old role claim on every non-admin page. The `role` claim is used by `/api/reviews` and `/api/events` only through the card checks.
- **Fix:** Re-check status and role from the database in `getSession` (or shorten the token life), and make `approveUser` act only on `status = 'pending'`.

### LOW / hardening

- **L-1. Dependency advisories.** `npm audit` reports `deepmerge` (prototype poisoning), `minimatch` (ReDoS), `ts-morph`, `@shadcn/registry`. All come from `shadcn`, which is listed under `dependencies` but is only a build-time CLI. Move it to `devDependencies` so it is not shipped in the production image.
- **L-2. Secrets in the working tree.** `.env` is git-ignored and was never committed, but it contains a plaintext DB password and `JWT_SECRET` and a LAN IP. Rotate them if the folder has been shared, and keep production secrets in SSM/Secrets Manager as the README says.
- **L-3. `proxy.ts` matcher regex.** `".*\.(?:png|…)$"` inside a normal string loses the backslash (it becomes `.`). Static-file exclusion is therefore looser than intended. Use `String.raw` or `\\.`.
- **L-4. `components/ui/chart.tsx` uses `dangerouslySetInnerHTML`** for chart CSS built from the chart config. It is safe today (config is code, not user input). Never feed user data into it.
- **L-5. No request-body size limit on JSON routes.** nginx caps at 1 MB but the direct port does not. Add an explicit `content-length` check in `readJson`.
- **L-6. Failing unit tests.** `tests/cards.test.ts` fails 3 tests: expected 163, 840 and no warnings, got 570, 4927 and 9 warnings (`unknown reference 'fQCGroupMaster'`, `'fOtherVoucher'`, `'fMaintenanceWorkOrder'`). The knowledge-base snapshot and tests have drifted apart, so CI cannot be trusted until they are updated. Three test files also need `TEST_DATABASE_URL` and are skipped otherwise.
- **L-7. Security-relevant audit gaps.** `audit()` in `setUserRole` records the new role but not the previous one, and no export records filters. Add before/after values.

## 4. What is already done well

- Passwords: argon2id with OWASP parameters, a dummy hash against username timing, and generic login errors.
- Tokens: HS256 with an algorithm allow-list, 15-minute access tokens, rotating refresh tokens stored as SHA-256 hashes, reuse detection that kills the session, and idle plus absolute expiry.
- Cookies: HttpOnly and SameSite=Lax.
- CSRF: origin checks on all mutating JSON routes. Next.js covers server actions.
- Authorisation: every chat query is scoped by `userId` (no IDOR found in conversations or messages), and the admin pages and actions call `requireRole`, which re-checks the database.
- Rendering: Markdown uses `skipHtml`, remote images are blocked, and links use `noopener noreferrer nofollow`.
- Chat harness: three-layer tool deny-list, a stripped environment for the Claude process (no `DATABASE_URL`, `JWT_SECRET` or KB token), and a daily question limit with a concurrency queue.
- SQL: Drizzle parameterisation throughout, with no string-built SQL found in request paths.

## 5. Recommended fix order

1. **C-1** (one-line fix, plus a test). Check existing user roles on the shared DB.
2. **H-1, H-2** (small code changes).
3. **H-4, H-3** (config and deployment defaults), before any internet-facing deploy.
4. **M-1 to M-6**, then the Low items.
5. Run the authenticated suites (`npm test`, `npm run e2e`) against a throw-away database and re-test.
