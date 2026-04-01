# Phase 1: SaaS Architecture Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the single-user local app into a multi-tenant SaaS-ready architecture. Add database abstraction (SQLite ↔ PostgreSQL), multi-tenancy, distributed sessions, API versioning, and job queues — without breaking the existing self-hosted experience.

**Spec:** `docs/specs/2026-04-01-platform-transformation-spec.md`

**Tech Stack:** React 19, Express 5, better-sqlite3, pg (PostgreSQL client), ioredis, BullMQ, Zod.

**Prerequisites:** Phase 0 complete.

---

## Parallelism Map

Tasks 1, 2, 3 are independent — run in parallel.
Task 4 depends on Task 1.
Task 5 depends on Tasks 1 + 2.
Task 6 depends on Tasks 1-5.

---

## Task 1: Database Abstraction Layer

**Goal:** Create a database adapter that transparently supports both SQLite (self-hosted) and PostgreSQL (SaaS) based on `DATABASE_URL` environment variable.

**Files:**
- Create: `server/lib/db-adapter.js`
- Create: `server/lib/adapters/sqlite-adapter.js`
- Create: `server/lib/adapters/postgres-adapter.js`
- Modify: `server/db.js` (refactor to use adapter)
- Create: `server/migrations/001-initial-schema.sql`

- [ ] **Step 1.1: Design the adapter interface**

  Read `server/db.js` thoroughly. Document every table, every prepared statement, and every direct `db.` call pattern used across the codebase.

  The adapter must expose:
  ```js
  // Core interface
  adapter.run(sql, params)        // INSERT, UPDATE, DELETE
  adapter.get(sql, params)        // Single row
  adapter.all(sql, params)        // Multiple rows
  adapter.prepare(sql)            // Prepared statement (SQLite pattern)
  adapter.transaction(fn)         // Transactional execution
  adapter.close()                 // Cleanup
  ```

- [ ] **Step 1.2: Create SQLite adapter**

  Create `server/lib/adapters/sqlite-adapter.js` — wraps the existing better-sqlite3 usage. This should be a thin wrapper that maintains backward compatibility with all existing code.

  Key: SQLite uses `?` placeholders and synchronous calls. The adapter should present an async interface even for SQLite (wrapping in Promise.resolve for consistency).

- [ ] **Step 1.3: Create PostgreSQL adapter**

  Create `server/lib/adapters/postgres-adapter.js` — wraps `pg` (node-postgres).

  Key differences to handle:
  - PostgreSQL uses `$1, $2` placeholders instead of `?`
  - PostgreSQL is natively async
  - `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY`
  - `INSERT OR REPLACE` → `INSERT ... ON CONFLICT DO UPDATE`
  - `datetime('now')` → `NOW()`
  - `json()` function → native JSONB
  - Boolean handling: SQLite uses 0/1, PostgreSQL uses true/false

- [ ] **Step 1.4: Create db-adapter.js factory**

  Create `server/lib/db-adapter.js`:

  ```js
  // Selects adapter based on DATABASE_URL
  // - No DATABASE_URL or starts with "sqlite:" → SQLite adapter
  // - Starts with "postgres://" → PostgreSQL adapter

  export function createDatabaseAdapter() {
    const url = process.env.DATABASE_URL;
    if (!url || url.startsWith('sqlite:')) {
      return new SQLiteAdapter(url);
    }
    if (url.startsWith('postgres://')) {
      return new PostgresAdapter(url);
    }
    throw new Error(`Unsupported DATABASE_URL: ${url}`);
  }
  ```

- [ ] **Step 1.5: Create SQL migration file**

  Create `server/migrations/001-initial-schema.sql` with the complete schema in PostgreSQL-compatible SQL. This becomes the source of truth for the database schema.

  Include both SQLite and PostgreSQL variants where syntax differs (using comments or conditional blocks).

- [ ] **Step 1.6: Refactor server/db.js**

  Modify `server/db.js` to:
  1. Import and use `createDatabaseAdapter()`
  2. Keep the same exported interface (so no other files need to change yet)
  3. Run migrations on startup
  4. Maintain backward compatibility — existing SQLite users see zero changes

