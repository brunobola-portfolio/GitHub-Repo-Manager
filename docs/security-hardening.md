# Security Hardening — SOC 2 Code-Side Prep (Phase G)

> **Scope**: G1 + G2 + G3 + G4 from `docs/specs/2026-04-19-byok-and-remaining-phase-0.md §2.3`.
> All four items are implemented. G2 (email-based retention warnings) uses `server/lib/email.js` with a `console` adapter in dev and a Resend adapter in production.
> Real SOC 2 certification is a 12-month business process; these items make the codebase audit-ready.

---

## G1 — Append-only audit log (SOC 2 CC7.2)

### What "append-only" means here

Every write to `audit_log_v2` is permanent. Two SQLite `BEFORE` triggers unconditionally abort any `UPDATE` or `DELETE` statement against the table:

```sql
-- Blocks all external updates
CREATE TRIGGER IF NOT EXISTS audit_log_v2_no_update
BEFORE UPDATE ON audit_log_v2
BEGIN
    SELECT RAISE(ABORT, 'audit_log_v2 is append-only; updates are not permitted');
END;

-- Blocks all deletions
CREATE TRIGGER IF NOT EXISTS audit_log_v2_no_delete
BEFORE DELETE ON audit_log_v2
BEGIN
    SELECT RAISE(ABORT, 'audit_log_v2 is append-only; deletions are not permitted');
END;
```

The triggers are created by `initDB()` in `server/db.js` (Migration 005) using `IF NOT EXISTS` so they are idempotent across restarts and re-deploys.

### Hash chain

Two columns were added to `audit_log_v2`:

| Column | Type | Purpose |
|---|---|---|
| `prev_hash` | `TEXT NOT NULL DEFAULT ''` | SHA-256 of the preceding row (empty string for the first row) |
| `row_hash` | `TEXT NOT NULL DEFAULT ''` | SHA-256 of this row's own content |

The hash input is a pipe-delimited concatenation of:

```
id | action | resource_type | resource_id | user_id | created_at | details | prev_hash
```

Because each row records the hash of the row before it, a gap (deletion, reordering, or insertion between rows) makes every subsequent hash mismatch.

### `auditLog()` helper — single-phase write

`server/lib/audit.js` — `auditLog(req, action, resourceType, resourceId, details)`:

1. Reads the last row's `row_hash` → becomes `prev_hash` for the new row.
2. Predicts the next SQLite ROWID from `sqlite_sequence`.
3. Pre-computes `row_hash` using the anticipated id and the current UTC timestamp.
4. Issues a **single `INSERT`** — no subsequent `UPDATE` is needed, so the `audit_log_v2_no_update` trigger is never tripped.

The helper's external signature is unchanged; all call sites continue to work without modification.

### `verifyAuditChain({ from?, to? })`

```js
import { verifyAuditChain } from './server/lib/audit.js';

const report = verifyAuditChain();
// { valid: true, totalChecked: 1842 }

const partial = verifyAuditChain({ from: 500, to: 999 });
// { valid: false, brokenAt: 712, totalChecked: 212 }
```

The function walks rows in ascending `id` order and:

1. Re-computes each row's `row_hash` from stored fields.
2. Checks the stored `row_hash` matches the re-computation.
3. Checks each row's `prev_hash` matches the previous row's `row_hash`.

Return object:

| Field | Type | Meaning |
|---|---|---|
| `valid` | `boolean` | `true` if no discrepancies were found |
| `brokenAt` | `number?` | `id` of the first row that failed — present only when `valid: false` |
| `totalChecked` | `number` | Number of rows examined (0 for an empty table) |

**When to run it**: on-demand forensic checks, security audits, or as a scheduled health check in a cron job.

---

## G3 — Self-service data erasure (GDPR Article 17 / SOC 2 CC6.5)

### Endpoint

```
DELETE /api/v1/user/data
Authorization: session cookie (requireAuth)
Content-Type: application/json

{ "confirmString": "ERASE MY DATA" }
```

