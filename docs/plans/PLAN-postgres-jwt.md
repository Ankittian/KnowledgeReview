# KnowledgeReview: Postgres instead of PGlite, and JWT + refresh tokens

> **Status: both parts implemented on branch `feature/spectrum-chat` (not committed yet).**
> Decisions taken: **Docker Postgres** (local and EC2), **PGlite dropped entirely** (tests and e2e use the `knowledge_review_test` / `knowledge_review_e2e` databases), **JWT access token + rotating refresh token**.
> One change from the design below: **the proxy refreshes tokens itself** (rotation inside `proxy.ts`, new access token handed to the same request) instead of redirecting through `/api/auth/refresh`. This also covers server actions and `fetch` calls, so no client-side 401 retry or refresh route is needed, and the refresh cookie uses path `/` with `SameSite=Lax`.
> Verified: migrations apply, typecheck clean, 39 unit tests pass (15 new for tokens and rotation), production build shows the proxy, and a live smoke test confirmed refresh-only cookie renews, replay inside grace gets an access token only, garbage token clears cookies and redirects to `/login`, no cookies redirects to `/login`, API without cookies returns 401. Playwright e2e was **not** run (browsers not installed here).

Two changes, done in this order: **(1) Postgres only**, then **(2) JWT access token + rotating refresh token**. Both come before the chat feature (`PLAN-spectrum-chat.md`), which needs the shared Postgres anyway.

---

## Part 1: Postgres instead of PGlite

### 1.1 Why
PGlite is single-process. The web app, the CLI scripts and the future chat workers are separate processes, so they need a real Postgres server.

### 1.2 Where Postgres will run
| Environment | Choice |
|---|---|
| Local (Windows) | Postgres 16 installed locally, or Docker: `docker run -d --name kr-pg -e POSTGRES_PASSWORD=... -p 5432:5432 postgres:16`. Database `knowledge_review` |
| EC2 / production | One of: managed (Neon, Supabase, AWS RDS) or Postgres on the same instance. **Recommended: RDS or Neon** so backups and upgrades are handled. If it is on the EC2 box, bind to localhost only and back it up daily |

Create two databases per environment: `knowledge_review` and (local only) `knowledge_review_e2e` for Playwright, plus a role with a strong password that owns them. Connection string: `postgresql://kr_app:<password>@localhost:5432/knowledge_review`, adding `?sslmode=require` for anything remote.

### 1.3 Code changes
| File | Change |
|---|---|
| `db/client.ts` | `createDb` requires `DATABASE_URL` and **throws a clear error if it is empty**. Remove the PGlite branch, the `kind: "pglite"` type, `memory` and `dir` options, and the "migrate on first use" block. Keep `prepare: false` only if you use a pooler (PgBouncer, Supabase pooler, Neon pooled). With a direct connection it can be removed |
| `scripts/seed-admin.ts`, `sync-cards.ts`, `report-needs-change.ts` | Delete the `if (h.kind === "pglite") await migrateDb(h)` lines. Migrations are now run explicitly with `npm run db:migrate` |
| `scripts/migrate.ts` | Keep. It becomes the only migration entry point |
| `drizzle.config.ts` | Remove the PGlite branch. Always use `dialect: "postgresql"` with `dbCredentials.url = DATABASE_URL` |
| `next.config.ts` | Remove `@electric-sql/pglite` from `serverExternalPackages` (keep `@node-rs/argon2`) |
| `package.json` | Remove `@electric-sql/pglite`. Add a `db:create` helper script (optional) that creates the database if missing |
| `.env.example` | `DATABASE_URL` becomes **required** with a local example. Remove the "leave empty for PGlite" text and `PGLITE_DIR` |
| `playwright.config.ts`, `scripts/e2e-setup.ts` | Point to `DATABASE_URL=postgresql://.../knowledge_review_e2e`. `e2e-setup` drops and recreates the schema instead of deleting a folder |
| `tests/db.test.ts`, `tests/deck.test.ts`, `tests/cards.test.ts` | They use in-memory PGlite today. Either keep PGlite as a **devDependency for unit tests only** (fast, no setup), or switch to a throw-away schema in `knowledge_review_e2e`. Recommended: keep PGlite for unit tests only |
| `README.md` | Rewrite "Quick start" for Postgres, remove the PGlite limits paragraph |
| `.gitignore` | Keep `.data/` ignored (harmless) |