- [ ] **Step 1.7: Add pg dependency**

  ```bash
  npm install pg
  ```

- [ ] **Step 1.8: Test with SQLite (regression)**

  Run full test suite to confirm nothing breaks with the adapter layer when using SQLite:
  ```bash
  npx vitest run
  ```

- [ ] **Step 1.9: Commit**

  ```
  feat(db): add database abstraction layer supporting SQLite and PostgreSQL
  ```

---

## Task 2: Redis Session Store & Cache

**Goal:** Replace SQLite session store with Redis for distributed deployments while keeping SQLite sessions for self-hosted.

**Files:**
- Create: `server/lib/session-store-redis.js`
- Modify: `server/lib/session-store.js` (add Redis option)
- Modify: `server/index.js` (session config based on REDIS_URL)

- [ ] **Step 2.1: Install dependencies**

  ```bash
  npm install ioredis connect-redis
  ```

- [ ] **Step 2.2: Create Redis session store**

  Create `server/lib/session-store-redis.js`:
  - Use `connect-redis` with `ioredis` client
  - Configure from `REDIS_URL` environment variable
  - TTL matching session maxAge (24h default)
  - Graceful fallback if Redis unavailable

- [ ] **Step 2.3: Update session configuration**

  Read `server/index.js`. Modify session setup:
  - If `REDIS_URL` is set → use Redis store
  - If `NODE_ENV === 'production'` and no Redis → use SQLite store
  - If `NODE_ENV === 'development'` → use MemoryStore

- [ ] **Step 2.4: Add Redis to docker-compose.yml**

  Update `docker-compose.yml` to include a Redis service for the SaaS deployment:

  ```yaml
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped
  ```

  Add `REDIS_URL=redis://redis:6379` to app service environment.

- [ ] **Step 2.5: Test without Redis (self-hosted regression)**

  Verify the app works without Redis (falls back to SQLite/Memory store).

- [ ] **Step 2.6: Commit**

  ```
  feat(sessions): add Redis session store for distributed deployments
  ```

---

## Task 3: Job Queue for Async Operations

**Goal:** Add a job queue (BullMQ) for migrations, AI indexing, and other long-running tasks. Self-hosted mode uses a simple in-process queue.

**Files:**
- Create: `server/lib/queue.js`
- Create: `server/workers/migration-worker.js`
- Create: `server/workers/ai-worker.js`
- Modify: `server/migration-engine.js` (use queue for execution)
- Modify: `server/routes/ai.js` (use queue for batch indexing)

- [ ] **Step 3.1: Install BullMQ**

  ```bash
  npm install bullmq
  ```

- [ ] **Step 3.2: Create queue abstraction**

  Create `server/lib/queue.js`:
  - If `REDIS_URL` is set → use BullMQ with Redis
  - If no Redis → use simple in-memory queue (setTimeout-based, for self-hosted)
  - Export: `addJob(queueName, data, opts)`, `createWorker(queueName, handler)`

- [ ] **Step 3.3: Create migration worker**

  Create `server/workers/migration-worker.js`:
  - Listens to `migration` queue
  - Executes migration tasks from `migration-engine.js`
  - Reports progress via job.updateProgress()
  - Emits SSE events for real-time UI updates

- [ ] **Step 3.4: Create AI worker**

  Create `server/workers/ai-worker.js`:
  - Listens to `ai` queue
  - Handles batch indexing, quality reports, README generation
  - Rate-limits Gemini API calls

- [ ] **Step 3.5: Refactor migration-engine.js**

  Read `server/migration-engine.js`. Modify `executePlan()` to:
  - Add job to queue instead of executing inline
  - Keep inline execution as fallback (no Redis mode)
  - Maintain SSE streaming by bridging job progress → EventEmitter

- [ ] **Step 3.6: Test both modes**

  Test with Redis (BullMQ) and without (in-memory queue).

