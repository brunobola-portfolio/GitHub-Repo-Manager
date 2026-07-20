# Backend Architecture

The backend is a modular Express server that handles GitHub OAuth authentication,
proxies the GitHub REST API, manages local data in SQLite, and provides services
for AI analysis, repository migration, Azure DevOps integration, billing, and
more.

## Directory Layout

```text
server/
├── index.js                      # Express setup, middleware, route mounting (~296 lines)
├── config.js                     # Zod-validated environment config
├── db.js                         # Database initialisation and schema
├── routes/
│   ├── v1/index.js               # V1 API aggregator — mounts all route modules
│   ├── auth.js                   # GitHub OAuth login / callback / logout
│   ├── repos.js                  # Repository CRUD and GitHub proxy endpoints
│   ├── orgs.js                   # Organisation listing and management
│   ├── teams.js                  # Team CRUD, membership, repo assignments
│   ├── ai.js                     # AI-powered analysis and semantic search
│   ├── migration.js              # Multi-step migration plans and execution
│   ├── azure.js                  # Azure DevOps projects, repos, branches
│   ├── import.js                 # Git bare-clone import (simple-git)
│   ├── billing.js                # Stripe subscription management
│   ├── usage.js                  # Per-tenant usage metering
│   ├── stats.js                  # Dashboard and analytics endpoints
│   ├── user.js                   # User profile and preferences
│   ├── bulk.js                   # Bulk repository operations
│   ├── audit.js                  # Audit log queries and export
│   ├── api-keys.js               # API key generation and management
│   ├── system.js                 # Health, feature flags, system info
│   ├── webhooks.js               # GitHub webhook receiver (signature-verified)
│   ├── stripe-webhooks.js        # Stripe webhook handler (raw body)
│   ├── health.js                 # /api/health/live + /ready probes
│   ├── env.js                    # /api/env/* operator tooling status + install
│   ├── dashboard.js              # /api/v1/dashboard/* — inbox, archive, restore, snooze
│   ├── repos/                    # crud, pulls, issues, commits, branches-releases,
│   │                             # actions-community (incl. agent-rules), tree, readme-studio
│   ├── ai/                       # core, diagrams, images, indexing, migration, prompts,
│   │                             # dev-toolkit, deep-review, prompt-studio, pr-commands, pr-chat
│   ├── v1/repos-security.js      # GET security scan + 10-check posture card, POST AI summary
│   ├── azure/  import/           # domain sub-routers (split from monoliths)
│   └── … work-board*, admin-*, license, user-data, notifications, search, outbox
├── middleware/
│   ├── auth.js                   # requireAuth, webhook signature, safeError
│   ├── api-key-auth.js           # Bearer token (grm_live_*) authentication
│   ├── require-tier.js           # Tier gating (free / pro / enterprise)
│   ├── require-admin.js          # requireAdmin (users.is_admin flag)
│   ├── csrf.js                   # CSRF double-submit token gate
│   ├── validate-request.js       # validateBody/Query/Params → validation_failed
│   ├── tenant.js                 # Multi-tenancy (req.tenantId from session)
│   └── tenant-rate-limit.js      # Per-tier rate limiting (Redis or in-memory)
├── lib/
│   ├── github-api.js             # GitHub REST API wrapper with retry logic
│   ├── gh-cache.js               # ETag-aware read-through GitHub cache (gh_cache)
│   ├── gh-outbox.js              # Idempotent GitHub mutation outbox (gh_outbox)
│   ├── audit.js                  # Audit log writer (hash-chained)
│   ├── credential-encryption.js  # AES-256-GCM credential vault
│   ├── feature-flags.js          # Tier feature matrix (free / pro / enterprise)
│   ├── db-migrations.js          # Versioned schema-migration ledger (v28)
│   ├── db-backup.js              # WAL-safe scheduled SQLite backups
│   ├── maintenance-janitors.js   # Daily/hourly retention + purge + backup timers
│   ├── logger.js                 # Pino structured logging
│   ├── monitoring.js             # Sentry error tracking initialisation
│   ├── queue.js                  # BullMQ queues (falls back to in-memory)
│   ├── session-store.js          # SQLite-backed session store
│   ├── session-store-redis.js    # Redis-backed session store
│   ├── stripe.js                 # Stripe SDK helpers
│   ├── usage-meter.js            # API call / AI query usage counter
│   ├── utils.js                  # Shared utility functions
│   ├── dashboard-aggregator.js   # Composes Live Inbox from event-aggregation helpers
│   ├── validators.js             # Zod schemas for request validation
│   ├── db-adapter.js             # Database adapter factory (SQLite only)
│   ├── ai-features/              # Per-feature AI prompt/signal builders — readme-studio.js,
│   │                             # agent-rules.js, diagram-embed.js, image-provider.js,
│   │                             # image-pricing.js, license-detect.js, quality-metrics.js,
│   │                             # pr-review.js, semantic-search.js, and more (one file per
│   │                             # AI capability; consumed by the matching routes/ai/* or
│   │                             # routes/repos/* route)
│   └── adapters/
│       └── sqlite-adapter.js     # better-sqlite3 wrapper
├── workers/
│   ├── migration-worker.js       # BullMQ processor for migration plans
│   └── ai-worker.js              # BullMQ processor for repo indexing
├── migrations/                   # NO .sql files — see lib/db-migrations.js (README only)
├── __tests__/                    # Backend unit tests (many files; part of the 5,200+ suite)
├── ai-service.js                 # Google Gemini AI analysis and embeddings
├── actions-service.js            # GitHub Actions workflow run analytics
├── azure-service.js              # Azure DevOps REST API v7.1 (PAT auth)
├── community-health-service.js   # Community health metric calculation
├── import-service.js             # Git bare-clone + push-mirror import
├── migration-engine.js           # Migration plan executor
├── migration-planner.js          # Migration plan generator
├── wiki-service.js               # Repository wiki operations
└── work-item-service.js          # Azure DevOps work-item integration
```