### 1.4 Data
No users exist locally yet (no `.env` and no `.data/` folder were found), so there is **nothing to migrate**. Setup is fresh:
```
npm install
npm run db:migrate
npm run cards:sync
npm run seed:admin
```
If a live Neon/Supabase database already holds real users, no change is needed there: it already uses the Postgres path.

### 1.5 Pooling and safety
- `DB_POOL_MAX` already exists (default 5). Size it so `web connections + worker connections` stays below the server limit (Postgres default is 100).
- The chat workers will open their own connections, so use a pooler (PgBouncer, Neon pooled, RDS Proxy) if you plan more than about 5 workers.
- Use a dedicated least-privilege role for the app (no superuser).

---

## Part 2: JWT access token + refresh token

### 2.1 What exists today
Opaque random token in cookie `kr_session`, sha256 hash in the `sessions` table, 30-day expiry, **checked in the database on every request**. Disabling a user or changing a role deletes their sessions, so the effect is immediate. Helpers: `createSession`, `getSession`, `destroySession`, `revokeUserSessions`, `requireUser`, `requireRole` in `lib/auth/session.ts`, used by 14 files (pages, `admin.ts` actions, `auth.ts` actions, and the `events`, `reviews` and admin export route handlers).

### 2.2 Design
Keep the existing `sessions` table as the **login session** (its id is the `sid`) and add a table for refresh tokens.

| Token | What it is | Lifetime | Stored in |
|---|---|---|---|
| **Access token** | Signed JWT (HS256 or EdDSA) with claims `sub` (user id), `sid` (session id), `role`, `username`, `displayName`, `iat`, `exp`, `jti` | **15 minutes** | HttpOnly cookie `kr_access`, `SameSite=Lax`, `Secure` in production, path `/` |
| **Refresh token** | Opaque random 32 bytes (not a JWT) | **30 days absolute, 7 days idle** | HttpOnly cookie `kr_refresh`, `SameSite=Strict`, path `/api/auth` only. Server stores only its sha256 |

Why this shape:
- Tokens stay in HttpOnly cookies (not `localStorage`), so page JavaScript cannot steal them.
- The access JWT is verified with a signature only, so most requests need **no database call**.
- The refresh token is opaque and stored hashed, so it can be revoked and **rotated**.

**Rotation with reuse detection:** every refresh returns a new refresh token and marks the old one `used`. If a used token is presented again, assume it was stolen: delete the whole session (all its tokens). A short grace window (about 10 seconds) is allowed so two browser tabs refreshing at the same moment do not log the user out.

**Revocation honestly:** a signed JWT cannot be recalled before it expires. Disabling a user or changing a role takes effect within **15 minutes** (the access TTL), and **immediately at the next refresh** (refresh re-reads the user row and fails if status is not `active`). For sensitive actions this is tightened: `requireRole(...)` and all admin and mutating server actions do **one database check** of the user's current status and role. If you need instant logout everywhere, add a `sessions.revoked_at` check in the proxy for a small cache window.

### 2.3 New table (migration `0002_refresh_tokens.sql`; chat tables become `0003`)
```ts
refreshTokens: id text PK (sha256 of token), sessionId -> sessions.id (cascade),
               userId -> users.id (cascade), expiresAt, idleExpiresAt,
               usedAt timestamptz null, replacedById text null,
               ip text, userAgent text, createdAt
               index(sessionId), index(userId)
```
`sessions` keeps its role as the login session, so `dailyDecks.sessionId`, `interaction_events.sessionId` and the future `chat_sessions` still work unchanged. Optionally add `sessions.revokedAt`.

