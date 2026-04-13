# Comprehensive Code Review — Action Plan

**Date:** 2026-04-13
**Reviewers:** 6 specialized AI expert agents (Security, Backend Architecture, Frontend Architecture, API & Edge Cases, Code Deduplication, Test & Reliability)
**Scope:** Full codebase (~59K lines, 200+ files)
**Total unique issues found:** 78 (after deduplication across experts)

---

## Executive Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 8 | Must-fix before any release |
| High | 22 | Fix in current sprint |
| Medium | 28 | Fix in next 2 sprints |
| Low | 20 | Backlog / tech debt |

The codebase is well-structured overall with good patterns (parameterized SQL, structured logging, session security). The critical issues concentrate in 3 areas: **token handling in repos-sync.js**, **Postgres adapter transactions**, and **error message leakage to clients**. The biggest systemic gap is **test coverage on billing/security code** (0% coverage on 4 security-critical modules).

---

## Phase 1: Critical Security & Data Integrity (8 issues)

> **Priority:** IMMEDIATE — These are exploitable vulnerabilities or data integrity risks.

### 1.1 Token written to disk + shell injection in repos-sync.js
- **File:** `server/routes/v1/repos-sync.js:31`
- **Found by:** Security, API, Backend (3 experts independently flagged this)
- **Problem:** GitHub token interpolated into a shell script on disk. Shell metacharacters in the token = command injection. Token readable on disk between write and cleanup.
- **Fix:** Embed token directly in the push URL (same pattern `import-service.js` already uses):
  ```js
  const targetUrl = `https://x-access-token:${encodeURIComponent(token)}@github.com/${owner}/${repo}.git`
  await pushGit.push(targetUrl, '--mirror')
  ```
  Remove the askpass script entirely.

### 1.2 Raw `err.message` leaked to clients in AI routes
- **File:** `server/routes/ai.js:260` and `server/routes/ai.js:365`
- **Found by:** Backend
- **Problem:** Two catch blocks send `err.message` directly in JSON response, leaking internal details (model names, API key hints, stack traces) in production.
- **Fix:** Replace with `safeError(err, 'Failed to generate README')` and `safeError(err, 'Similarity search failed')`.

### 1.3 PostgreSQL transaction wrapper doesn't pass client to fn
- **File:** `server/lib/adapters/postgres-adapter.js:182`
- **Found by:** Backend
- **Problem:** `fn(...args)` is called without the transaction client. Queries inside `fn` get different pool connections, making the transaction useless. All migration engine, teams, import, and AI routes affected.
- **Fix:** Pass `client` to `fn` so queries run on the same connection:
  ```js
  const result = await fn(client, ...args);
  ```
  This requires updating all callers to accept and use the client parameter when running on Postgres.

### 1.4 SQL interpolation pattern in db.js DDL
- **File:** `server/db.js:27,31`
- **Found by:** Security, Backend
- **Problem:** `PRAGMA table_info(${table})` and `DROP TABLE IF EXISTS ${table}` use string interpolation. Values are currently from a hardcoded array, but the pattern is a maintenance trap — especially with `DROP TABLE`.
- **Fix:** Add an explicit allowlist guard:
  ```js
  const ALLOWED = new Set(['repo_metadata','repo_embeddings','community_health_cache','workflow_runs','workflows_meta']);
  if (!ALLOWED.has(table)) throw new Error(`Unexpected table: ${table}`);
  ```

### 1.5 Unvalidated credentials object in import routes (SSRF bypass risk)
- **File:** `server/routes/import.js:35-44` and `:147`
- **Found by:** Security
- **Problem:** `credentials` from request body passed directly to git operations with zero validation. Crafted token values could attempt SSRF via credential-embedded URLs.
- **Fix:** Add Zod schema validation for credentials:
  ```js
  const credentialsSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('pat'), token: z.string().min(1).max(200).regex(/^[a-zA-Z0-9_\-]+$/) }),
    z.object({ type: z.literal('token'), token: z.string().min(1).max(200).regex(/^[a-zA-Z0-9_\-]+$/) }),
    z.object({ type: z.literal('basic'), username: z.string().max(100), password: z.string().max(200) }),
  ]).optional();
  ```

### 1.6 resumePlan and retryTask send no body but backend requires azurePat
- **File:** `src/api/migration.js:43-44` vs `server/routes/migration.js:200-239`
- **Found by:** API
- **Problem:** Frontend `resumePlan(id)` and `retryTask(id, taskId)` send POST with no body. Backend reads `req.body.azurePat` which will be `null`. Azure migrations that need a PAT will silently fail on resume/retry.
- **Fix:** Add `azurePat` parameter to both frontend calls (mirroring `executePlan`):
  ```js
  resumePlan: (id, { azurePat } = {}) => fetchJson(`.../${id}/resume`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ azurePat: azurePat || null })
  }),
  ```

### 1.7 Credential encryption key reuse with session secret
- **File:** `server/lib/credential-encryption.js:10-13`
- **Found by:** Security
- **Problem:** `SESSION_SECRET` is used both for session cookies AND to derive AES-256-GCM keys for stored credentials. Rotating one invalidates the other; compromising one exposes the other.
- **Fix:** Add domain separation to the KDF:
  ```js
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.SESSION_SECRET
  const context = Buffer.from('grm-credential-v1')
  return crypto.pbkdf2Sync(Buffer.concat([context, Buffer.from(secret)]), salt, ITERATIONS, KEY_LENGTH, 'sha256')
  ```

### 1.8 ETag cache keyed by URL only — cross-user data leakage
- **File:** `server/lib/github-api.js` (ETag cache)
- **Found by:** Security
- **Problem:** In-memory ETag cache is keyed by GitHub API URL, not `(userId, url)`. User B can receive User A's cached private repo data.
- **Fix:** Key cache by `${userId}:${url}` or disable ETag caching for multi-user deployments.

---

## Phase 2: High-Priority Bugs & Architecture (22 issues)

> **Priority:** Current sprint — real bugs or significant architecture problems.

### 2.1 Security & Auth

| # | Issue | File | Fix |
|---|-------|------|-----|
| 2.1.1 | Azure OAuth callback missing session regeneration | `server/routes/azure.js:330` | Add `req.session.regenerate()` after storing Azure token (matching GitHub flow) |
| 2.1.2 | `safeError` reads raw `process.env.NODE_ENV` | `server/middleware/auth.js:61` | Import `config` and use `config.nodeEnv`, or normalize with `.toLowerCase()` |
| 2.1.3 | Session secret minimum 16 misaligned with target 32 | `server/config.js:11` | Change Zod min to 32; add `.env.example` default to sentinel blocklist |
| 2.1.4 | `clearCookie` in logout missing matching options | `server/routes/auth.js:146` | Add `httpOnly`, `sameSite`, `secure`, `path` to match session cookie config |

### 2.2 Backend Bugs

| # | Issue | File | Fix |
|---|-------|------|-----|
| 2.2.1 | `resolvePat()` called without `session` argument | `server/routes/import.js:49,349,494,557` | Pass `req.session` as second argument |
| 2.2.2 | Audit route: no try/catch, no limit bounds, no date validation | `server/routes/audit.js:8-35` | Wrap in try/catch, clamp limit to 200, validate dates as ISO |
| 2.2.3 | bulk.js writes to old `audit_log` table instead of `audit_log_v2` | `server/routes/bulk.js:54,188,278,319` | Replace raw INSERTs with `auditLog()` helper |
| 2.2.4 | Migration double-execute race condition | `server/routes/migration.js:150-173` | Atomic status update: `UPDATE ... WHERE status='draft'`, return 409 if no change |
| 2.2.5 | `engine.destroy()` never called during graceful shutdown | `server/index.js` shutdown handler | Call `engine.destroy()` before `db.close()` |
| 2.2.6 | AI README route bypasses model factory pattern | `server/routes/ai.js:252` | Use `req.genAI.getGenerativeModel()` instead of `aiService.model` |
| 2.2.7 | Stripe webhook tier not validated against known tiers | `server/routes/stripe-webhooks.js:27-34` | Validate `session.metadata.tier` against `['pro', 'enterprise']` |
| 2.2.8 | `pino/file` transport in dev instead of `pino-pretty` | `server/lib/logger.js:12-26` | Change to `pino-pretty` transport (add as devDependency) |
| 2.2.9 | `ai-worker.js` calls nonexistent `aiService.indexRepository()` | `server/workers/ai-worker.js:10-17` | Fix method name or mark worker as dead code and remove |

### 2.3 Frontend Bugs

| # | Issue | File | Fix |
|---|-------|------|-----|
| 2.3.1 | DiffRenderer dark mode read not reactive | `src/components/PRReview/DiffPanel/DiffRenderer.jsx:78` | Use `useTheme()` hook instead of DOM read |
| 2.3.2 | `window.confirm`/`window.alert` in PR review | `src/components/PRReview/PRReviewView.jsx:131,144` | Replace with `ConfirmModal` and `toast.error()` |
| 2.3.3 | 6 RepoDetail tabs suppress exhaustive-deps with stale closures | `IssuesTab`, `BranchesTab`, `PullRequestsTab`, `ReleasesTab`, `OverviewTab`, `ActionsTab` | Wrap loaders in `useCallback`, add to deps, remove eslint-disable |
| 2.3.4 | `useReviewData` bypasses shared error handling | `src/components/PRReview/hooks/useReviewData.js:79-112` | Replace raw `fetch` with `fetchWithRetry` from `src/utils/api.js` |
| 2.3.5 | `useOrgs` error timer ref not cleaned on unmount | `src/hooks/useOrgs.js:62-66` | Add `useEffect(() => () => clearTimeout(errorTimerRef.current), [])` |

### 2.4 API Consistency

| # | Issue | File | Fix |
|---|-------|------|-----|
| 2.4.1 | Unvalidated `page`/`per_page` in GitHub URL construction | `server/routes/repos.js:76-78`, `orgs.js:125-127` | Use `parseInt` + `clampPerPage` before interpolation |
| 2.4.2 | `useSSE` reconnects indefinitely on 401/403 | `src/hooks/useSSE.js:40-52` | Add max-attempts cap (5 retries), expose error state |
| 2.4.3 | API key auth doesn't set `accessToken` — GitHub proxy fails | `server/middleware/api-key-auth.js:35-43` | Document limitation or store GitHub token reference with API key |

---

## Phase 3: Medium-Priority Improvements (28 issues)

> **Priority:** Next 2 sprints — reliability, consistency, edge cases.

### 3.1 Security Hardening

| # | Issue | File |
|---|-------|------|
| 3.1.1 | OAuth state uses `!==` instead of `timingSafeEqual` | `server/routes/auth.js:36`, `azure.js:309` |
| 3.1.2 | Raw `X-Forwarded-For` in audit log (IP spoofing) | `server/lib/audit.js:15` — remove fallback, trust only `req.ip` |
| 3.1.3 | Unverified JWT tier on cold start | `server/middleware/require-tier.js:63-74` — default to `free` |
| 3.1.4 | IDOR plan enumeration via 403 vs 404 | `server/routes/migration.js` — add `AND user_id=?` to queries |
| 3.1.5 | Activity cache not tenant-scoped | `server/routes/v1/index.js:63-134` — add userId to cache key |

### 3.2 Error Handling & Reliability

| # | Issue | File |
|---|-------|------|
| 3.2.1 | In-memory queue has no retry logic | `server/lib/queue.js` |
| 3.2.2 | `batch-index` worker: one repo failure kills entire batch | `server/workers/ai-worker.js:13-18` |
| 3.2.3 | `community-health-service` silently swallows errors | `server/community-health-service.js:55-60` |
| 3.2.4 | Migration engine polling loop CPU waste | `server/migration-engine.js:314-338` — use `Promise.race` |
| 3.2.5 | `batch-index` usage accounting: 1 credit for 10 repos | `server/routes/ai.js:611-699` |
| 3.2.6 | `getStripe()` can return null silently | `server/lib/stripe.js` |
| 3.2.7 | 67 occurrences of `console.log/warn/error` instead of `logger` | Multiple server files |
| 3.2.8 | `requireTier('free')` on repos-export is a no-op | `server/routes/v1/repos-export.js:9` |
| 3.2.9 | `import.js` uses module-level logger instead of `req.log` | `server/routes/import.js` |

### 3.3 Frontend Quality

| # | Issue | File |
|---|-------|------|
| 3.3.1 | `availableLanguages` not memoized in RepoList | `src/components/RepoList.jsx:52` |
| 3.3.2 | `AIReviewStep` stale closure on `[]` deps | `src/components/MigrationWizard/steps/AIReviewStep.jsx:729` |
| 3.3.3 | `App.jsx` handlers not wrapped in `useCallback` | `src/App.jsx:306-428` |
| 3.3.4 | AIAssistant missing `role="dialog"`, focus trap | `src/components/AIAssistant.jsx:136-277` |
| 3.3.5 | PRReviewView loading states use `h-screen` inside padded layout | `src/components/PRReview/PRReviewView.jsx:169-193` |
| 3.3.6 | `useDevToolkit.fetchBranches` stale closure on `baseBranch` | `src/hooks/useDevToolkit.js:53` |
| 3.3.7 | `useAzureOrganizations` retry after unmount | `src/hooks/useAzureOrganizations.js:60-78` |
| 3.3.8 | `useStreaming` missing `credentials: 'include'` | `src/hooks/useStreaming.js:24` |
| 3.3.9 | `useReviewState` may leave stale comments in localStorage | `src/components/PRReview/hooks/useReviewState.js:172-195` |

### 3.4 API Consistency

| # | Issue | File |
|---|-------|------|
| 3.4.1 | Response format inconsistency across all routes | Multiple — see response envelope table below |
| 3.4.2 | `POST /migration/analyze` no per-repo validation | `server/routes/migration.js:247-258` |
| 3.4.3 | `postgres-adapter.prepare()` computes `_pgSql` but never uses it | `server/lib/adapters/postgres-adapter.js:150-165` |
| 3.4.4 | `feature-flags` silent fallback to free for unknown tiers | `server/lib/feature-flags.js:37` |

### Response Envelope Inconsistency (reference table)

| Endpoint | Current shape | Target |
|----------|---------------|--------|
| `GET /api/repos` | `{ repos, page, totalPages }` | `{ data, meta: { page, totalPages } }` |
| `GET /api/repos/:owner/:repo` | bare object | `{ data }` |
| `GET /api/repos/:owner/:repo/branches` | bare array | `{ data }` |
| `GET /api/orgs` | bare array | `{ data }` |
| `GET /api/orgs/:org/repos` | `{ repos, page, totalPages, org }` | `{ data, meta }` |
| `GET /api/audit` | `{ entries, total, page, limit }` | `{ data, meta }` |
| `GET /api/migration/plans` | `{ plans, total, page, perPage }` | `{ data, meta }` |

> Note: Unifying the response envelope is a breaking change for any external consumers. Prioritize only if the v1 API is the public-facing contract.

---

## Phase 4: Code Uniformization & Deduplication (12 issues)

> **Priority:** Next sprint — reduce maintenance burden, improve consistency.

### 4.1 Fetch/API Layer Consolidation

| # | Issue | Action |
|---|-------|--------|
| 4.1.1 | 3 ad-hoc fetch helpers coexist with `apiCall`/`fetchWithRetry` | Replace `src/api/migration.js:fetchJson`, `src/hooks/useRepoDetail.js:apiFetch`, raw fetch in `repos.js`/`repo-actions.js` with `apiCall()` from `src/utils/api.js` |
| 4.1.2 | `REPO_MANAGER_API` duplicated in `ai.js` and `teams.js` | Import `API_BASE` from `src/config.js` instead |
| 4.1.3 | `clampPerPage` duplicated / inlined across 4 route files | Extract to `server/lib/utils.js`, import everywhere |

### 4.2 Validation Consistency

| # | Issue | Action |
|---|-------|--------|
| 4.2.1 | Azure org validation diverges from GitHub username validation | Unify under a single `isValidOrgName()` in `middleware/auth.js` |
| 4.2.2 | `importSchema`/`azureImportSchema` defined in validators.js but never used | Apply via `validate()` middleware on import routes |
| 4.2.3 | `repos.js` param validators use inconsistent error format | Use `errorResponse()` for all param validators |

### 4.3 Dead Code & Barrel Files

| # | Issue | Action |
|---|-------|--------|
| 4.3.1 | `src/components/ui/index.js` exports only 10 of 18 components | Complete the barrel or remove it |
| 4.3.2 | `setPerPage` exported from `useRepos`/`useGitHub` but never consumed | Remove dead export |
| 4.3.3 | `useMobileBreakpoint` overlaps `useResponsiveLayout` | Merge into single hook |
| 4.3.4 | `setUser`/`setAuthMessage` exported from `useAuth` but unreachable | Remove from return value |
| 4.3.5 | `useGitHub` dual `MOCK_MODE`/`isMockMode` export | Remove duplicate |
| 4.3.6 | Portuguese error message in `useAzureOrganizations.js:67` | Translate to English |

---

## Phase 5: Test Coverage (Critical Gaps)

> **Priority:** Parallel with Phases 1-3 — write tests as you fix bugs.

### 5.1 Critical — Zero-Coverage Security/Billing Code

| File | Risk | Tests to write |
|------|------|---------------|
| `server/middleware/api-key-auth.js` | Auth bypass | Revoked keys, expired keys, scope enforcement, malformed scopes |
| `server/routes/stripe-webhooks.js` | Revenue loss | All 5 event types, missing userId, invalid signature |
| `server/routes/billing.js` | Checkout broken | Checkout creation, portal session, missing priceId |
| `server/lib/url-validator.js` | SSRF bypass | RFC 1918 ranges, cloud metadata, IPv6 private, invalid URLs |

### 5.2 High — Untested Production-Critical Code

| File | Risk | Tests to write |
|------|------|---------------|
| `server/routes/bulk.js` | Destructive ops | Partial failure handling, empty array, validation |
| `server/routes/auth.js` (OAuth callback) | Auth bypass | Invalid state, token exchange failure, session regeneration |
| `server/lib/usage-meter.js` | Billing accuracy | Increment, concurrent access, Infinity limit, period boundaries |
| `server/lib/audit.js` | Audit integrity | Normal write, DB failure, null fields, serialization |
| `server/middleware/tenant.js` | Multi-tenancy | Missing userId, tenantId assignment |
| `src/utils/statsAggregator.js` | Dashboard crashes | Empty input, missing fields, single repo |

### 5.3 E2E Coverage Gaps

| Missing flow | Test file to create |
|-------------|-------------------|
| Settings page (API keys, license, audit viewer) | `e2e/settings.spec.js` |
| Billing flow (pricing CTA -> checkout) | `e2e/pricing-checkout.spec.js` |
| Repo detail (tabs, PR review) | `e2e/repo-detail.spec.js` |
| Migration wizard (full flow) | Fix `e2e/migration-wizard.spec.js` (currently only tests keyboard shortcut) |
| Migration history | Fix `e2e/migration-history.spec.js` (currently tautological — only checks title) |

### 5.4 Test Infrastructure

| Issue | Fix |
|-------|-----|
| `localStorage` mock leaks between tests | Add `beforeEach(() => localStorage.clear())` in `tests/setup.js` |
| Playwright: no `stderr: 'pipe'` | Add to `webServer` config in `playwright.config.js` |
| `auth.test.js` uses CJS `require('crypto')` in ESM | Replace with `import { createHmac } from 'crypto'` |
| Coverage thresholds not enforced in CI | Ensure `vitest run --coverage` blocks build on threshold breach |

---

## Implementation Order (Recommended)

```
Week 1: Phase 1 (Critical) + Phase 5.1 (Critical test gaps)
         ├── 1.1 repos-sync.js token fix
         ├── 1.2 AI routes safeError
         ├── 1.3 Postgres transaction fix
         ├── 1.4 db.js allowlist
         ├── 1.5 Import credentials validation
         ├── 1.6 Migration resume/retry body
         ├── 1.7 Credential encryption domain separation
         ├── 1.8 ETag cache per-user
         └── Write tests for api-key-auth, stripe-webhooks, billing, url-validator