- [ ] **Step 3.7: Commit**

  ```
  feat(queue): add BullMQ job queue for migrations and AI operations
  ```

---

## Task 4: Multi-Tenancy Support

**Depends on:** Task 1

**Goal:** Add tenant isolation so multiple users' data is separated. Each GitHub user becomes a tenant. Data is isolated at the database level.

**Files:**
- Modify: `server/db.js` (add user_id columns where missing)
- Modify: `server/routes/*.js` (scope all queries by user)
- Create: `server/middleware/tenant.js`

- [ ] **Step 4.1: Audit all tables for user scoping**

  Read `server/db.js`. For each table, determine if it needs a `user_id` column:

  | Table | Has user_id? | Needs it? |
  |-------|-------------|-----------|
  | users | id IS user | No |
  | sessions | implicit | No |
  | teams | owner_id | OK |
  | team_members | user_id | OK |
  | repo_assignments | via team | OK |
  | repo_metadata | No ⚠️ | **YES** |
  | repo_embeddings | No ⚠️ | **YES** |
  | community_health_cache | No ⚠️ | **YES** |
  | workflow_runs | No ⚠️ | **YES** |
  | workflows_meta | No ⚠️ | **YES** |
  | migration_jobs | user_id | OK |
  | migration_plans | user_id | OK |
  | migration_tasks | via plan | OK |
  | audit_log | user_id | OK |
  | system_meta | global | OK (admin only) |

- [ ] **Step 4.2: Add user_id to unscoped tables**

  Add migration `002-multi-tenancy.sql`:
  - Add `user_id INTEGER NOT NULL` to: `repo_metadata`, `repo_embeddings`, `community_health_cache`, `workflow_runs`, `workflows_meta`
  - Add indexes on `user_id` for all these tables
  - For existing data, default user_id to the first user in the users table

- [ ] **Step 4.3: Create tenant middleware**

  Create `server/middleware/tenant.js`:
  ```js
  // Attaches req.tenantId from session
  // All subsequent database queries MUST include WHERE user_id = req.tenantId
  export function requireTenant(req, res, next) {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    req.tenantId = req.session.userId;
    next();
  }
  ```

- [ ] **Step 4.4: Scope all queries by tenant**

  Read every route file in `server/routes/`. For each database query that touches tenant-scoped tables, add `WHERE user_id = ?` with `req.tenantId`.

  This is the largest task — methodically go through:
  - `server/routes/ai.js` — scope repo_metadata, repo_embeddings queries
  - `server/routes/repos.js` — scope workflow_runs, community_health_cache
  - `server/routes/migration.js` — already scoped (verify)
  - `server/routes/teams.js` — already scoped via owner_id (verify)

- [ ] **Step 4.5: Test multi-tenancy isolation**

  Write a test that:
  1. Creates data as User A
  2. Verifies User B cannot see User A's data
  3. Verifies User A can see their own data

- [ ] **Step 4.6: Commit**

  ```
  feat(multi-tenancy): add user_id scoping to all database tables and queries
  ```

---

## Task 5: API Versioning

**Depends on:** Tasks 1 + 2

**Goal:** Add API versioning to support future breaking changes without disrupting existing clients.

**Files:**
- Modify: `server/index.js` (route prefix)
- Create: `server/routes/v1/index.js` (route aggregator)

- [ ] **Step 5.1: Create v1 route aggregator**

  Create `server/routes/v1/index.js` that imports and mounts all existing routes:
  ```js
  import { Router } from 'express';
  import authRoutes from '../auth.js';
  import repoRoutes from '../repos.js';
  // ... all routes

  const router = Router();
  router.use('/auth', authRoutes);
  router.use('/repos', repoRoutes);
  // ...
  export default router;
  ```

- [ ] **Step 5.2: Mount under /api/v1**

  In `server/index.js`, mount the v1 router:
  ```js
  app.use('/api/v1', v1Routes);
  // Keep /api/* as alias for /api/v1/* (backward compat)
  app.use('/api', v1Routes);
  ```

