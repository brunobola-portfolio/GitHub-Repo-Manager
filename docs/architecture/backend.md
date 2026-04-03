# Backend Architecture

The backend is a modular Express server that handles GitHub OAuth authentication,
proxies the GitHub REST API, manages local data in SQLite (or PostgreSQL), and
provides services for AI analysis, repository migration, Azure DevOps integration,
billing, and more.

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
│   └── stripe-webhooks.js        # Stripe webhook handler (raw body)
├── middleware/
│   ├── auth.js                   # requireAuth, webhook signature, safeError
│   ├── api-key-auth.js           # Bearer token (grm_live_*) authentication
│   ├── require-tier.js           # Tier gating (free / pro / enterprise)
│   ├── tenant.js                 # Multi-tenancy (req.tenantId from session)
│   └── tenant-rate-limit.js      # Per-tier rate limiting (Redis or in-memory)
├── lib/
│   ├── github-api.js             # GitHub REST API wrapper with retry logic
│   ├── audit.js                  # Audit log writer
│   ├── credential-encryption.js  # AES-256-GCM credential vault
│   ├── feature-flags.js          # Tier feature matrix (free / pro / enterprise)
│   ├── logger.js                 # Pino structured logging
│   ├── monitoring.js             # Sentry error tracking initialisation
│   ├── queue.js                  # BullMQ queues (falls back to in-memory)
│   ├── session-store.js          # SQLite-backed session store
│   ├── session-store-redis.js    # Redis-backed session store
│   ├── stripe.js                 # Stripe SDK helpers
│   ├── usage-meter.js            # API call / AI query usage counter
│   ├── utils.js                  # Shared utility functions
│   ├── validators.js             # Zod schemas for request validation
│   ├── db-adapter.js             # Database adapter factory
│   └── adapters/
│       ├── sqlite-adapter.js     # better-sqlite3 wrapper
│       └── postgres-adapter.js   # node-postgres (pg) wrapper
├── workers/
│   ├── migration-worker.js       # BullMQ processor for migration plans
│   └── ai-worker.js              # BullMQ processor for repo indexing
├── migrations/
│   └── 001-initial-schema.sql    # Base SQL migration
├── __tests__/                    # Backend unit tests (8 files)
│   ├── auth.test.js
│   ├── credential-encryption.test.js
│   ├── migration-engine.test.js
│   ├── migration-planner.test.js
│   ├── validators-migration.test.js
│   ├── validators.test.js
│   ├── wiki-service.test.js
│   └── work-item-service.test.js
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

The entry point is a lean 296-line file responsible for:

1. **Monitoring** -- initialises Sentry before anything else.
2. **Database** -- calls `initDB()` to run schema migrations and seed data (mock
   mode only).
3. **AI** -- optionally initialises Google Gemini if `GEMINI_API_KEY` is set.
4. **Middleware stack** (applied in order):
   - `helmet` -- security headers (full CSP in production).
   - `cors` -- credentials-aware, origin-locked in production.
   - `express.raw` -- raw body for the Stripe webhook endpoint (before JSON
     parser).
   - `express.json` -- 10 KB body limit.
   - Request ID tracing (`X-Request-Id`).
   - Pino request logger.
   - `per_page` cap (1--100) on all `/api/` routes.
   - Rate limiting: global safety-net limiter, then per-tenant limiters after
     session.
   - Session (Redis > SQLite > MemoryStore, depending on environment).
   - `attachTier` -- populates `req.userTier` from subscription data.
5. **Health check** -- `GET /api/health` returns status, version, uptime, and
   database connectivity.
6. **Route mounting** -- V1 routes on `/api/v1`, with backward-compatible
   `/api` alias.
7. **Static serving** -- production builds served from `dist/` with SPA
   fallback.
8. **Error handling** -- Sentry handler, then a global JSON error handler.
9. **Graceful shutdown** -- marks in-flight migration jobs as interrupted, closes
   the database, and force-exits after a 10-second timeout.

## Route Aggregation: `server/routes/v1/index.js`

All 18 route modules are mounted by the V1 aggregator. Some routes are
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
| `/teams` | teams.js | pro |
| `/` | migration.js | pro |
| `/` | ai.js | -- |
| `/` | azure.js | -- |
| `/` | import.js | -- |
| `/` | webhooks.js | -- |
| `/` | user.js | -- |
| `/` | bulk.js | -- |

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

