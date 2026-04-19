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

A `200` response includes a summary of what was deleted:

```json
{
  "deleted": {
    "aiConfig": true,
    "migrationJobs": 3,
    "migrationPlans": 1,
    "prEvents": 12,
    "issueEvents": 4,
    "reviewAssignments": 7,
    "communityHealthCache": 5,
    "repoMetadata": 8,
    "repoEmbeddings": 8,
    "workflowRuns": 22,
    "workflowsMeta": 3,
    "usageMetrics": 2,
    "apiKeys": 1,
    "subscriptions": 1,
    "teamMemberships": 2
  },
  "tombstoned": ["user", "audit_log"]
}
```

The session is destroyed immediately after the wipe. Any subsequent request with the same cookie will be rejected as unauthenticated.

### Idempotency

A repeat call from the same session (or a new session for the same `user_id`) returns `404` because `deleted_at` is already set. The caller should treat `404` as a successful no-op (erasure already completed).

---

## G4 — Startup secrets verification (SOC 2 CC6.1)

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
| `CREDENTIAL_ENCRYPTION_KEY` | Recommended | — | Preferred key for encrypting user BYOK credentials; falls back to `SESSION_SECRET` |
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