## Entry Point: `server/index.js`

The entry point is a compact orchestration file responsible for:

0. **Startup secrets check** -- `verifySecretsAtStartup()` runs before anything
   binds a port; a misconfigured production deploy fails fast (see
   [security hardening G4/G9](../security-hardening.md)).
1. **Monitoring** -- initialises Sentry before anything else.
2. **Database** -- calls `initDB()` (base schema) then the versioned migration
   ledger (`runMigrations`), and seeds data in mock mode only.
3. **AI** -- optionally initialises Google Gemini if `GEMINI_API_KEY` is set.
4. **Middleware stack** (applied in order):
   - `helmet` -- security headers (full CSP in production).
   - `cors` -- credentials-aware, origin-locked in production.
   - `compression` -- gzip response compression (mounted early), with
     immutable caching on content-hashed `/assets`.
   - `express.raw` -- raw body for the Stripe webhook endpoint (before JSON
     parser).
   - `express.json` -- body-size limited (larger cap on v1 AI routes).
   - Request ID tracing (`X-Request-Id`) + Pino request logger.
   - `per_page` cap (1--100) on all `/api/` routes.
   - CSRF double-submit gate on mutating routes.
   - Rate limiting: global safety-net limiter, then per-tenant limiters after
     session.
   - Session (Redis > SQLite > MemoryStore, depending on environment).
   - `attachTier` -- populates `req.userTier` from subscription data.
5. **Health probes** -- `GET /api/health/live` + `/ready` (K8s-style;
   unauthenticated, un-rate-limited); the legacy shallow `GET /api/health` is
   preserved.
6. **Route mounting** -- `/api/env/*` tooling routes, then V1 routes on
   `/api/v1` with a backward-compatible `/api` alias.
7. **Maintenance janitors** -- `startMaintenanceJanitors()` schedules the daily
   (retention + gh_cache purge + event retention + DB backup) and hourly
   (gh_outbox + undo-log) passes.
8. **Static serving** -- production builds served from `dist/` with SPA
   fallback (`/{*splat}` named splat for Express 5 / path-to-regexp v8).
9. **Error handling** -- Sentry handler, then a global JSON error handler.
10. **Graceful shutdown** -- flips the liveness probe to `shutting_down`, drains
    in-flight requests, marks in-flight migration jobs/plans/tasks interrupted,
    stops the janitors, closes the DB, and force-closes lingering SSE streams
    before force-exit.