### 2.4 Where refresh happens (important in Next.js)
Cookies **cannot be set from a Server Component**, only from server actions, route handlers and the proxy. So `getSession()` can verify an access token, but cannot renew it. The refresh flow is:

1. **Page navigation:** the proxy (`proxy.ts`, which replaces `middleware.ts` in Next.js 16; confirm in `node_modules/next/dist/docs/` as `AGENTS.md` requires) sees an expired or missing `kr_access` with a valid `kr_refresh` cookie present and redirects to `/api/auth/refresh?next=<path>`. That route rotates the tokens, sets the new cookies, and redirects back.
2. **fetch / API calls from the browser** (`/api/reviews`, `/api/events`, the chat polling): on a 401 the client calls `POST /api/auth/refresh` once, then retries the original request. The existing offline `lib/client/outbox.ts` retry logic should use the same helper.
3. If refresh fails (expired, reused, user disabled): clear both cookies and send the user to `/login?next=...`.

Because the refresh cookie is scoped to `/api/auth`, it is sent only to the refresh and logout routes, not on every request.

### 2.5 Code changes
| File | Change |
|---|---|
| `package.json` | Add `jose` (JWT sign and verify, works in the proxy and Node) |
| `lib/auth/tokens.ts` (new) | `signAccessToken(user, sid)`, `verifyAccessToken(jwt)`, `newRefreshToken()`, constants for TTLs (read from env) |
| `lib/auth/session.ts` | Rewrite internals, **keep the same exports and return shapes**. `createSession` creates the `sessions` row and the first refresh token, then sets both cookies. `getSession` verifies the JWT and builds `{ sessionId, user }` from claims (no DB hit). `destroySession` deletes the session (cascade removes refresh tokens) and clears both cookies. `revokeUserSessions` is unchanged. `requireUser` is unchanged. `requireRole` additionally loads the live user row and checks role and `active` status |
| `lib/auth/refresh.ts` (new) | `rotateRefreshToken(token)`: look up by hash, check expiry and idle, check user still `active`, detect reuse (revoke session), grace window, issue new pair |
| `app/api/auth/refresh/route.ts` (new) | `GET` (navigation redirect flow) and `POST` (fetch flow). Same-origin check (`isSameOrigin`), rate limited, returns 401 and clears cookies on failure |
| `app/api/auth/logout/route.ts` (new, optional) | Logout for non-form callers. The existing `logoutAction` keeps working |
| `proxy.ts` (new) | Matcher for app pages (not static files, not `/login`, `/signup`). If the access token is valid, continue. If expired and a refresh cookie exists, redirect to the refresh route. Otherwise redirect to `/login?next=` |
| `app/actions/auth.ts` | `loginAction`/`logoutAction` need no logic change, since they call `createSession`/`destroySession`. Add login events for refresh (`token_refreshed`, `token_reuse_detected`) through `logEvent` |
| `app/actions/admin.ts` | No change. Disabling a user and role changes already call `revokeUserSessions`. Optionally also write an `audit_log` row |
| `app/api/events/route.ts`, `reviews/route.ts`, `admin/export/[name]/route.ts` | No change to logic (they use `getSession()`). The client must handle 401 by refreshing |
| `lib/client/outbox.ts` and the deck client | On a 401, call refresh once, then retry |
| `db/schema.ts` + migration | Add `refreshTokens` (and optional `sessions.revokedAt`) |
| `.env.example` | New variables, below |
| `tests/` and `e2e/` | New tests, below |

