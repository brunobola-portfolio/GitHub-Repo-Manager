# Comprehensive Code Review — Consolidated Plan

**Date**: 2026-04-12
**Reviewers**: 2 Expert Panels (8 specialists total)
**Scope**: Full codebase — Frontend (`src/`) + Backend (`server/`)

---

## Executive Summary

| Area | Findings | Critical | High | Medium | Low |
|------|----------|----------|------|--------|-----|
| **Backend** | 25 | 2 | 4 | 9 | 10 |
| **Frontend** | 22 | 1 | 5 | 10 | 6 |
| **Total** | **47** | **3** | **9** | **19** | **16** |

### Quality Scores (Frontend Panel)

| Area | Score | Notes |
|------|-------|-------|
| React Architecture | 7/10 | Good hooks, but App.jsx monolith |
| UI/UX Quality | 8/10 | Strong modals/responsive, minor a11y gaps |
| CSS/Design System | 8.5/10 | Well-designed opt-in system |
| Performance | 6/10 | App.jsx re-render issues |
| Error Handling | 6/10 | Good centralized system, inconsistently adopted |
| Accessibility | 7.5/10 | Mostly present, MobileDrawer is main gap |

---

## TIER 1 — CRITICAL (Fix Immediately)

### C1. InMemoryQueue Never Executes Jobs
- **Team**: Backend
- **File**: `server/lib/queue.js:8-13`
- **Impact**: Scheduled migrations silently fail when Redis is not configured. The `InMemoryQueue.add()` logs the job and returns a job object but **never calls the processor function**. The `InMemoryWorker` stores the processor but never invokes it.
- **Fix**: In `InMemoryQueue.add()`, look up the worker from `_workers` map and invoke its processor:
  ```js
  async add(jobName, data, _opts = {}) {
      const jobId = `${this.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      logger.info({ queue: this.name, jobName, jobId }, 'Job queued (in-memory)');
      const worker = _workers.get(this.name);
      if (worker?.processor) {
          worker.processor({ id: jobId, name: jobName, data }).catch(err => {
              logger.error({ queue: this.name, jobId, err }, 'In-memory job failed');
          });
      }
      return { id: jobId, name: jobName, data };
  }
  ```
- **Validated**: ✅ Confirmed by reading source

### C2. Webhook Signature Verification Uses Parsed JSON Body
- **Team**: Backend
- **File**: `server/routes/webhooks.js:19` + `server/middleware/auth.js:36-49`
- **Impact**: GitHub signs the **raw** request body. The handler receives `req.body` already parsed by `express.json()`, then `verifyWebhookSignature` re-serializes via `JSON.stringify(payload)`. Key ordering/whitespace differences between original and re-serialized JSON can cause legitimate signatures to fail or allow bypasses.
- **Fix**: Use `express.raw()` for the webhook route, verify against raw buffer, then parse:
  ```js
  router.post('/webhooks/actions', express.raw({ type: 'application/json' }), async (req, res) => {
      const signature = req.headers['x-hub-signature-256'];
      if (!verifyWebhookSignature(req.body, signature)) {
          return errorResponse(res, 401, 'Invalid webhook signature');
      }
      const payload = JSON.parse(req.body);
      // ...
  });
  ```
- **Validated**: ✅ Confirmed — line 42 of auth.js does `JSON.stringify(payload)` on object

### C3. `useDevToolkit` Missing `credentials: 'include'` on Fetch Calls
- **Team**: Frontend
- **Files**: `src/hooks/useDevToolkit.js:44,65,106`
- **Impact**: In non-proxy deployments (production), fetch calls won't send session cookies, causing silent auth failures. The branches/compare/context endpoints all use bare `fetch()`.
- **Fix**: Add `{ credentials: 'include' }` to all three fetch calls.
- **Validated**: ✅ Confirmed by reading source

---

## TIER 2 — HIGH (Fix This Sprint)

### H1. GitHub Token Embedded in Git Push URL
- **Team**: Backend
- **File**: `server/routes/v1/repos-sync.js:29`
- **Impact**: Token exposed in error messages/logs if `simple-git` throws. Line 43 sanitizes errors but may miss edge cases (URL-encoded tokens, partial errors).
- **Fix**: Use git credential helpers or `GIT_ASKPASS` env var instead of URL-embedded tokens.

### H2. Remove Duplicate Audit Logging
- **Team**: Backend
- **Files**: `server/routes/teams.js:91-103,174-184,239-249`, `server/routes/repos.js:193-198`
- **Impact**: Several routes write to both legacy `audit_log` AND `audit_log_v2` (via `auditLog()`), doubling writes and risking data divergence.
- **Fix**: Remove all direct `INSERT INTO audit_log` calls. Use `auditLog()` exclusively.

### H3. Unhandled Promise Rejection in Async Import Operations
- **Team**: Backend
- **File**: `server/routes/import.js:91-127,172-209`
- **Impact**: If DB update inside `.then()`/`.catch()` fails (e.g., DB locked), error is silently swallowed.
- **Fix**: Wrap DB operations inside `.then()` and `.catch()` in their own try/catch with logging.

### H4. `useOrgs` Silently Swallows All Non-Auth Errors
- **Team**: Frontend
- **File**: `src/hooks/useOrgs.js:90-222`
- **Impact**: Network errors, server errors, timeouts — all silently dropped. User sees no feedback when org data fails to load.
- **Fix**: Set error states and surface to UI via toast notifications or inline error messages.

### H5. `useAI.checkAIStatus` Missing Credentials
- **Team**: Frontend
- **File**: `src/hooks/useAI.js:28`
- **Impact**: AI status check fails in non-proxy deployments, causing AI features to appear unavailable.
- **Fix**: Add `credentials: 'include'` to the fetch call.

### H6. `MobileDrawer` Missing Focus Trap
- **Team**: Frontend
- **File**: `src/components/MobileDrawer.jsx`
- **Impact**: Users can Tab out of the drawer into background content, breaking modal interaction pattern. Has `role="dialog"` and `aria-modal="true"` but no actual focus management.
- **Fix**: Add `useFocusTrap(isOpen, onClose)` and `useBodyScrollLock(isOpen)`.

### H7. App.jsx Re-renders Entire Tree on Every State Change
- **Team**: Frontend
- **File**: `src/App.jsx`
- **Impact**: `AppContent` has ~15 `useState` calls + 3 contexts. Any state change triggers full re-render. Inline objects/functions passed as props defeat React's bailout.
- **Fix**: (1) Memoize `sidebarProps` with `useMemo`, (2) Extract `<AppModals>` component, (3) Wrap handlers in `useCallback`, (4) Consider extracting view routing.

### H8. Inconsistent API URL Construction Pattern
- **Team**: Frontend
- **Files**: `src/hooks/useRepos.js`, `useOrgs.js`, `useAI.js`, `useDevToolkit.js`
- **Impact**: 11 occurrences of `API_ENDPOINTS.repos.replace('/repos', '')` hack. Fragile — breaks if endpoint path changes. Other files use `API_BASE_URL` directly or hardcode paths.
- **Fix**: Add `API_BASE` constant to `config.js` and use consistently everywhere.

### H9. Health Check Hardcoded Version
- **Team**: Backend
- **File**: `server/index.js:184`
- **Impact**: Reports `2.5.0` while package.json says `3.0.0`. Misleading for monitoring tools.
- **Fix**: Read version from `package.json` at startup.

---

## TIER 3 — MEDIUM (Fix This Month)

### M1. Credential Encryption Uses Static Salt
- **File**: `server/lib/credential-encryption.js:6`
- **Fix**: Generate random salt per encryption, prepend to ciphertext alongside IV and tag.

### M2. Azure Token Stored Unencrypted in Session
- **File**: `server/routes/azure.js:328`
- **Fix**: Encrypt token before storing, or use in-memory cache with short TTL.

### M3. Client Error Endpoint Has No Rate Limiting
- **File**: `server/routes/system.js:54-67`
- **Fix**: Add specific rate limiter (e.g., 10 req/min/IP).

### M4. Mock Login Disabled Only by NODE_ENV Check
- **File**: `server/routes/auth.js:147-174`
- **Fix**: Use `config.nodeEnv` (Zod-validated) instead of raw `process.env.NODE_ENV`.

### M5. PUT /plans/:id Does Not Actually Update
- **File**: `server/routes/migration.js:109-119`
- **Fix**: Implement actual update logic in `MigrationEngine.updatePlan()`.

### M6. Inconsistent Error Response Shapes (Backend)
- **Files**: Multiple route files
- **Fix**: Standardize to `{ error: 'message', code: 'CODE' }`. Create centralized error factory.

### M7. SSRF Protection Logic Duplicated
- **Files**: `server/import-service.js:41-107`, `server/wiki-service.js:28-89`
- **Fix**: Extract to shared `server/lib/url-validator.js`.

### M8. Community Health Check Makes 7+ Sequential API Calls
- **File**: `server/community-health-service.js:29-46`
- **Fix**: Use `Promise.allSettled` or GitHub's `/repos/{owner}/{repo}/community/profile` endpoint.

### M9. N+1 Query in Organization Listing
- **File**: `server/routes/orgs.js:55-67`
- **Fix**: Add caching for org details or batch with concurrency limit.

### M10. `useRepos.createRepo` Uses Raw Fetch (Bypasses Error Infrastructure)
- **File**: `src/hooks/useRepos.js:450-476`
- **Fix**: Use `fetchWithRetry` with `maxRetries: 0` for non-idempotent calls.

### M11. Inconsistent Frontend Fetch Error Handling
- **Files**: `src/api/ai.js`, `src/api/migration.js`, `src/api/repos.js`, `src/api/teams.js`
- **Fix**: Create unified `apiClient` in `utils/api.js` that all modules use.

### M12. Duplicated Mobile Keyboard Scroll Fix
- **Files**: `src/components/ui/Modal.jsx`, `ConfirmModal.jsx`, `WizardPanel.jsx`
- **Fix**: Extract to `useMobileKeyboardFix(isOpen, ref)` hook.

### M13. Vestigial Selection State in `useRepos`
- **File**: `src/hooks/useRepos.js:88-89,174-177`
- **Fix**: Remove dead `selectedIds` state; `SelectionContext` is the real source of truth.

### M14. `ConfirmModal` Missing AnimatePresence
- **File**: `src/components/ui/ConfirmModal.jsx:55`
- **Fix**: Wrap in Framer Motion `<AnimatePresence>` like `Modal.jsx`.

### M15. `getModalData` Causes Unnecessary Re-renders
- **File**: `src/contexts/ModalContext.jsx:113`
- **Fix**: Use ref for `internalStates` to maintain stable function identity.

### M16. Locale Hardcoded to `pt-PT`
- **File**: `src/utils/format.js:6`
- **Fix**: Detect from `navigator.language` or make configurable via settings.

### M17. Missing Error Boundaries Around Tab Panels
- **File**: `src/App.jsx`
- **Fix**: Add granular `<ErrorBoundary>` wrappers around each tab in RepoDetail, TeamDetails.

### M18. Validate AI Routes with Defined Schemas
- **File**: `server/routes/ai.js:48,297`
- **Fix**: Add `validate(aiChatSchema)` and `validate(aiIndexSchema)` middleware.

### M19. Select Dropdown Has Portuguese Placeholder
- **File**: `src/components/ui/Select.jsx:333`
- **Fix**: Change `"Filtrar..."` to `"Filter..."` or make configurable.

---

## TIER 4 — LOW (Backlog / Fix When Touching)

| # | Issue | File(s) |
|---|-------|---------|
| L1 | Duplicate DB index `idx_team_members_team_id` | `server/db.js:375-386` |
| L2 | Missing pagination on API keys/teams list | `server/routes/api-keys.js`, `teams.js` |
| L3 | POST endpoints return 200 instead of 201 | Multiple route files |
| L4 | Duplicated AI error handling pattern | `server/routes/ai.js` (4+ handlers) |
| L5 | ActionsService duplicated query branches | `server/actions-service.js` |
| L6 | `closeAllQueues()` not called in shutdown | `server/index.js:260-298` |
| L7 | Missing `ON DELETE CASCADE` on migration_jobs FK | `server/db.js:213` |
| L8 | Add index on `audit_log(created_at)` | `server/db.js:275-283` |
| L9 | Safe JSON parsing for API key scopes | `server/middleware/api-key-auth.js:39` |
| L10 | Variable shadowing in AI index route | `server/routes/ai.js:341` |
| L11 | `session.destroy()` missing callback | `server/routes/auth.js:141` |
| L12 | Inconsistent export patterns (named vs default) | All components |
| L13 | `animate-in` classes may not work without plugin | `src/App.jsx`, various |
| L14 | Max-toast limit missing | `src/contexts/ToastProvider.jsx` |
| L15 | `custom-scrollbar` vs `ds-scrollbar` duplication | `src/index.css`, `design-system.css` |
| L16 | `PricingCardHoverLayers` component in hooks dir | `src/hooks/usePricingCardHover.jsx` |

---

## Implementation Phases

### Phase 1: Critical Security & Bug Fixes (1-2 days)
**Tasks**: C1, C2, C3, H1, H5, H9
- Fix InMemoryQueue to actually execute jobs
- Fix webhook signature verification with raw body
- Add missing credentials to all fetch calls
- Remove token from git URLs
- Fix health check version

### Phase 2: Error Handling & Reliability (2-3 days)
**Tasks**: H2, H3, H4, M3, M4, M5, M6, M18
- Remove duplicate audit logging (consolidate on v2)
- Fix unhandled promise rejections in imports
- Add error states to useOrgs
- Rate-limit client-error endpoint
- Fix mock login check, implement PUT /plans/:id
- Standardize error response format + validate AI routes

### Phase 3: Frontend Quality & Performance (2-3 days)
**Tasks**: H6, H7, H8, M10, M11, M12, M13, M14, M15, M19
- Add focus trap to MobileDrawer
- App.jsx performance (memoize, extract modals, useCallback)
- Unify API URL construction with API_BASE constant
- Consolidate fetch patterns across hooks and API modules
- Extract shared hooks (mobile keyboard fix)
- Clean up vestigial state, fix ConfirmModal animations
- Fix Portuguese placeholder

### Phase 4: Security Hardening (1-2 days)
**Tasks**: M1, M2, M7, M8, M9
- Random salt for credential encryption
- Encrypt Azure token in session
- Extract SSRF protection to shared module
- Optimize community health check API calls
- Fix N+1 in org listing

### Phase 5: Code Quality & Polish (ongoing)
**Tasks**: M16, M17, L1-L16
- Locale detection
- Error boundaries per tab
- All backlog items — address when touching related files

---

## Cross-Cutting Concerns

### Pattern: Inconsistent Fetch/API Layer (Frontend)
Both teams flagged this. The frontend has **5 different fetch patterns**:
1. `fetchWithRetry` (utils/api.js) — centralized, with retry + 401 detection
2. `apiCall` (utils/api.js) — wrapper over fetchWithRetry
3. Raw `fetch()` — used in useDevToolkit, useOrgs, useRepos.createRepo
4. `apiFetch` — used in useRepoDetail
5. Custom `fetchJson` — used in api/migration.js

**Recommendation**: Consolidate to `apiCall` as the single entry point. All hooks and API modules should use it.

### Pattern: Dual Audit Logging (Backend)
Legacy `audit_log` table AND new `audit_log_v2` both receive writes. The `auditLog()` helper writes to v2. Direct SQL inserts write to legacy.

**Recommendation**: Remove all direct `INSERT INTO audit_log` calls. Migrate to `auditLog()` exclusively. Plan to drop legacy table after data migration.

### Pattern: API Versioning (/api/ vs /api/v1/)
Backend mounts routes at both `/api/v1` and `/api`. Frontend uses `/api/v1/` in repos.js/repo-actions.js but `/api/` everywhere else.

**Recommendation**: Standardize on `/api/v1/` for all endpoints. Update all frontend API modules. Document deprecation of `/api/` prefix.