Week 2: Phase 2.1-2.2 (Security & Backend High) + Phase 5.2
         ├── Auth hardening (2.1.1-2.1.4)
         ├── Backend bugs (2.2.1-2.2.9)
         └── Write tests for bulk, auth callback, usage-meter, audit

Week 3: Phase 2.3-2.4 (Frontend High + API) + Phase 4
         ├── Frontend bug fixes (2.3.1-2.3.5)
         ├── API consistency fixes (2.4.1-2.4.3)
         └── Code deduplication (4.1-4.3)

Week 4: Phase 3 (Medium) + Phase 5.3-5.4
         ├── Security hardening (3.1)
         ├── Error handling (3.2)
         ├── Frontend quality (3.3)
         ├── E2E test gaps
         └── Test infrastructure fixes
```

---

## Validation Notes

All critical and high issues were independently verified against source code by the consolidation reviewer. The following expert findings were **confirmed as duplicates** and merged:

- Token-to-disk issue: flagged by Security, API, and Backend experts (3x) → merged into 1.1
- SQL interpolation in db.js: flagged by Security and Backend (2x) → merged into 1.4
- Audit route unbounded limit: flagged by Security, API, and Backend (3x) → merged into 2.2.2
- bulk.js wrong audit table: flagged by API and Deduplication (2x) → merged into 2.2.3

**False positive check:** The Postgres transaction issue (1.3) was verified — `fn(...args)` indeed does not receive `client`. The `resumePlan` issue (1.6) was verified — no body sent. The `err.message` leak (1.2) was verified at exact line numbers.