### What gets deleted

| Table | Match condition |
|---|---|
| `user_ai_config` | `user_id = <me>` |
| `migration_jobs` | `user_id = <me>` |
| `migration_plans` + `migration_tasks` (cascade) | `user_id = <me>` |
| `pr_events` | `author_login = <my github username>` |
| `issue_events` | `author_login = <my github username>` |
| `review_assignments` | `reviewer_login = <my github username>` |
| `community_health_cache` | `user_id = <me>` |
| `repo_metadata` | `user_id = <me>` |
| `repo_embeddings` | `user_id = <me>` |
| `workflow_runs` | `user_id = <me>` |
| `workflows_meta` | `user_id = <me>` |
| `usage_metrics` | `user_id = <me>` |
| `api_keys` | `user_id = <me>` |
| `user_subscriptions` | `user_id = <me>` |
| `team_members` | `user_id = <me>` |

### What is NOT deleted

| Item | Reason |
|---|---|
| `audit_log_v2` rows | Append-only — cannot be deleted. A `user.erased` tombstone event is inserted instead. |
| `users` row | Preserved for referential integrity. PII is nulled: `email = NULL`, `username = 'deleted-user'`, `avatar_url = NULL`, `deleted_at = <timestamp>`. |

### Blocked conditions

| Condition | HTTP response |
|---|---|
| `confirmString` does not exactly match `'ERASE MY DATA'` | `400 Bad Request` |
| User has an active subscription (`user_subscriptions.status = 'active'`) | `400 Bad Request` — "cancel active subscription first" |
| User's row already has `deleted_at` set (tombstoned) | `404 Not Found` |

### Calling the endpoint as a user

```bash
curl -X DELETE https://your-instance/api/v1/user/data \
  -H "Cookie: session=<your-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"confirmString": "ERASE MY DATA"}'
```

A `200` response includes a summary of what was deleted, keyed by table name.
Erasure is registry-driven: every user-scoped table in the schema is classified
as erase / cascade / tombstone / survive in `server/routes/user-data.js`
(`ERASURE_REGISTRY`), and a completeness test fails the build if a new
user-keyed table is ever added without being classified. Excerpt:

```json
{
  "deleted": {
    "user_ai_config": 1,
    "user_azure_credentials": 1,
    "ai_pr_chat_messages": 12,
    "migration_jobs": 3,
    "migration_plans": 1,
    "gh_outbox": 4,
    "gh_cache": 9,
    "work_board_prefs": 1,
    "api_keys": 1,
    "user_subscriptions": 1,
    "team_members": 2
  },
  "tombstoned": ["user", "audit_log_v2"]
}
```

The session is destroyed immediately after the wipe. Any subsequent request with the same cookie will be rejected as unauthenticated.

### Idempotency

A repeat call from the same session (or a new session for the same `user_id`) returns `404` because `deleted_at` is already set. The caller should treat `404` as a successful no-op (erasure already completed).

---

## G4 — Startup secrets verification (SOC 2 CC6.1)