## Route Aggregation: `server/routes/v1/index.js`

The route modules are mounted by the V1 aggregator (the table below is a
representative subset — the full set spans 74 route modules (325 route handlers)
under `server/routes/`, including several domain sub-routers). Some routes are
tier-gated at mount time:

| Mount path | Module | Tier gate |
| --- | --- | --- |
| `/auth` | auth.js | -- |
| `/repos` | repos.js | -- |
| `/orgs` | orgs.js | -- |
| `/stats` | stats.js | -- |
| `/audit` | audit.js | -- |
| `/api-keys` | api-keys.js | -- |
| `/billing` | billing.js | -- |
| `/usage` | usage.js | -- |
| `/system` | system.js | -- |
| `/teams` | teams.js | -- |
| `/` | migration.js | -- |
| `/` | ai.js | -- |
| `/` | azure.js | -- |
| `/` | import.js | -- |
| `/` | webhooks.js | -- |
| `/` | user.js | -- |
| `/` | bulk.js | -- |
| `/dashboard` | dashboard.js | -- |

> **Free-first since the 2026-07-18 rebalance.** `teams.js` and `migration.js`
> mount without `requireTier` — teams are free with unlimited seats, and
> migration dry-run/risk analysis is free while a full clone+push migration is
> metered (5/month on Free, unlimited on Pro/Enterprise) rather than tier-gated
> at the router. Per-route metering lives in `usage-meter.js`, not at mount time.

The aggregator also defines two inline team endpoints (team activity stream and
team actions stats) that query GitHub events and actions data in batched,
rate-limit-aware fetches with an in-memory TTL cache.

Backward compatibility: `server/index.js` mounts the V1 router on both
`/api/v1` and `/api`, so existing clients that omit the version prefix continue
to work.

## Service Layer

Business logic is extracted into dedicated service modules at the top level of
`server/`:

| Service | Responsibility |
| --- | --- |
| `ai-service.js` | Google Gemini integration: repo analysis, semantic search, embedding generation |
| `actions-service.js` | GitHub Actions workflow run analytics and multi-repo stats |
| `azure-service.js` | Azure DevOps REST API v7.1 (PAT auth): projects, repos, branches, work items |
| `community-health-service.js` | Community health score calculation (README, license, contributing, etc.) |
| `import-service.js` | Git repository import via simple-git (bare clone + push mirror, LFS support) |
| `migration-engine.js` | Executes migration plans: task orchestration, progress tracking, error recovery |
| `migration-planner.js` | Generates migration plans: analyses source repos, builds task graphs |
| `wiki-service.js` | Repository wiki operations |
| `work-item-service.js` | Azure DevOps work-item integration |

## Database

### Adapter Pattern

The database layer uses an adapter pattern (`lib/db-adapter.js`), but SQLite
is the only supported backend:

- **No URL or `sqlite:...`** -- `SQLiteAdapter` (default). Wraps `better-sqlite3`
  with its synchronous `db.prepare().get/all/run()` API. An async facade is also
  provided for interface parity with call sites written against an async db API.
- **`postgres://...` / `postgresql://...`** -- rejected. PostgreSQL support was
  removed; the factory throws a clear error at boot instead of falling
  through to a nonexistent adapter. See [`docs/operations.md`](../operations.md)
  for the SQLite backup/restore/scale story.

### Schema Management

`db.js` exports `initDB()` which applies the idempotent base schema
(`CREATE TABLE/INDEX IF NOT EXISTS`) inside a transaction, then calls
`runMigrations(db)` from [`lib/db-migrations.js`](../../server/lib/db-migrations.js).
Tables include: `users`, `teams`, `team_members`, `repo_assignments`,
`repo_metadata`, `repo_embeddings`, `community_health_cache`, `workflow_runs`,
`workflows_meta`, `migration_jobs`, `migration_plans`, `migration_tasks`,
`user_subscriptions`, `api_keys`, `audit_log_v2`, `gh_cache`, `gh_outbox`,
`dashboard_inbox_state`, and more.

`dashboard_inbox_state` carries `(user_id INTEGER, item_id TEXT, archived_at TEXT, snoozed_until TEXT)` with composite PK `(user_id, item_id)`. `item_id` is a stable aggregator-defined key like `pr:owner/repo#123`.