### 2.6 New environment variables
```
JWT_SECRET=                 # 32+ random bytes (base64). Required. Rotate by supporting JWT_SECRET_PREVIOUS
JWT_SECRET_PREVIOUS=        # optional, accepted for verification only during rotation
ACCESS_TOKEN_MINUTES=15
REFRESH_TOKEN_DAYS=30       # absolute lifetime
REFRESH_IDLE_DAYS=7
REFRESH_GRACE_SECONDS=10
COOKIE_SECURE=true          # production over HTTPS
```
Generate the secret with `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`. Never commit it. On EC2 keep it in SSM Parameter Store or Secrets Manager. If the secret leaks, change it: everyone is logged out within 15 minutes and must log in again.

### 2.7 Migration of existing logins
Existing `kr_session` cookies stop working at deploy time. Everyone logs in once more (no data loss). This is acceptable for a small team. The old cookie is simply ignored, and `sessions` rows created before the deploy have no refresh token, so they expire naturally or can be cleared with `DELETE FROM sessions`.

### 2.8 How this fits the chat feature
- The chat page is in the same app and uses `requireUser()`, so it gets the same login for free, and the proxy refreshes tokens for it like any other page.
- The chat polling `fetch` uses the same 401 then refresh then retry helper.
- The **chat worker does not use JWT**. It trusts the user id stored on the job row, which the server action wrote after verifying the user's token.
- `chat_sessions.authSessionId` links to `sessions.id` (the `sid`), which stays stable across token refreshes, so a chat session survives refreshes and ends on logout.

---

## Phases

1. **Postgres:** create the databases, make `DATABASE_URL` required, update `db/client.ts`, scripts, drizzle config, e2e config, README. Run migrate, sync, seed. Run `npm test` and `npm run e2e`. Commit.
2. **Tokens library:** `jose`, `lib/auth/tokens.ts`, `refreshTokens` table and migration, unit tests (sign, verify, expiry, tampering).
3. **Session rewrite:** `session.ts` internals, `refresh.ts` rotation and reuse detection, refresh route, logout cookies.
4. **Proxy and client:** `proxy.ts`, the 401 then refresh then retry helper, the `outbox.ts` update.
5. **Hardening and tests:** rate limits on refresh, events and audit rows, `requireRole` live check, e2e flows below.
6. **Then** start the chat feature on top.

## Test checklist
- [ ] Login sets `kr_access` and `kr_refresh` (both HttpOnly, correct paths). `document.cookie` shows neither
- [ ] Expired access token plus valid refresh renews silently on a page load and on a fetch
- [ ] Tampered or wrong-secret JWT is rejected
- [ ] Reusing an already-rotated refresh token logs the whole session out (outside the grace window)
- [ ] Two tabs refreshing at once do not log the user out (grace window)
- [ ] Disabled user: refresh fails, and admin pages are blocked immediately by the live check
- [ ] Role change takes effect at the next refresh and on admin actions immediately
- [ ] Logout clears both cookies and deletes the session and its refresh tokens
- [ ] Idle for over 7 days or older than 30 days forces a new login
- [ ] `next=` redirect after login still works and rejects `//evil.com`
- [ ] Existing tests and e2e flow pass on Postgres

## Risks and decisions
- **JWT is less revocable than the current design.** The current setup is arguably safer for a small internal app, since every request is checked in the database. This change is worth it mainly if you want stateless verification, scale, or other services to verify logins. If instant revocation matters most, a middle path is a JWT with a 2 to 5 minute lifetime.
- **Refresh in a Next.js app needs the proxy flow above.** Doing it any other way fails because cookies cannot be set from server components.
- **Secrets:** `JWT_SECRET` and the database password must stay out of Git.

## Open questions
1. Local Postgres via installer or Docker? And on EC2, RDS, Neon, or on the box?
2. Token lifetimes: is 15 minutes (access), 7 days idle and 30 days absolute (refresh) right?
3. HS256 (one shared secret, simplest) or EdDSA/RS256 (needed only if another service must verify tokens without the secret)? Default: HS256.
4. Keep PGlite as a dev dependency for unit tests only, or drop it entirely?
5. Is instant revocation (disable a user and they are out now) a hard requirement? If yes, I will add a database check in the proxy.
