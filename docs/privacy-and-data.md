# Privacy & Data Handling

This document describes what a running deployment of GitHub Repo Manager
actually stores, sends, and retains — grounded in the code, not in a
policy template. If a fact here can't be traced to a file, it doesn't
belong here; see "Where this is enforced" at the end for the citations.

This is **not** a legal privacy policy for a specific company. If you are
running a hosted (SaaS) instance for other people, you are the data
controller and are responsible for publishing your own policy — see
"Self-hosting and who is responsible" below.

## What is stored

A deployment's SQLite database holds, per user:

- **Account record** — GitHub user id, username, email, avatar URL
  (`users` table).
- **Session** — the GitHub OAuth access token, encrypted at rest (see
  "Encryption" below) and stored server-side; the browser only holds an
  `httpOnly` session cookie, never the token itself.
- **BYOK AI provider credentials** — the API key you configure for your
  own AI provider (Anthropic, OpenAI, Gemini, OpenRouter, or a local
  model endpoint), encrypted at rest with AES-256-GCM.
- **Azure DevOps PATs** — personal access tokens you add for migration,
  encrypted the same way.
- **Webhook events** — GitHub/Stripe webhook deliveries are recorded for
  idempotency and retry (`webhook_events`, `webhook_events_dead_letter`)
  and aged out by retention (below).
- **Audit log** — an append-only, SHA-256 hash-chained log of security-
  relevant actions (logins, credential changes, data export/erasure,
  admin actions). Each row's hash covers the previous row's hash, so a
  tampered or deleted row breaks the chain and is detectable by a
  verification pass.
- **Product data** — the things the app is for: cached repo metadata,
  migration jobs/plans, AI feature usage counters, work-board state, PR
  review/chat records tied to your account, team memberships, API keys
  (hashed, not the raw secret), and similar rows scoped to your user id.

## Encryption

Credentials (BYOK AI keys, Azure PATs, and the session's GitHub OAuth
token) are encrypted with **AES-256-GCM**, keyed by a PBKDF2-derived key
(210,000 iterations, SHA-512, per-blob random salt in the current format;
older blobs may still carry the legacy 100,000-iteration/SHA-256
parameters and continue to decrypt under them — new writes always use the
current parameters). The encryption key comes from
`CREDENTIAL_ENCRYPTION_KEY` (mandatory in production) and supports
zero-downtime rotation via `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS`. Plaintext
credentials are never written to disk or logs — only the ciphertext blob
lives in the database, and API responses expose only a `hasCompletionKey`
/ `hasEmbeddingKey` boolean, never the key or PAT itself.

## What leaves the server, and to whom

- **Your own AI provider** (Anthropic, OpenAI, Gemini, OpenRouter, or a
  local endpoint you configure) receives the content you ask an AI
  feature to process — for example a diff for a PR review, or a repo file
  for a README suggestion. Before a pull-request diff is sent, it passes
  through value-shaped redaction that strips credential-looking values
  (GitHub/GitLab/Slack/Stripe/AWS/Google tokens, JWTs, PEM key blocks, and
  `key = "…"` / `token: "…"`-style literal assignments) while leaving the
  surrounding code readable. This is a BYOK product: your provider bills
  you directly, and Bola Labs never proxies, resells, or has visibility
  into that inference call.
- **GitHub** receives your own OAuth token on API calls made on your
  behalf (reading/writing repos, PRs, issues) — this is direct
  browser-you-GitHub-via-server traffic, not a third-party share.
- **Resend** (or whichever provider `EMAIL_PROVIDER` names) receives the
  recipient address and body of transactional email — license delivery,
  retention warnings, account notices — and only if an email provider is
  actually configured (`RESEND_API_KEY` set). No provider configured
  means no outbound email, not a silent fallback.
- **Sentry** receives error telemetry (stack traces, request metadata) —
  and only if `SENTRY_DSN` is set. Unset means monitoring is disabled
  entirely, not a default-on integration.
- **Stripe** (hosted billing only) receives what a checkout requires —
  handled by Stripe's own hosted flow, not proxied through this app's
  database beyond the subscription status webhook.

Nothing else leaves the server. There is no analytics pixel, no
third-party ad or tracking script, and no aggregation of your usage data
sent anywhere outside the deployment.

## Retention