- [ ] **Step 5.3: Update frontend API base URL**

  Read `src/config.js` or wherever API_BASE_URL is defined. Update to use `/api/v1`:
  ```js
  export const API_BASE = '/api/v1';
  ```

  Search all `fetch('/api/` calls and verify they use the config constant.

- [ ] **Step 5.4: Test all endpoints still work**

  Run full test suite. Manually test key flows (login, repo list, AI chat).

- [ ] **Step 5.5: Commit**

  ```
  feat(api): add v1 API versioning with backward compatibility
  ```

---

## Task 6: Environment-Based Configuration

**Depends on:** Tasks 1-5

**Goal:** Centralize all environment-based configuration into a single config module that validates at startup.

**Files:**
- Create: `server/config.js`
- Modify: `server/index.js` (use config)

- [ ] **Step 6.1: Create server config module**

  Create `server/config.js`:
  ```js
  import { z } from 'zod';

  const configSchema = z.object({
    // Required
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
    port: z.coerce.number().default(3001),
    sessionSecret: z.string().min(16),

    // GitHub OAuth
    githubClientId: z.string().min(1),
    githubClientSecret: z.string().min(1),

    // Frontend
    frontendUrl: z.string().url().default('http://localhost:5173'),

    // Optional: Database
    databaseUrl: z.string().optional(), // sqlite:./server/data/manager.db or postgres://...

    // Optional: Redis
    redisUrl: z.string().optional(), // redis://localhost:6379

    // Optional: AI
    geminiApiKey: z.string().optional(),
    geminiModel: z.string().default('gemini-2.5-flash'),

    // Optional: Azure
    azurePat: z.string().optional(),

    // Optional: Webhooks
    webhookSecret: z.string().optional(),
  });

  function loadConfig() {
    const result = configSchema.safeParse({
      nodeEnv: process.env.NODE_ENV,
      port: process.env.PORT,
      sessionSecret: process.env.SESSION_SECRET,
      githubClientId: process.env.GITHUB_CLIENT_ID,
      githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
      frontendUrl: process.env.FRONTEND_URL,
      databaseUrl: process.env.DATABASE_URL,
      redisUrl: process.env.REDIS_URL,
      geminiApiKey: process.env.GEMINI_API_KEY,
      geminiModel: process.env.GEMINI_MODEL,
      azurePat: process.env.AZURE_PAT,
      webhookSecret: process.env.WEBHOOK_SECRET,
    });

    if (!result.success) {
      console.error('Invalid configuration:', result.error.format());
      process.exit(1);
    }

    return result.data;
  }

  export const config = loadConfig();
  ```

- [ ] **Step 6.2: Replace all process.env references**

  Search for `process.env.` across all server files. Replace with `config.propertyName` imports. This ensures:
  - All config is validated at startup (fail fast)
  - No typos in env var names
  - Default values are centralized

- [ ] **Step 6.3: Update .env.example with new variables**

  Add `DATABASE_URL` and `REDIS_URL` to `.env.example`:
  ```env
  # === Database (optional, defaults to SQLite) ===
  # DATABASE_URL=postgres://user:pass@localhost:5432/github_repo_manager
  # DATABASE_URL=sqlite:./server/data/manager.db

  # === Redis (optional, enables distributed sessions & job queues) ===
  # REDIS_URL=redis://localhost:6379
  ```

- [ ] **Step 6.4: Test startup with minimal config**

  Verify the app starts with only required env vars (GitHub OAuth + session secret). All optional features should gracefully degrade.

- [ ] **Step 6.5: Commit**

  ```
  feat(config): centralize environment configuration with Zod validation
  ```

---

## Completion Checklist

- [ ] Database abstraction layer (SQLite ↔ PostgreSQL)
- [ ] Redis session store (with SQLite fallback)
- [ ] BullMQ job queue (with in-memory fallback)
- [ ] Multi-tenancy (user_id scoping on all tables)
- [ ] API versioning (/api/v1/)
- [ ] Centralized config with Zod validation
- [ ] All tests pass
- [ ] Self-hosted mode still works with zero config changes