> **v3.6.0 update**: `CREDENTIAL_ENCRYPTION_KEY` is now **required** in production. See [G9](#g9--encryption-key-mandatory-in-production-soc-2-cc61) for the rationale and enforcement details.

### What it enforces

`server/lib/startup-secrets-check.js` — `verifySecretsAtStartup({ nodeEnv })` is called in `server/index.js` **before** `initDB()` and before the Express app binds to a port.

#### Production (`NODE_ENV=production`)

| Check | Failure mode |
|---|---|
| `SESSION_SECRET` must be set | `error` → `process.exit(1)` |
| `SESSION_SECRET` must be ≥ 32 bytes | `error` → `process.exit(1)` |
| `WEBHOOK_SECRET` must be set | `error` → `process.exit(1)` |
| `WEBHOOK_SECRET` must be ≥ 32 bytes | `error` → `process.exit(1)` |
| `CREDENTIAL_ENCRYPTION_KEY` OR `SESSION_SECRET` must be set (for credential encryption) | `error` → `process.exit(1)` |
| `DISABLE_HTTPS_ENFORCEMENT=true` | `warning` (logged, does not abort) |

#### Any environment

| Check | Failure mode |
|---|---|
| `SESSION_SECRET` or `WEBHOOK_SECRET` value contains a weak keyword (`change`, `secret`, `password`, `default`, `test`) | `warning` (logged, does not abort) |

#### Development / test

Absence of `SESSION_SECRET` or `WEBHOOK_SECRET` is only a warning (already handled by the existing `config.js` minimum-length validation). The secrets check adds no new hard errors in non-production environments.

### Configuration reference

| Variable | Required in prod | Min length | Notes |
|---|---|---|---|
| `SESSION_SECRET` | Yes | 32 bytes | Used for session signing and credential-encryption fallback |
| `WEBHOOK_SECRET` | Yes | 32 bytes | Used for GitHub webhook HMAC verification |
| `CREDENTIAL_ENCRYPTION_KEY` | Required (production) | 32 bytes | Encrypts user BYOK credentials at rest. Fallback to `SESSION_SECRET` is only permitted in dev/test — production boot aborts if missing. See [G9](#g9--encryption-key-mandatory-in-production-soc-2-cc61). |
| `DISABLE_HTTPS_ENFORCEMENT` | No | — | Set to `true` only in controlled network environments; generates a warning |

### Generating strong secrets

```bash
# Generate a 48-byte random secret (base64-encoded, 64 chars)
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

# Or via openssl
openssl rand -base64 48
```

Rotate secrets by updating the environment variable and restarting the server. After rotating `SESSION_SECRET`, all existing sessions are invalidated (users must log in again). After rotating `CREDENTIAL_ENCRYPTION_KEY`, any encrypted BYOK credentials stored under the old key will fail to decrypt — re-save credentials via the BYOK settings page.

---

## G2 — Data retention (BYOK credential age-out)

### Policy summary

User AI credentials stored in `user_ai_config.completion_credentials_enc` and `embedding_credentials_enc` are purged when the row has not been updated for `DATA_RETENTION_DAYS` days (default **365**). Users receive a warning email **30 days** before purge (`DATA_RETENTION_WARNING_LEAD_DAYS`).

### Env vars

| Variable | Default | Description |
|---|---|---|
| `DATA_RETENTION_DAYS` | `365` | Inactivity period before credentials are deleted |
| `DATA_RETENTION_WARNING_LEAD_DAYS` | `30` | How many days before purge the warning email is sent |

### Schema change

`Migration 008` adds a `warning_sent_at DATETIME` column to `user_ai_config` so the one-off warning is sent exactly once per retention cycle.

### Running the retention pass

The CLI script `server/scripts/retention.js` performs one full pass:

```bash
# Dry run — inspect what would happen without any DB writes
npm run retention:dry

# Live run — warns and purges as appropriate
npm run retention:run
```

Both commands print a JSON summary:

```json
{
  "checked": 12,
  "warned": 2,
  "purged": 1,
  "skipped": 3,
  "dryRun": false
}
```

### Scheduling via cron

Run the retention pass daily (or weekly). Example crontab entry:

```cron
# Every day at 02:00 UTC
0 2 * * * cd /opt/github-repo-manager && npm run retention:run >> /var/log/grm-retention.log 2>&1
```

For container deployments, use your orchestrator's CronJob primitive (Kubernetes `CronJob`, Railway cron, etc.) pointing at:

```sh
node server/scripts/retention.js
```

### What users experience

1. **335 days of inactivity**: a warning email is sent informing the user that their credentials will be deleted in 30 days. The email explains how to reset the clock (use any AI feature) and how to re-add credentials later.
2. **365 days of inactivity**: `completion_credentials_enc` and `embedding_credentials_enc` are set to `NULL`. A `user_ai_config.purged` event is written to `audit_log_v2`.
3. **After purge**: the user's settings page shows no keys configured. They can re-enter their API keys at any time via **Settings → AI & Keys**.

---

## Email delivery

### Configuring Resend

Set the following environment variables to enable live email delivery:

| Variable | Description |
|---|---|
| `EMAIL_PROVIDER` | Set to `resend` to use the Resend adapter. Defaults to `console`. |
| `RESEND_API_KEY` | Your Resend API key (from resend.com dashboard). Required when `EMAIL_PROVIDER=resend`. |
| `EMAIL_FROM` | The verified sender address (e.g. `noreply@bolalabs.pt`). Required when `EMAIL_PROVIDER=resend`. |

```bash
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxxx
EMAIL_FROM=noreply@bolalabs.pt
```

### Console adapter (development / fallback)

When `EMAIL_PROVIDER` is unset or set to `console`, emails are logged to stdout instead of delivered. The log entry includes the recipient address and subject but **never the body** (which may contain license keys or credentials).

```text
INFO [email:dev] would send { to: "user@example.com", subject: "Your license", bodyLength: 1234 }
```

Use `isEmailDeliveryConfigured()` from `server/lib/email.js` to check at runtime whether actual delivery is configured — e.g. to decide whether to show the license key on-screen as a fallback.

### Verifying delivery in dev

1. Leave `EMAIL_PROVIDER` unset (console mode).
2. Trigger a Stripe webhook or run `npm run retention:dry`.
3. Check server stdout for `[email:dev] would send` lines confirming subject and recipient.

---

## G5 — Rolling session + 7-day absolute timeout (SOC 2 CC6.1)

### Threat

`express-session` is configured with `rolling: true` so active users stay logged in indefinitely — every request bumps the cookie's expiry. That is the right UX default for a daily-use dashboard, but it also means a cookie exfiltrated once (via XSS, malware, a stolen session dump, or a shared device that was never signed out) can be kept alive forever by issuing periodic keepalive requests. Without an absolute ceiling there is no guaranteed window after which a stolen credential stops working.

### Mitigation

A dedicated middleware, [`server/middleware/session-absolute-timeout.js`](../server/middleware/session-absolute-timeout.js), enforces a hard 7-day ceiling on every session regardless of activity. `ABSOLUTE_TIMEOUT_MS` is exported as `7 * 24 * 3600 * 1000` ([line 22](../server/middleware/session-absolute-timeout.js#L22)). On login / mock-login the callback stamps `req.session.createdAt = Date.now()`; on every subsequent request the middleware computes `age = Date.now() - createdAt` ([lines 37-41](../server/middleware/session-absolute-timeout.js#L37)) and when the ceiling is exceeded the session is destroyed and the response is `401 { code: 'session_absolute_timeout' }` ([lines 44-52](../server/middleware/session-absolute-timeout.js#L44)). Legacy sessions missing `createdAt` are accepted without enforcement and stamped on the next login, so deploying the middleware does not sign everyone out at once.

---

## G6 — CSRF double-submit tokens (SOC 2 CC6.1)

### Threat

Session cookies are set with `sameSite: 'lax'`, which blocks most naive cross-site POSTs — but not all of them. Image-tag `GET` mutations, Firefox's weaker "Lax-by-default" implementation, and cross-origin POSTs from a compromised subdomain can still ride a logged-in user's cookie. An attacker who lands JavaScript on any user-controlled origin sharing the parent domain (a sibling marketing site, a GitHub Pages fork, an unsanitised comment on a help-desk product) could trigger destructive app actions without ever reading the session cookie.

### Mitigation

A double-submit-cookie CSRF gate is applied globally in [`server/middleware/csrf.js`](../server/middleware/csrf.js). After login, the client calls `GET /api/auth/csrf-token`, which runs `ensureCsrfToken(req)` to generate a 32-byte base64url token via `crypto.randomBytes(32).toString('base64url')` and stores it in `req.session.csrfToken` ([lines 65-85](../server/middleware/csrf.js#L65)). Every `POST`/`PUT`/`PATCH`/`DELETE` must carry the same token in the `X-CSRF-Token` header; `requireCsrfToken` performs a length-check + `crypto.timingSafeEqual` comparison against the session value and returns `403 { code: 'csrf_invalid' }` on mismatch ([lines 114-132](../server/middleware/csrf.js#L114)). The bypass list is intentionally narrow — only OAuth flow paths (which have no session yet) and the signature-verified webhook mounts (`/api/webhooks/*`, `/api/v1/webhooks/*`) skip the check ([lines 37-42](../server/middleware/csrf.js#L37)). The frontend interceptor in [`src/utils/api.js`](../src/utils/api.js) fetches the token once per session and attaches it to every mutation automatically.

---

## G7 — SSRF guard on import-from-URL (SOC 2 CC6.6)

### Threat

`POST /api/import/url` takes an arbitrary Git URL and hands it to `simple-git` for a `clone --bare` on the server. Without validation, a caller can aim that clone at `http://169.254.169.254/latest/meta-data/` (AWS/GCP/Azure instance-metadata endpoint), `http://localhost:3001/api/admin/...` (loopback to our own admin surface), a `10.0.0.0/8` / `192.168.0.0/16` host on the deployment VPC, or even an IPv4-mapped IPv6 literal like `::ffff:7f00:1` to bypass naive IPv4-only blockers. Any of these would let an unauthenticated or low-privilege user pivot the server into their attack tool.

### Mitigation

[`server/lib/url-validator.js#assertSafeExternalUrl`](../server/lib/url-validator.js#L28) runs a synchronous, defence-in-depth check before the URL ever reaches `simple-git`:

- **Scheme allowlist** ([lines 42-46](../server/lib/url-validator.js#L42)) — `https:` only by default; callers must explicitly pass `allowHttp: true`.
- **Embedded-credentials block** ([lines 48-51](../server/lib/url-validator.js#L48)) — rejects `user:pass@host` URLs that would smuggle credentials into server logs.
- **Localhost / mDNS aliases** ([lines 64-73](../server/lib/url-validator.js#L64)) — rejects `localhost`, `0.0.0.0`, `::`, `::1`, `*.local`, `*.localhost`.
- **IPv4 private / reserved ranges** ([lines 76-99](../server/lib/url-validator.js#L76)) — blocks `0.0.0.0/8`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (explicitly catching `169.254.169.254`, the cloud-metadata IP).
- **IPv6 reserved ranges** ([lines 101-137](../server/lib/url-validator.js#L101)) — blocks loopback / unspecified, `fe80::/10` link-local, `fc00::/7` unique-local, and IPv4-mapped IPv6 in both dotted and hex forms (`::ffff:127.0.0.1` and `::ffff:7f00:1` are caught identically).

For DNS-rebinding defence in depth, the same file exports `resolveAndValidateHost` which re-checks the resolved address against the same ranges after `dns.lookup` ([lines 185-211](../server/lib/url-validator.js#L185)).

---

## G8 — Auth-endpoint rate-limiting (SOC 2 CC6.1)

### Threat

OAuth state-token brute-forcing and authorization-code replay are IP-level attacks — they happen *before* any session exists, so the standard tenant-aware limiter (which keys on `session.userId`) has nothing to bucket by. An attacker can hammer `/api/auth/callback` with guessed codes / forged states as fast as the upstream can respond, and a permissive or unkeyed limiter effectively rate-limits nobody.

### Mitigation

[`server/middleware/tenant-rate-limit.js#createAuthRouteLimiter`](../server/middleware/tenant-rate-limit.js#L101) creates a dedicated per-IP `express-rate-limit` instance applied only to `/api/auth/login` and `/api/auth/callback`. Budget is 20 requests per 15-minute window in production, raised to 200 in dev/test to avoid tripping React Strict Mode double-invokes and Playwright fixture churn ([line 104](../server/middleware/tenant-rate-limit.js#L104)). The key generator is explicitly `rl:authroute:${ipKeyGenerator(req)}` ([line 105](../server/middleware/tenant-rate-limit.js#L105)) — kept intentionally separate from `createTenantLimiters('auth')` because that limiter keys on a session user that does not yet exist and uses a different budget. Over-limit responses include a `Retry-After` header and, when the request accepts HTML, redirect to the frontend with a friendly error code so the browser flow stays legible.

---

## G9 — Encryption key mandatory in production (SOC 2 CC6.1)

### Threat

User BYOK AI credentials and Azure DevOps PATs are encrypted at rest with AES-256-GCM. Prior to this release, the encryption key could silently fall back to `SESSION_SECRET` if `CREDENTIAL_ENCRYPTION_KEY` was not configured. That folds two very different blast radii into one secret: a leaked `.env`, a dumped session store, or an accidental secret commit would then expose every stored credential alongside every active session. Rotating `SESSION_SECRET` (an operationally common action — it signs out all users) would also invalidate every stored credential, which operators were understandably reluctant to do.

### Mitigation

[`server/lib/startup-secrets-check.js#verifySecretsAtStartup`](../server/lib/startup-secrets-check.js#L19) now includes `CREDENTIAL_ENCRYPTION_KEY` in the production-required list alongside `SESSION_SECRET` and `WEBHOOK_SECRET` ([line 27](../server/lib/startup-secrets-check.js#L27)). In `NODE_ENV=production` the check aborts with `process.exit(1)` if the key is absent or shorter than 32 bytes ([lines 29-37](../server/lib/startup-secrets-check.js#L29)). The verifier runs before `initDB()` and before the Express app binds to a port, so a misconfigured deploy fails fast at boot rather than starting up and then silently persisting credentials encrypted under the session signing key. Weak-keyword detection (`change`, `secret`, `password`, `default`, `test`) is applied to all three required secrets in every environment ([lines 98-106](../server/lib/startup-secrets-check.js#L98)) to catch copy-paste mistakes during setup.

---

## G10 — Shared request-validation layer (SOC 2 CC6.6)

### Threat

Route handlers that read `req.body` / `req.query` / `req.params` directly trust
whatever the client sends. Divergent, hand-rolled validation (or none) invites
type-confusion bugs, oversized payloads, and injection into downstream GitHub /
Azure / AI calls — and inconsistent error shapes make the client guess.

### Mitigation

A shared Zod layer standardises input validation. Schemas live in
[`server/lib/validators.js`](../server/lib/validators.js); the thin middleware
wrappers `validateBody` / `validateQuery` / `validateParams` in
[`server/middleware/validate-request.js`](../server/middleware/validate-request.js)
`safeParse` the input and, on failure, emit a single consistent envelope —
`400 { error, code: 'validation_failed' }` — with the first issue's path +
message. Parsed data is attached at `req.validatedBody` / `req.validatedQuery`
/ `req.validatedParams` so handlers never mutate `req.body` in place. Coverage
includes PR write-backs, repo-content writes, issue labels/assignees, webhook
updates, workflow dispatch, community-health, AI (`/ai/*` bodies with
`sanitizeForPrompt`), and the import/search/bulk routes. Combined with the
existing SSRF guard (G7) and the AI body-size caps, untrusted input is validated
before it reaches any privileged sink.

> **Data erasure (GDPR Art. 17)** is registry-driven — see [G3](#g3--self-service-data-erasure-gdpr-article-17--soc-2-cc65). Every user-scoped table is classified in `ERASURE_REGISTRY` (`server/routes/user-data.js`) and a schema-introspection completeness test fails the build if a new user-keyed table is added without a classification.