- **Unused AI/BYOK credentials are erased after 365 days of inactivity**
  (configurable via `DATA_RETENTION_DAYS`). A warning email goes out
  `DATA_RETENTION_WARNING_LEAD_DAYS` (default 30) before the purge date;
  using any AI feature resets the clock. The purge is itself an audited
  action (`user_ai_config.purged`) so the hash-chained log records that it
  happened, without recording the credential itself.
- **GitHub event tables** (PR/issue events used for dashboards and DORA
  metrics) age out after `EVENT_RETENTION_DAYS` (default 365; set to 0 or
  empty to disable the janitor).
- **Webhook dead-letter entries** and other operational queues have their
  own bounded retention/cleanup, independent of user data.
- **The audit log is never purged by user action** — it is the one table
  a self-service account erasure explicitly does not delete (see below),
  because deleting a row would break the hash chain that makes the log
  tamper-evident.

## Self-hosting and who is responsible

This software is Apache-2.0 and free to self-host. If you deploy it — for
yourself or to offer it to other people — **you are the data
controller** for whatever your deployment stores. Bola Labs has no access
to a self-hosted instance's database, credentials, or logs. If you run a
hosted service for others, publishing your own privacy policy and
honoring data-subject requests under whatever law applies to you is your
responsibility, not something this document does on your behalf.

## Deleting your account

Settings → Danger Zone offers **Erase my data**, which requires typing a
confirmation string and calls `DELETE /api/v1/user/data`. This wipes
every table that carries your user id — AI config and BYOK credentials,
Azure PATs, migration jobs/plans, cached repo data, work-board state, API
keys, team memberships, and more — driven by an explicit registry so a
newly added table can't be silently missed (a companion test scans the
live schema and fails if any user-keyed table isn't classified). Your
`users` row is tombstoned rather than deleted (email/username/avatar
nulled, `deleted_at` set) so audit history keeps referential integrity,
and the audit log itself survives erasure by design — an append-only
hash chain cannot selectively forget one user without breaking
verification for everyone. Erasure is blocked while a subscription is
still active; cancel first.

## Exporting your data

Settings → Danger Zone also offers **Export my data**
(`GET /api/v1/user/data/export`), a JSON download of the same
user-scoped rows the erasure endpoint would wipe — account info,
AI config (without the encrypted key material), subscriptions, API key
metadata (without the key secret), migration history, PR/issue events,
Azure credential metadata (without the PAT), AI prompts, and work-board
data. Secrets are never included in the export, only their presence/
metadata. Large tables are capped at 50,000 rows per table with a
`truncated` marker rather than silently dropping data or producing an
unbounded response.

## Support

The support contact shown in the app and on pricing pages comes from
`VITE_SUPPORT_EMAIL`, set at build time. A self-hosted operator who sets
their own value routes their users' support requests to themselves
instead of the upstream maintainer.

## Where this is enforced

- Encryption algorithm, KDF parameters, key rotation —
  `server/lib/credential-encryption.js`
- BYOK credential storage and public-shape redaction (`hasCompletionKey`
  / `hasEmbeddingKey`, never the key) — `server/lib/user-ai-config.js`
- Diff redaction before a provider call — `server/lib/secret-redactor.js`
  (`redactValues`), used by `server/routes/ai/deep-review.js`,
  `server/routes/ai/pr-commands.js`, `server/routes/ai/dev-toolkit.js`
- Credential retention window, warning email, audited purge —
  `server/lib/retention.js`
- Event-table retention — `server/lib/maintenance-janitors.js`
  (`EVENT_RETENTION_DAYS`)
- Audit log hash chain — `server/lib/audit.js` (`computeRowHash`,
  `verifyAuditChain`)
- Account erasure registry, tombstoning, completeness guarantee —
  `server/routes/user-data.js` (`ERASURE_REGISTRY`,
  `scanSchemaForUnclassifiedUserTables`)
- Data export endpoint and row caps — `server/routes/user-data.js`
  (`GET /export`)
- Email provider gating (`RESEND_API_KEY`) — `server/lib/email.js`,
  `server/config.js`
- Sentry gating (`SENTRY_DSN`) — `server/lib/monitoring.js`,
  `server/config.js`
- Support email configuration — `src/utils/supportContact.js`
  (`VITE_SUPPORT_EMAIL`)