**There are no `.sql` migration files.** The old drifting `server/migrations/00X-*.sql`
copies were removed; the directory now holds only a README. Ordered, versioned
migrations live in `lib/db-migrations.js` (`MIGRATIONS`, currently **v28**),
recorded in a `schema_migrations(version, name, applied_at)` ledger. Every
`up(db)` is idempotent (`addColumnIfMissing` + `IF NOT EXISTS`) so it re-applies
safely on databases that predate the ledger. Add a schema change by appending
the next version number — never by adding a `.sql` file.

## Configuration

`server/config.js` uses Zod to validate and freeze all environment variables at
startup. The schema covers:

- **Server**: `NODE_ENV`, `PORT` (default 3001)
- **Session**: `SESSION_SECRET` (enforced in production)
- **GitHub OAuth**: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- **Database**: `DATABASE_URL` (optional; SQLite if absent)
- **Redis**: `REDIS_URL` (optional; enables distributed sessions and BullMQ)
- **AI**: provider-neutral `AI_PROVIDER` (default `gemini`), `GEMINI_API_KEY`,
  `GEMINI_MODEL` (default `gemini-2.5-flash`), `GEMINI_EMBEDDING_MODEL`
  (default `gemini-embedding-001`), `AI_MAX_OUTPUT_TOKENS` (per-call cap),
  `AI_REQUIRE_USER_CONFIG`
- **Monitoring**: `SENTRY_DSN`
- **Azure DevOps**: `AZURE_PAT`
- **Webhooks**: `WEBHOOK_SECRET`
- **Stripe**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price IDs
- **Ops / retention**: `DB_BACKUP_DIR`, `DB_BACKUP_KEEP` (default 7),
  `DATA_RETENTION_DAYS` (default 365), `EVENT_RETENTION_DAYS` (default 365),
  `GH_CACHE_MAX_AGE_DAYS` (default 30)
- **Mock mode**: `VITE_MOCK_MODE` (production boot fails fast if
  `ALLOW_MOCK_AUTH` is set)

Invalid configuration causes the process to exit immediately with formatted
error output.

## Middleware

### Authentication (`middleware/auth.js`)

Exports `requireAuth` (session-based), webhook signature verification
(HMAC-SHA256 with timing-safe comparison), GitHub username validation, and
`safeError` for sanitising internal errors before sending to clients.

### API Key Authentication (`middleware/api-key-auth.js`)

Supports `Bearer grm_live_*` tokens. Keys are SHA-256 hashed before storage.
Checks expiration, revocation, and scope restrictions.

### Tier Gating (`middleware/require-tier.js`)

`requireTier(minTier)` returns middleware that checks `user_subscriptions` and
rejects requests below the required tier with a structured
`upgrade_required` response. `attachTier` populates `req.userTier` for
downstream use.

### Multi-Tenancy (`middleware/tenant.js`)

`requireTenant` attaches `req.tenantId` from the authenticated session,
ensuring all database queries are scoped to the current user.

### Rate Limiting (`middleware/tenant-rate-limit.js`)

Two layers:

1. **Global safety-net** -- caps anonymous / pre-session traffic (relaxed in
   development to accommodate React Strict Mode double-invokes).
2. **Per-tenant limiters** -- applied after session and tier attachment, with
   separate ceilings for the `api` and `auth` namespaces. Uses Redis when
   `REDIS_URL` is configured; falls back to in-process MemoryStore otherwise.

## Background Workers

Workers use BullMQ when Redis is available. Without Redis, `lib/queue.js`
provides an in-memory queue that executes jobs immediately in-process.

| Worker | Queue | Purpose |
| --- | --- | --- |
| `migration-worker.js` | migration | Executes migration plans asynchronously via `migrationEngine.executePlan()` |
| `ai-worker.js` | ai | Indexes repositories (`index-repo`) and runs batch indexing (`batch-index`) with progress reporting |

## Utility Libraries (`server/lib/`)