The database layer uses an adapter pattern (`lib/db-adapter.js`) that selects
the backend based on the `DATABASE_URL` environment variable:

- **No URL or `sqlite:...`** -- `SQLiteAdapter` (default). Wraps `better-sqlite3`
  with its synchronous `db.prepare().get/all/run()` API. An async facade is also
  provided for interface parity with PostgreSQL.
- **`postgres://...`** -- `PostgresAdapter`. Wraps `node-postgres` with async
  methods. Automatically converts `?` placeholders to `$N` positional params.
  The `pg` package is dynamically imported only when needed, keeping
  SQLite-only deployments lightweight.

### Schema Management

`db.js` exports `initDB()` which runs inline schema migrations inside a
transaction. Tables include: `users`, `teams`, `team_members`,
`repo_assignments`, `repo_metadata`, `repo_embeddings`, `community_health_cache`,
`workflow_runs`, `workflows_meta`, `migration_jobs`, `migration_plans`,
`migration_tasks`, `user_subscriptions`, `api_keys`, `audit_log`, and more.

SQL migration files are stored in `server/migrations/` (currently
`001-initial-schema.sql`).

## Configuration

`server/config.js` uses Zod to validate and freeze all environment variables at
startup. The schema covers:

- **Server**: `NODE_ENV`, `PORT` (default 3001)
- **Session**: `SESSION_SECRET` (enforced in production)
- **GitHub OAuth**: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- **Database**: `DATABASE_URL` (optional; SQLite if absent)
- **Redis**: `REDIS_URL` (optional; enables distributed sessions and BullMQ)
- **AI**: `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-2.5-flash`),
  `GEMINI_EMBEDDING_MODEL` (default `text-embedding-004`)
- **Monitoring**: `SENTRY_DSN`
- **Azure DevOps**: `AZURE_PAT`
- **Webhooks**: `WEBHOOK_SECRET`
- **Stripe**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price IDs
- **Mock mode**: `VITE_MOCK_MODE`

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
| `validators.js` | Zod schemas for request input validation |

## Session Store Selection

The server selects a session store in priority order:

1. **Redis** (`REDIS_URL` set) -- distributed sessions for multi-instance
   deployments.
2. **SQLite** (production, no Redis) -- single-instance persistent sessions.
3. **MemoryStore** (development default) -- non-persistent, acceptable for local
   development.

## Tier System

Three subscription tiers control feature access:

| Feature | Free | Pro | Enterprise |
| --- | --- | --- | --- |
| Max repos | 20 | Unlimited | Unlimited |
| AI queries / month | 50 | 500 | Unlimited |
| Migration | -- | Basic | Full |
| Teams | -- | Yes (3 members) | Yes (unlimited) |
| Audit log | -- | -- | Yes + export |
| API keys | 1 | 5 | 20 |
| Semantic search | -- | Yes | Yes |
| SSO | -- | -- | Yes |

## Testing

Backend tests live in `server/__tests__/` (8 test files). The full project test
suite includes 404 tests across 24 test files.

| Test file | Covers |
| --- | --- |
| `auth.test.js` | Auth middleware and webhook verification |
| `credential-encryption.test.js` | AES-256-GCM encrypt/decrypt round-trips |
| `migration-engine.test.js` | Migration plan execution logic |
| `migration-planner.test.js` | Migration plan generation |
| `validators-migration.test.js` | Zod validation for migration inputs |
| `validators.test.js` | General request validation schemas |
| `wiki-service.test.js` | Wiki service operations |
| `work-item-service.test.js` | Azure DevOps work-item integration |

Run backend tests:

```bash
npx vitest run server/__tests__/
```

Run the full test suite:

```bash
npx vitest
```

## Security

- **Session cookies**: `httpOnly`, `sameSite: 'lax'`, `secure` in production, 24-hour expiry.
- **HMAC-SHA256 webhook verification** with timing-safe comparison.
- **Parameterised SQL queries** throughout (no string interpolation).
- **Zod validation** on all config and request inputs.
- **Helmet** for security headers with strict CSP in production.
- **HSTS** with preload in production (2-year max-age).
- **API key hashing** (SHA-256 before storage, never stored in plaintext).
- **Credential encryption** (AES-256-GCM for stored PATs and tokens).
- **Rate limiting** at both global and per-tenant levels.
- **10 KB body limit** to prevent payload abuse.
- **`per_page` cap** (1--100) on all API list endpoints.

---

Last updated: 2026-04-03
