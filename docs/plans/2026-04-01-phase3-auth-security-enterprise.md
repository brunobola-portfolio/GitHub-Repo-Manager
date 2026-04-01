# Phase 3: Authentication, Security & Enterprise Features

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden authentication for multi-tenant SaaS. Add API key system, enhanced audit logging, rate limiting per tenant, and prepare enterprise features (SSO/SAML).

**Spec:** `docs/specs/2026-04-01-platform-transformation-spec.md`

**Tech Stack:** Express 5, Zod, ioredis, jose (JWT), Passport.js.

**Prerequisites:** Phase 2 complete (deployed on Railway + Vercel).

---

## Parallelism Map

Tasks 1, 2, 3 are independent — run in parallel.
Task 4 depends on Task 1.
Task 5 depends on Tasks 1 + 2 + 3.

---

## Task 1: API Key Authentication

**Goal:** Allow users to generate API keys for programmatic access (CI/CD integrations, scripts, third-party tools).

**Files:**
- Create: `server/routes/api-keys.js`
- Create: `server/middleware/api-key-auth.js`
- Modify: `server/db.js` (add api_keys table)
- Modify: `server/middleware/auth.js` (support API key + session auth)
- Create: `src/components/Settings/ApiKeysSection.jsx`

- [ ] **Step 1.1: Add api_keys table**

  Add migration `003-api-keys.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT '["read"]',
    last_used_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT,
    UNIQUE(key_hash)
  );
  CREATE INDEX idx_api_keys_user ON api_keys(user_id);
  CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
  ```

  Scopes: `read` (list repos, view data), `write` (create repos, modify settings), `admin` (team management, billing), `ai` (AI features).

- [ ] **Step 1.2: Create API key generation route**

  Create `server/routes/api-keys.js`:

  - `POST /api/v1/api-keys` — Generate new key
    - Generate 32-byte random key: `grm_live_` + base62 encoding
    - Store SHA-256 hash (never store plaintext)
    - Store prefix (first 8 chars) for identification
    - Return plaintext key ONCE (user must save it)
    - Accept: `name`, `scopes[]`, `expires_at` (optional)

  - `GET /api/v1/api-keys` — List user's keys (prefix only, no secrets)
  - `DELETE /api/v1/api-keys/:id` — Revoke key (soft delete: set revoked_at)

- [ ] **Step 1.3: Create API key authentication middleware**

  Create `server/middleware/api-key-auth.js`:
  ```js
  // Checks Authorization: Bearer grm_live_...
  // Hashes the key, looks up in api_keys table
  // Verifies not revoked, not expired
  // Attaches req.userId, req.scopes, req.apiKeyId
  // Updates last_used_at
  ```

- [ ] **Step 1.4: Update auth middleware to support both methods**

  Read `server/middleware/auth.js`. Modify `requireAuth` to:
  1. First check for session authentication (existing flow)
  2. If no session, check for `Authorization: Bearer grm_live_...` header
  3. If API key found, validate and attach user context
  4. If neither, return 401

- [ ] **Step 1.5: Add scope checking middleware**

  ```js
  export function requireScope(scope) {
    return (req, res, next) => {
      // Session auth has all scopes
      if (req.session?.userId) return next();
      // API key auth checks scopes
      if (req.scopes?.includes(scope) || req.scopes?.includes('admin')) return next();
      return res.status(403).json({ error: 'Insufficient permissions' });
    };
  }
  ```