| Module | Purpose |
| --- | --- |
| `github-api.js` | GitHub REST API wrapper with retry and error normalisation |
| `audit.js` | Writes structured audit log entries |
| `credential-encryption.js` | AES-256-GCM encryption for stored credentials (PATs, tokens) |
| `feature-flags.js` | Tier feature matrix: repo limits, AI quotas, teams, SSO, audit log |
| `logger.js` | Pino structured logger (JSON in production, human-readable in dev) |
| `monitoring.js` | Sentry initialisation and error handler factory |
| `queue.js` | BullMQ queue/worker factory with in-memory fallback |
| `session-store.js` | SQLite-backed Express session store |
| `session-store-redis.js` | Redis-backed Express session store |
| `stripe.js` | Stripe SDK helpers |
| `usage-meter.js` | Per-tenant API call and AI query usage counter |
| `utils.js` | Shared utility functions |
| `dashboard-aggregator.js` | Fans out to event-aggregation helpers; deduplicates and filters by archive/snooze state from dashboard_inbox_state |
| `validators.js` | Zod schemas for request input validation |

## Session Store Selection

The server selects a session store in priority order:

1. **Redis** (`REDIS_URL` set) -- distributed sessions for multi-instance
   deployments.
2. **SQLite** (production, no Redis) -- single-instance persistent sessions.
3. **MemoryStore** (development default) -- non-persistent, acceptable for local
   development.

## Tier System

Three subscription tiers control feature access. The **source of truth** is
[`lib/feature-flags.js`](../../server/lib/feature-flags.js) (`TIER_FEATURES`) —
this table is a rendering of it and must be kept in sync (the README pricing
table and a parity CI gate track the same values):

| Feature | Free | Pro | Enterprise |
| --- | --- | --- | --- |
| Max repos | 1,000 | Unlimited | Unlimited |
| AI queries / month (global) | 1,000 | 10,000 | Unlimited |
| Semantic search / month | 375 | Unlimited | Unlimited |
| Migration risk analysis / month | 25 | Unlimited | Unlimited |
| Full migrations / month | 5 (metered; dry-run free) | Unlimited | Unlimited |
| Teams | Unlimited (unlimited seats) | Unlimited | Unlimited |
| Basic bulk (own repos) | Yes | Yes | Yes |
| Advanced bulk (transfer / mirror / cross-org) | Yes | Yes | Yes |
| Mirror sync apply / month | 10 (metered) | Unlimited | Unlimited |
| Audit log | -- | -- | Yes + export |
| API keys | 25 | 50 | 100 |
| SSO / SAML | -- (roadmap) | -- (roadmap) | -- (roadmap) |

> The AI capabilities (Assistant, Semantic Search, Migration Risk Analysis, PR
> Review) are available on **every** tier, with per-feature monthly caps on Free
> tracked independently of the global `aiQueriesPerMonth` counter. SSO/SAML is
> on the roadmap but **not implemented** (only GitHub OAuth exists), so
> `feature-flags.js` keeps `sso: false` on every tier.

## Testing

Backend tests live in `server/__tests__/` and cover auth + webhook verification,
credential encryption, the migration engine/planner, request validators, route
body-validation, tier gating, AI routes/streaming guards, and the Azure
wiki/work-item services. They are part of the project's **5,200+ unit test**
suite (Vitest); the frontend tests live under `tests/` mirroring `src/`.

Run backend tests:

```bash
npx vitest run server/__tests__/
```

Run the full test suite:

```bash
npx vitest
```

## Security

- **Session cookies**: `httpOnly`, `sameSite: 'lax'`, `secure` in production;
  rolling expiry with a hard 7-day absolute ceiling (see security hardening G5).
- **CSRF double-submit tokens** on every mutating route (G6).
- **HMAC-SHA256 webhook verification** with timing-safe comparison.
- **Parameterised SQL queries** throughout (no string interpolation).
- **Zod validation** on config (`config.js`) and request inputs — the shared
  `validate-request.js` layer returns a consistent `validation_failed` envelope.
- **Helmet** for security headers with strict CSP in production.
- **HSTS** with preload in production (2-year max-age).
- **API key hashing** (SHA-256 before storage, never stored in plaintext).
- **Credential encryption** (AES-256-GCM for stored PATs and tokens).
- **Rate limiting** at both global and per-tenant levels.
- **10 KB body limit** to prevent payload abuse.
- **`per_page` cap** (1--100) on all API list endpoints.

---

Last updated: 2026-07-06