- [ ] **Step 1.6: Create frontend API Keys management UI**

  Create `src/components/Settings/ApiKeysSection.jsx`:
  - List existing keys (name, prefix, scopes, last used, created, status)
  - Create new key form (name, scopes checkboxes, expiry)
  - Show generated key once with copy button (warn: won't be shown again)
  - Revoke key button with confirmation

- [ ] **Step 1.7: Commit**

  ```
  feat(auth): add API key authentication with scoped permissions
  ```

---

## Task 2: Enhanced Audit Logging

**Goal:** Track all significant actions for compliance and debugging. Searchable, exportable audit trail.

**Files:**
- Modify: `server/db.js` (enhance audit_log table)
- Create: `server/lib/audit.js`
- Create: `server/routes/audit.js`
- Modify: Various route files (add audit calls)
- Create: `src/components/Settings/AuditLogSection.jsx`

- [ ] **Step 2.1: Enhance audit_log table**

  Add migration `004-audit-log-enhanced.sql`:
  ```sql
  -- Drop and recreate with more fields
  CREATE TABLE IF NOT EXISTS audit_log_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    details TEXT,
    ip_address TEXT,
    user_agent TEXT,
    api_key_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_audit_user ON audit_log_v2(user_id);
  CREATE INDEX idx_audit_action ON audit_log_v2(action);
  CREATE INDEX idx_audit_resource ON audit_log_v2(resource_type, resource_id);
  CREATE INDEX idx_audit_created ON audit_log_v2(created_at);
  ```

  Actions to track:
  - `repo.create`, `repo.delete`, `repo.archive`, `repo.transfer`, `repo.visibility_change`
  - `team.create`, `team.delete`, `team.member_add`, `team.member_remove`
  - `migration.create`, `migration.execute`, `migration.cancel`
  - `api_key.create`, `api_key.revoke`
  - `auth.login`, `auth.logout`
  - `ai.analyze`, `ai.generate_readme`, `ai.quality_report`
  - `settings.update`

- [ ] **Step 2.2: Create audit library**

  Create `server/lib/audit.js`:
  ```js
  export function auditLog(req, action, resourceType, resourceId, details = {}) {
    const entry = {
      user_id: req.tenantId || req.session?.userId,
      action,
      resource_type: resourceType,
      resource_id: String(resourceId),
      details: JSON.stringify(details),
      ip_address: req.ip || req.headers['x-forwarded-for'],
      user_agent: req.headers['user-agent'],
      api_key_id: req.apiKeyId || null,
    };
    // Insert async (fire-and-forget, don't block the request)
    db.run(`INSERT INTO audit_log_v2 (...) VALUES (...)`, entry);
  }
  ```

- [ ] **Step 2.3: Create audit routes**

  Create `server/routes/audit.js`:
  - `GET /api/v1/audit` — List audit entries (paginated, filterable by action, resource, date range)
  - `GET /api/v1/audit/export` — Export as CSV (enterprise feature)

- [ ] **Step 2.4: Add audit calls to existing routes**

  Methodically add `auditLog()` calls to all destructive/significant operations across:
  - `server/routes/repos.js` — delete, archive, transfer, visibility change
  - `server/routes/teams.js` — create, delete, member changes
  - `server/routes/migration.js` — create, execute, cancel
  - `server/routes/auth.js` — login, logout
  - `server/routes/api-keys.js` — create, revoke

- [ ] **Step 2.5: Create frontend Audit Log viewer**

  Create `src/components/Settings/AuditLogSection.jsx`:
  - Filterable table with action, user, resource, date
  - Date range picker
  - Action type filter
  - Pagination
  - Export button (enterprise feature gated)

- [ ] **Step 2.6: Commit**

  ```
  feat(audit): add comprehensive audit logging with searchable UI
  ```

---

## Task 3: Per-Tenant Rate Limiting

**Goal:** Replace global rate limiting with per-user/per-tenant limits backed by Redis.

**Files:**
- Create: `server/middleware/tenant-rate-limit.js`
- Modify: `server/index.js` (replace global rate limiter)

- [ ] **Step 3.1: Create tenant rate limiter**

  Create `server/middleware/tenant-rate-limit.js`:

  If Redis available:
  ```js
  // Use express-rate-limit with RedisStore
  import { RedisStore } from 'rate-limit-redis';
  // Key: `rl:${tenantId}:${endpoint}`
  // Limits per tier:
  //   Free: 100 req/15min API, 10 req/min AI
  //   Pro: 500 req/15min API, 50 req/min AI
  //   Enterprise: 2000 req/15min API, 200 req/min AI
  ```

  If no Redis:
  ```js
  // Fall back to existing in-memory rate limiter (self-hosted)
  ```

- [ ] **Step 3.2: Create tier-aware limiter**

  The rate limiter should check the user's subscription tier (from database or cache) and apply the appropriate limits:

  ```js
  export function createTenantRateLimiter(options = {}) {
    return async (req, res, next) => {
      const tier = await getUserTier(req.tenantId); // 'free' | 'pro' | 'enterprise'
      const limit = TIER_LIMITS[tier][options.type || 'api'];
      // Apply limit
    };
  }
  ```

- [ ] **Step 3.3: Install rate-limit-redis**

  ```bash
  npm install rate-limit-redis
  ```

- [ ] **Step 3.4: Replace rate limiters in server/index.js**

  Read `server/index.js`. Replace the global `apiLimiter` and `authLimiter` with tenant-aware versions. Keep the global limiter as a safety net for unauthenticated requests.

- [ ] **Step 3.5: Add rate limit headers**

  Ensure all responses include:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset`

- [ ] **Step 3.6: Commit**

  ```
  feat(rate-limit): add per-tenant rate limiting with Redis backing
  ```

---

## Task 4: User Tier & Subscription Model

**Depends on:** Task 1

**Goal:** Add a user tier system (free/pro/enterprise) that gates features and limits.

**Files:**
- Modify: `server/db.js` (add user_subscriptions table)
- Create: `server/lib/feature-flags.js`
- Create: `server/middleware/require-tier.js`

- [ ] **Step 4.1: Add subscription table**

  Add migration `005-subscriptions.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS user_subscriptions (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    tier TEXT NOT NULL DEFAULT 'free',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    current_period_start TEXT,
    current_period_end TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ```

- [ ] **Step 4.2: Create feature flags module**

  Create `server/lib/feature-flags.js`:
  ```js
  const TIER_FEATURES = {
    free: {
      maxRepos: 20,
      aiQueriesPerMonth: 50,
      migration: false,
      teams: false,
      auditLog: false,
      apiKeys: 1,
      semanticSearch: false,
    },
    pro: {
      maxRepos: Infinity,
      aiQueriesPerMonth: 500,
      migration: 'basic', // GitHub only
      teams: true,
      teamMembersMax: 3,
      auditLog: false,
      apiKeys: 5,
      semanticSearch: true,
    },
    enterprise: {
      maxRepos: Infinity,
      aiQueriesPerMonth: Infinity,
      migration: 'full', // Azure + GitHub + GitLab
      teams: true,
      teamMembersMax: Infinity,
      auditLog: true,
      auditExport: true,
      apiKeys: 20,
      semanticSearch: true,
      sso: true,
    },
  };

  export function getFeatures(tier) {
    return TIER_FEATURES[tier] || TIER_FEATURES.free;
  }

  export function canAccess(tier, feature) {
    const features = getFeatures(tier);
    return !!features[feature];
  }
  ```

- [ ] **Step 4.3: Create tier middleware**

  Create `server/middleware/require-tier.js`:
  ```js
  export function requireTier(minTier) {
    const tierOrder = { free: 0, pro: 1, enterprise: 2 };
    return async (req, res, next) => {
      const userTier = await getUserTier(req.tenantId);
      if (tierOrder[userTier] >= tierOrder[minTier]) return next();
      return res.status(403).json({
        error: 'upgrade_required',
        message: `This feature requires the ${minTier} plan`,
        currentTier: userTier,
        requiredTier: minTier,
      });
    };
  }
  ```

- [ ] **Step 4.4: Apply tier gating to routes**

  Add `requireTier()` middleware to:
  - Migration routes → `requireTier('pro')`
  - Team routes → `requireTier('pro')`
  - AI batch indexing → `requireTier('pro')`
  - Audit log export → `requireTier('enterprise')`
  - SSO config → `requireTier('enterprise')`

  Keep FREE tier access to:
  - Dashboard, repo list, repo detail
  - Basic AI (chat, analyze — rate limited)
  - Settings, API keys (1 key)

- [ ] **Step 4.5: Add upgrade prompts in frontend**

  When the API returns `403 upgrade_required`, show a modal or inline message:
  - Current tier
  - Feature that requires upgrade
  - "Upgrade to Pro" / "Upgrade to Enterprise" buttons
  - Link to pricing page

- [ ] **Step 4.6: Commit**

  ```
  feat(tiers): add subscription tiers with feature gating
  ```

---

## Task 5: Security Hardening

**Depends on:** Tasks 1 + 2 + 3

**Files:**
- Modify: `server/index.js` (HSTS, additional headers)
- Modify: `server/lib/credential-encryption.js` (key versioning)
- Create: `server/middleware/security.js`

- [ ] **Step 5.1: Add HSTS and additional security headers**

  Read `server/index.js`. Enhance Helmet configuration:
  ```js
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind needs inline styles
        imgSrc: ["'self'", "https://avatars.githubusercontent.com", "data:"],
        connectSrc: ["'self'", config.frontendUrl],
      },
    },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  }));
  ```

- [ ] **Step 5.2: Add request ID middleware**

  Create `server/middleware/security.js`:
  ```js
  import crypto from 'crypto';

  export function requestId(req, res, next) {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-ID', req.id);
    next();
  }
  ```

  Useful for correlating logs, errors, and audit entries.

- [ ] **Step 5.3: Improve credential encryption with key versioning**

  Read `server/lib/credential-encryption.js`. Add:
  - Key version prefix in encrypted payload
  - Support decrypting with old keys during rotation
  - Environment variable: `ENCRYPTION_KEY` (separate from SESSION_SECRET)

- [ ] **Step 5.4: Add CORS strictness for production**

  Ensure CORS only allows the exact frontend domain in production (no wildcards):
  ```js
  cors({
    origin: config.nodeEnv === 'production'
      ? config.frontendUrl
      : true, // Allow all in development
    credentials: true,
  })
  ```

- [ ] **Step 5.5: Commit**

  ```
  feat(security): harden CSP, HSTS, request IDs, and credential encryption
  ```

---

## Completion Checklist

- [ ] API key authentication with scoped permissions
- [ ] Comprehensive audit logging with UI
- [ ] Per-tenant rate limiting (Redis-backed)
- [ ] Subscription tier system (free/pro/enterprise)
- [ ] Feature gating middleware
- [ ] Frontend upgrade prompts
- [ ] HSTS, CSP, request IDs
- [ ] Key versioning for credential encryption
- [ ] All tests pass
