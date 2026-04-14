# Eight-Specialist Audit & Implementation Plan

**Date:** 2026-04-13
**Status:** Draft — awaiting prioritisation
**Methodology:** Parallel audit by 8 specialist agents → main-thread validation against actual code → consolidated, prioritised plan

---

## 1. Executive Summary

Eight specialist sub-agents reviewed the codebase in parallel, each scoped to a single domain. The main thread then **validated every CRITICAL/HIGH claim against the live code** before promoting it into this plan. Several specialist findings turned out to be wrong (see §3) and have been removed.

### Net result: **38 confirmed actions** grouped into 4 phases.

| Phase | Theme | Confirmed items | Effort | When |
|---|---|---|---|---|
| **P0** | Security & legal must-fix | 6 | ~1.5 days | This sprint |
| **P1** | Correctness & monetization integrity | 9 | ~3 days | Next sprint |
| **P2** | Code quality, duplication, performance | 13 | ~5 days | Following sprint |
| **P3** | UI/UX polish, a11y, DX, docs | 10 | ~3 days | Background |

---

## 2. Methodology

### Specialists dispatched
1. **Code Duplication & Dead Code** — Explore agent
2. **Backend Security** — Explore agent
3. **Backend Performance & Architecture** — Explore agent
4. **Frontend React Code Quality** — Explore agent
5. **UI/UX Design Review** — Explore agent
6. **Licensing, Monetization & Billing** — Explore agent
7. **Testing Coverage & Reliability** — Explore agent
8. **Documentation, DX & Dependency Hygiene** — Explore agent

Each returned 8–15 severity-tagged findings (`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`) with `file:line` references.

### Validation step

Every CRITICAL and most HIGH items were independently re-checked by the main thread against:
- The actual source files (Read tool)
- `git ls-files` for "this file is committed" claims
- `.gitignore` entries
- `Grep` for "this code does/doesn't exist" claims
- WebSearch + FSF docs for AGPL §13 interpretation

This caught **6 false positives** that were demoted or removed (see §3).

---

## 3. Validation Notes — Rejected / Demoted Specialist Claims

These were flagged as CRITICAL/HIGH but **do not reflect reality**. Recording them so future audits don't re-raise them:

| Claim | Reality |
|---|---|
| ".env contains live production keys, exposed in git" | `.env` is gitignored at [.gitignore:35](../../.gitignore#L35); never tracked. The local `.env` is the developer's own copy. |
| "`keys/private.pem` committed to repo" | Explicitly gitignored at [.gitignore:78](../../.gitignore#L78). Only `keys/public.pem` is tracked, which is correct for license-validation. |
| "Stripe webhook accepts NULL signature" | [server/routes/stripe-webhooks.js:9-11](../../server/routes/stripe-webhooks.js#L9-L11) returns 503 when `stripeWebhookSecret` is missing. Guard exists. |
| "AI usage not metered in routes" | `incrementUsage(userId, 'ai_queries')` is called **20 times** in [server/routes/ai.js](../../server/routes/ai.js). Metering is wired. |
| "CLA has no automation; manual" | [.github/workflows/cla.yml](../../.github/workflows/cla.yml) uses `contributor-assistant/github-action@v2.6.1` and gates merge via `pull_request_target`. Automation works. |
| "Webhook event accepts unsigned in dev" | Same 503 guard above; dev mode also rejects without `STRIPE_WEBHOOK_SECRET`. |

---

## 4. Confirmed Findings — Phased Plan

> **Format:** each item has a stable ID (`P0-1` etc.) so PRs / commits can reference them. Severity, source specialist, file refs, fix sketch, and verification step are listed.

---

### Phase P0 — Security & Legal Must-Fix (≈1.5 days)

These are real, verified, and either **block production** or **expose legal risk**.

#### **P0-1 — Remove `API_KEY_SECRET` hardcoded fallback** [CRITICAL]
- **From:** Specialist #2 + #6
- **Where:** [server/middleware/api-key-auth.js:11-13](../../server/middleware/api-key-auth.js#L11-L13)
- **Verified:** ✅ literal default `'grm-default-dev-secret-change-in-production'`
- **Why:** if env var is unset in prod, an attacker who knows the default can forge HMAC hashes and impersonate any API key.
- **Fix:**
  ```js
  function getHmacSecret() {
      const secret = process.env.API_KEY_SECRET;
      if (!secret) {
          if (process.env.NODE_ENV === 'production') {
              throw new Error('API_KEY_SECRET must be set in production');
          }
          // Dev-only random per process — never persisted, forces regen on restart
          process.env.API_KEY_SECRET = crypto.randomBytes(32).toString('hex');
          logger.warn('API_KEY_SECRET not set; generated ephemeral dev secret');
          return process.env.API_KEY_SECRET;
      }
      return secret;
  }
  ```
- **Verify:** unit test that imports the module with `NODE_ENV=production` and no env var must throw.
- **Effort:** S

#### **P0-2 — Stripe webhook idempotency** [CRITICAL]
- **From:** Specialist #6
- **Where:** [server/routes/stripe-webhooks.js:24-84](../../server/routes/stripe-webhooks.js#L24-L84)
- **Verified:** ✅ no `event.id` recorded; `grep -r 'stripe_event_id'` returns nothing
- **Why:** Stripe retries up to 5×. Duplicate `checkout.session.completed` causes double subscription INSERTs / proration drift.
- **Fix:**
  1. New migration: `webhook_events (id TEXT PRIMARY KEY, type TEXT, processed_at INTEGER)`
  2. At top of `stripeWebhookHandler`, after signature verify:
     ```js
     const seen = db.prepare('SELECT 1 FROM webhook_events WHERE id = ?').get(event.id);
     if (seen) return res.json({ received: true, deduped: true });
     db.prepare('INSERT INTO webhook_events (id, type, processed_at) VALUES (?, ?, ?)')
         .run(event.id, event.type, Date.now());
     ```
- **Verify:** new test in `server/__tests__/stripe-webhooks.test.js` (also addresses P1-9) that posts the same event twice and asserts only one DB mutation.
- **Effort:** M

#### **P0-3 — License cache must re-check expiry on every request** [HIGH]
- **From:** Specialist #6
- **Where:** [server/middleware/require-tier.js:65-66](../../server/middleware/require-tier.js#L65-L66)
- **Verified:** ✅ cache returned without `payload.exp` re-check; license signed at startup will appear "valid forever" until process restart.
- **Why:** an Enterprise customer's expired license keeps unlocking features for days/weeks past expiry.
- **Fix:**
  ```js
  if (cachedLicenseTier && envKey === cachedLicenseKey) {
      const exp = cachedLicensePayload?.exp;
      if (!exp || exp * 1000 > Date.now()) return cachedLicenseTier;
      // Expired — purge and fall through to free
      cachedLicenseTier = null;
      cachedLicensePayload = null;
      logger.warn('Cached license expired — downgrading to free tier');
  }
  ```
- **Verify:** test that fakes a payload with `exp` 1s in the future, sleeps 2s, asserts tier returns `free`.
- **Effort:** S

#### **P0-4 — AGPL §13 source disclosure link in UI** [HIGH]
- **From:** Specialist #6, validated against [GNU AGPL §13](https://www.gnu.org/licenses/agpl-3.0.en.html) and [opensource.com guidance](https://opensource.com/article/17/1/providing-corresponding-source-agplv3-license)
- **Verified:** ✅ no source-code link present in any rendered shell (`Header.jsx`, `Sidebar.jsx`, no `Footer.jsx` exists)
- **Why:** AGPL §13 requires SaaS users to be "prominently offered an opportunity to receive the Corresponding Source" — currently the only AGPL reference is in `LICENSE` (not visible to end-users). Risk: community pushback, FSF complaint.
- **Fix:**
  - Add a tiny `Footer.jsx` rendered inside `App.jsx` (sticky bottom, single line) with: `"AGPL v3 — [Source code](https://github.com/brunobola-portfolio/GitHub-Repo-Manager) · [Commercial license](https://bolalabs.pt/license)"`.
  - Also expose `/api/v1/system/source` returning the repo URL (machine-readable for forks).
- **Verify:** Playwright test asserts the link is visible from any logged-in screen.
- **Effort:** S

#### **P0-5 — Delete stray `server/actions_routes.txt`** [MEDIUM, but trivial]
- **From:** Specialist #8
- **Where:** [server/actions_routes.txt](../../server/actions_routes.txt)
- **Verified:** ✅ file exists; tracked
- **Why:** breaks the rule in [CLAUDE.md](../../CLAUDE.md) ("Never place loose files outside `.dev/`"); creates noise.
- **Fix:** `git rm server/actions_routes.txt` (content already mirrored in `docs/api/API.md`).
- **Effort:** S

#### **P0-6 — Add `.dockerignore`** [HIGH for shipping container builds]
- **From:** Specialist #8
- **Where:** missing at repo root; [Dockerfile:6](../../Dockerfile#L6) does `COPY . .`
- **Verified:** ✅ no `.dockerignore` present
- **Why:** if `.env` is ever staged accidentally, it lands in the Docker image. Also bloats image with `node_modules`, `dist`, `coverage`, `.git`, `.worktrees`.
- **Fix:** create `.dockerignore`:
  ```
  node_modules
  dist
  coverage
  test-results
  playwright-report
  .env
  .env.*
  .git
  .github
  .worktrees
  .dev
  .claude
  .playwright-mcp
  *.db
  *.sqlite
  ```
- **Verify:** `docker build .` and inspect `docker history` shows reduced layer size.
- **Effort:** S

---

### Phase P1 — Correctness & Monetization Integrity (≈3 days)

#### **P1-1 — `useTheme` provider value not memoized** [HIGH]
- **From:** Specialist #4
- **Where:** [src/hooks/useTheme.jsx:67-72](../../src/hooks/useTheme.jsx#L67-L72)
- **Verified:** ✅ object literal recreated every render
- **Why:** every theme-consumer (Header, Sidebar, every modal) re-renders on any ancestor re-render, even when theme is unchanged.
- **Fix:** wrap in `useMemo(() => ({ theme, isDark, toggleTheme, setTheme }), [theme, resolved])` and wrap `toggleTheme` in `useCallback`.
- **Verify:** React DevTools profiler — Header should not re-render when an unrelated `useState` in `App` changes.
- **Effort:** S

#### **P1-2 — Stripe tier metadata not cross-checked against price** [MEDIUM-HIGH]
- **From:** Specialist #6
- **Where:** [server/routes/stripe-webhooks.js:29-30, 44-45](../../server/routes/stripe-webhooks.js#L29-L30)
- **Why:** webhook trusts `metadata.tier` from session. If a Stripe price object's tier metadata diverges from the session metadata, customer ends up on the wrong tier.
- **Fix:** in `checkout.session.completed`, fetch the line items: `await stripe.checkout.sessions.listLineItems(session.id, { expand: ['data.price'] })`, derive tier from `price.metadata.tier`, fall back to session metadata only if absent. Log warning on mismatch.
- **Verify:** add a test where session metadata says `pro` but the price metadata says `enterprise` — assert tier ends up as `enterprise` and warning is logged.
- **Effort:** M

#### **P1-3 — Pricing-page ↔ feature-flags parity test** [MEDIUM]
- **From:** Specialist #6
- **Where:** [src/components/Pricing/PricingPage.jsx](../../src/components/Pricing/) ↔ [server/lib/feature-flags.js:3-36](../../server/lib/feature-flags.js#L3-L36)
- **Why:** feature copy on pricing page is hand-maintained; will silently drift from the actual gates.
- **Fix:**
  - Refactor `PricingPage.jsx` to **import** the tier feature catalogue from a single source of truth (e.g. extract `tier-features.js` shared between client and server).
  - OR add a Vitest test that parses both files and asserts feature parity.
- **Verify:** test fails if you change `pro.aiQueriesPerMonth` in `feature-flags.js` without updating the pricing page.
- **Effort:** M

#### **P1-4 — Fix logger pino-pretty test failure (unblocks all server tests)** [CRITICAL for CI]
- **From:** Specialist #7
- **Where:** [server/lib/logger.js:11-14](../../server/lib/logger.js#L11-L14)
- **Why:** pino-pretty transport throws in test env without `pino-pretty` installed in dev deps the right way; blocks ~7 server test files.
- **Fix:** guard the transport behind `nodeEnv !== 'test'` AND `nodeEnv !== 'production'`:
  ```js
  const transport = (config.nodeEnv !== 'production' && config.nodeEnv !== 'test')
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined;
  ```
- **Verify:** `npm test` from a clean install — all server tests should at least *load* even if some fail.
- **Effort:** S

#### **P1-5 — Stripe webhook & ai-streaming tests** [HIGH]
- **From:** Specialist #7
- **Where:** missing — no `server/__tests__/stripe-webhooks.test.js`, no `server/__tests__/ai-streaming.test.js`
- **Fix:** add tests for: signature verify rejects bad sig, `checkout.session.completed` mutates DB, idempotency dedup (P0-2), unsupported event type returns 200 silently. SSE test: streams chunks, closes on client disconnect, cleans up Gemini handle.
- **Verify:** coverage report shows both files >80%.
- **Effort:** M

#### **P1-6 — Add E2E job to CI** [HIGH]
- **From:** Specialist #8
- **Where:** [.github/workflows/ci.yml](../../.github/workflows/ci.yml) — has `lint`, `test`, `build`, **no e2e**
- **Why:** Playwright suite exists in `e2e/` but never gates merges; regressions slip through.
- **Fix:** add new job (run after `build` succeeds, conditional on PR not just push):
  ```yaml
  e2e:
    needs: build
    runs-on: ubuntu-latest
    env:
      SESSION_SECRET: ci-test-session-secret-not-real-32chars
      NODE_ENV: test
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report/ }
  ```
- **Verify:** new PR — `e2e` check shows up as required.
- **Effort:** S

#### **P1-7 — Replace E2E `waitForTimeout` with semantic waits** [MEDIUM]
- **From:** Specialist #7
- **Where:** [e2e/bulk-actions.spec.js](../../e2e/bulk-actions.spec.js), [e2e/context-menu-wave-1.spec.js](../../e2e/context-menu-wave-1.spec.js)
- **Fix:** swap `await page.waitForTimeout(300)` for `await expect(locator).toBeVisible()` / `page.waitForLoadState('networkidle')`.
- **Verify:** run E2E suite 5× locally — no flakes.
- **Effort:** S

#### **P1-8 — useEffect AbortController consistency** [MEDIUM]
- **From:** Specialist #4
- **Where:** [src/components/AI/RepoInsightsModal.jsx:59-88](../../src/components/AI/RepoInsightsModal.jsx#L59-L88), [src/components/AI/ReadmeEnhanceDiffPanel.jsx:14-48](../../src/components/AI/ReadmeEnhanceDiffPanel.jsx#L14-L48), [src/components/CreateRepoModal.jsx:23-49](../../src/components/CreateRepoModal.jsx#L23-L49)
- **Why:** mix of manual `cancelled` flags and `AbortController.signal` — rapid open/close can set state on unmounted components.
- **Fix:** standardise on `AbortController` everywhere. Pass `signal` to `fetch()`; `try { await fetch } catch (e) { if (e.name === 'AbortError') return }`.
- **Verify:** strict-mode dev (already enabled) shows no "set state on unmounted" warnings during repeated open/close.
- **Effort:** M

#### **P1-9 — License key bound check on `exp`** [MEDIUM]
- **From:** Specialist #2
- **Where:** [server/lib/license.js:79-82](../../server/lib/license.js#L79-L82) (function `isLicenseExpired`)
- **Why:** a forged JWT with `exp: 9999999999` would currently look valid. Defence-in-depth.
- **Fix:** add upper bound: `if (payload.exp > (Date.now()/1000) + 10*365*24*60*60) return true;` (treat anything >10y future as "expired/forged").
- **Effort:** S

---

### Phase P2 — Code Quality, Duplication, Performance (≈5 days)

#### **P2-1 — `useTabData` hook for 8 RepoDetail tabs** [HIGH duplication]
- **From:** Specialist #1
- **Where:** [src/components/RepoDetail/ActionsTab.jsx:18](../../src/components/RepoDetail/ActionsTab.jsx#L18), [BranchesTab.jsx:10](../../src/components/RepoDetail/BranchesTab.jsx#L10), [IssuesTab.jsx:11](../../src/components/RepoDetail/IssuesTab.jsx#L11), [OverviewTab.jsx:10](../../src/components/RepoDetail/OverviewTab.jsx#L10), [PullRequestsTab.jsx:12](../../src/components/RepoDetail/PullRequestsTab.jsx#L12), [ReleasesTab.jsx:10](../../src/components/RepoDetail/ReleasesTab.jsx#L10), [PRDetailPanel.jsx:36](../../src/components/RepoDetail/PRDetailPanel.jsx#L36), [IssueDetailPanel.jsx:14](../../src/components/RepoDetail/IssueDetailPanel.jsx#L14)
- **Fix:** extract `src/hooks/useTabData.js`:
  ```js
  export function useTabData(loader, deps) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const reload = useCallback(async () => {
      const ctrl = new AbortController();
      setLoading(true); setError(null);
      try { setData(await loader(ctrl.signal)); }
      catch (e) { if (e.name !== 'AbortError') setError(e); }
      finally { setLoading(false); }
      return () => ctrl.abort();
    }, deps); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { const cleanup = reload(); return () => cleanup?.(); }, [reload]);
    return { data, loading, error, reload };
  }
  ```
- **Net:** removes ~480 lines of boilerplate.
- **Verify:** existing tab tests still pass.
- **Effort:** M

#### **P2-2 — Extract `BaseDetailPanel` for PRDetail/IssueDetail** [HIGH duplication]
- **From:** Specialist #1
- **Where:** [src/components/RepoDetail/PRDetailPanel.jsx](../../src/components/RepoDetail/PRDetailPanel.jsx) (501 lines) ≈70 % overlap with [IssueDetailPanel.jsx](../../src/components/RepoDetail/IssueDetailPanel.jsx) (279 lines)
- **Fix:** new `BaseDetailPanel.jsx` owns: header, comments fetcher, comment input/submit, message banner. PRDetail/IssueDetail compose it with type-specific tab content.
- **Effort:** M-L

#### **P2-3 — Consolidate date/size formatters** [MEDIUM]
- **From:** Specialist #1
- **Where:** [src/components/Settings/ApiKeysSection.jsx:42](../../src/components/Settings/ApiKeysSection.jsx#L42), [Settings/AuditLogSection.jsx:120](../../src/components/Settings/AuditLogSection.jsx#L120), [Settings/LicensePlanSection.jsx:115](../../src/components/Settings/LicensePlanSection.jsx#L115), [ConflictPanel.jsx:9](../../src/components/ConflictPanel.jsx#L9), [MigrationWizard/steps/RepoConfigStep.jsx:18](../../src/components/MigrationWizard/steps/RepoConfigStep.jsx#L18), [MigrationWizard/steps/RepoSelectStep.jsx:18](../../src/components/MigrationWizard/steps/RepoSelectStep.jsx#L18)
- **Fix:** all use `formatDateTime` and `formatFileSize` from [src/utils/format.js](../../src/utils/format.js); delete the local copies.
- **Effort:** S

#### **P2-4 — Queue long-running migrations to BullMQ** [HIGH performance]
- **From:** Specialist #3
- **Where:** [server/routes/migration.js:177](../../server/routes/migration.js#L177), [server/migration-engine.js:232](../../server/migration-engine.js#L232)
- **Why:** `executePlan()` is fire-and-forget but still blocks DB transactions during the polling loop; multi-task migrations stall request handlers.
- **Fix:** add a `migration-worker.js` (mirror of `ai-worker.js`); route returns 202 + `jobId`; SSE channel exposes progress (`/api/v1/migration/jobs/:id/stream`).
- **Verify:** Playwright test that starts a 10-task migration, immediately polls 5 unrelated endpoints, asserts they return < 200 ms.
- **Effort:** M

#### **P2-5 — Bound and TTL the in-memory caches** [HIGH performance]
- **From:** Specialist #3
- **Where:** [server/lib/github-api.js:30,38](../../server/lib/github-api.js#L30), [server/routes/v1/index.js:63,134](../../server/routes/v1/index.js#L63)
- **Fix:** extract `server/lib/memory-cache.js` exposing `createCache({ maxSize, ttlMs })` (LRU + TTL). All inline caches use it. Multi-instance deployments override with Redis backend.
- **Effort:** M

#### **P2-6 — Add missing composite indexes** [MEDIUM performance]
- **From:** Specialist #3
- **Where:** new migration; see [server/routes/ai.js:390](../../server/routes/ai.js#L390), [server/routes/v1/index.js:162](../../server/routes/v1/index.js#L162)
- **Fix:** `CREATE INDEX IF NOT EXISTS idx_repo_metadata_user_repo ON repo_metadata(user_id, repo_id); CREATE INDEX IF NOT EXISTS idx_repo_assignments_team ON repo_assignments(team_id);`
- **Verify:** `EXPLAIN QUERY PLAN` shows `USING INDEX`.
- **Effort:** S

#### **P2-7 — Parallelise sequential GitHub fetches in AI indexing** [MEDIUM]
- **From:** Specialist #3
- **Where:** [server/routes/ai.js:288-304](../../server/routes/ai.js#L288-L304)
- **Fix:** `Promise.all([readmePromise, treePromise])`; soft-error each leg.
- **Effort:** S

#### **P2-8 — SSE disconnect cleanup** [MEDIUM]
- **From:** Specialist #3
- **Where:** [server/routes/ai-streaming.js](../../server/routes/ai-streaming.js)
- **Fix:** wire `req.on('close', () => abortController.abort())`; pass signal into Gemini SDK; verify model handle is released.
- **Effort:** M

#### **P2-9 — Memoize sidebarProps in App.jsx** [MEDIUM]
- **From:** Specialist #4
- **Where:** [src/App.jsx:465-475](../../src/App.jsx#L465-L475)
- **Fix:** wrap with `useMemo`; wrap `Sidebar` in `React.memo`.
- **Effort:** S

#### **P2-10 — Per-route ErrorBoundary** [MEDIUM]
- **From:** Specialist #4
- **Where:** only one boundary at root in [src/App.jsx](../../src/App.jsx); [src/components/ErrorBoundary.jsx](../../src/components/ErrorBoundary.jsx)
- **Fix:** wrap each lazy route (`RepoDetail`, `Settings`, `MigrationWizard`, `PRReview`) with its own boundary so a crash in one section keeps the app shell.
- **Effort:** M

#### **P2-11 — Standardise API client wrappers** [MEDIUM]
- **From:** Specialist #1
- **Where:** [src/api/repos.js:14-36](../../src/api/repos.js#L14-L36), [src/api/migration.js:9-28](../../src/api/migration.js#L9-L28)
- **Fix:** all callers use `apiCall()` from `src/utils/api.js`; remove ad-hoc `fetchWithRetry` re-wrappings.
- **Effort:** M

#### **P2-12 — Delete dead `getTopRepos` export** [LOW]
- **From:** Specialist #1
- **Where:** [src/utils/statsAggregator.js:127](../../src/utils/statsAggregator.js#L127)
- **Fix:** delete the export; demote `calculateTrend` to private.
- **Effort:** S

#### **P2-13 — Unbounded session MemoryStore in dev** [MEDIUM]
- **From:** Specialist #3
- **Where:** [server/index.js:152-180](../../server/index.js#L152-L180)
- **Fix:** in dev, default to SQLite-backed sessions (already in production); reserve MemoryStore for `NODE_ENV=test` only.
- **Effort:** S

---

### Phase P3 — UI/UX, Accessibility, DX, Docs (≈3 days)

#### **P3-1 — Filter selects need `aria-label`** [HIGH a11y]
- **From:** Specialist #5
- **Where:** [src/components/RepoList.jsx](../../src/components/RepoList.jsx) (type/visibility/language filters)
- **Fix:** pass `label="Filter by type"` etc. to `<Select>` (component already supports it).
- **Effort:** S

#### **P3-2 — ChatInput textarea unlabeled** [HIGH a11y]
- **From:** Specialist #5
- **Where:** [src/components/DevToolkit/shared/ChatInput.jsx:32-41](../../src/components/DevToolkit/shared/ChatInput.jsx#L32-L41)
- **Fix:** add `aria-label="Refine search or query"`.
- **Effort:** S

#### **P3-3 — Sidebar quick-actions popover ARIA** [HIGH a11y]
- **From:** Specialist #5
- **Where:** [src/components/Sidebar.jsx:50-58](../../src/components/Sidebar.jsx#L50-L58)
- **Fix:** add `role="dialog" aria-modal="true" aria-labelledby` linking trigger button.
- **Effort:** S

#### **P3-4 — FAQ accordion focus ring + Escape key** [MEDIUM a11y]
- **From:** Specialist #5
- **Where:** [src/components/Pricing/PricingPage.jsx:114-127](../../src/components/Pricing/PricingPage.jsx#L114-L127)
- **Fix:** `focus-visible:ring-2 focus-visible:ring-indigo-500`; `onKeyDown` closes on `Escape`.
- **Effort:** S

#### **P3-5 — Button focus ring dark-mode contrast** [MEDIUM a11y]
- **From:** Specialist #5
- **Where:** [src/components/ui/Button.jsx:23](../../src/components/ui/Button.jsx#L23)
- **Fix:** add `dark:focus-visible:ring-indigo-400`.
- **Effort:** S

#### **P3-6 — Add `eslint-plugin-jsx-a11y`** [MEDIUM]
- **From:** Specialist #8 (extension of #5 findings)
- **Where:** [eslint.config.js](../../eslint.config.js) — currently only react-hooks + react-refresh
- **Fix:** add the plugin; turn on `recommended`. Many of P3-1..5 would have been caught automatically.
- **Effort:** S

#### **P3-7 — Add `format`, `db:migrate`, `db:seed` npm scripts** [MEDIUM DX]
- **From:** Specialist #8
- **Where:** [package.json](../../package.json) scripts block
- **Fix:**
  ```json
  "format": "eslint . --fix",
  "db:migrate": "node server/db.js --migrate",
  "db:seed": "node scripts/seed.js"
  ```
- **Effort:** M (the migrate/seed entrypoints may need adapting)

#### **P3-8 — Move Redis deps to `optionalDependencies`** [LOW]
- **From:** Specialist #8
- **Where:** [package.json](../../package.json): `bullmq`, `ioredis`, `connect-redis`, `rate-limit-redis`
- **Fix:** move to `optionalDependencies`; runtime `try { require('bullmq') } catch { /* feature off */ }`.
- **Effort:** M

#### **P3-9 — `docs/index.md` link to API.md** [LOW]
- **From:** Specialist #8
- **Where:** [docs/index.md](../../docs/index.md)
- **Fix:** add row under "API": `- [API Reference](api/API.md) — REST endpoint catalogue`.
- **Effort:** S

#### **P3-10 — SPDX headers across all source files** [LOW]
- **From:** Specialist #6
- **Where:** only 3 of ~83 server files have `SPDX-License-Identifier` headers
- **Why:** AGPL §4(b) "keep intact all notices"; lower bar than disclosure but tidy.
- **Fix:** script `scripts/add-spdx-headers.js` that prepends:
  ```
  // SPDX-License-Identifier: AGPL-3.0-only
  // Copyright (c) 2025-2026 Bola Labs
  ```
- **Effort:** S

---

## 5. Effort × Impact Matrix

```
              SECURITY/LEGAL          REVENUE              QUALITY            DX
            ┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
HIGH IMPACT │ P0-1, P0-2, P0-3 │ P1-2, P1-3       │ P2-1, P2-4, P2-5 │ P1-6, P3-6       │
            │ P0-4, P0-6       │                  │ P1-1, P2-10      │                  │
            ├──────────────────┼──────────────────┼──────────────────┼──────────────────┤
MED IMPACT  │ P1-9, P0-5       │ P1-5             │ P2-2, P2-6, P2-8 │ P3-7, P1-7, P1-4 │
            │                  │                  │ P2-9, P2-11      │                  │
            ├──────────────────┼──────────────────┼──────────────────┼──────────────────┤
LOW IMPACT  │ P3-10            │                  │ P2-3, P2-7, P2-12│ P3-8, P3-9       │
            │                  │                  │ P2-13            │                  │
            └──────────────────┴──────────────────┴──────────────────┴──────────────────┘
```

---

## 6. Suggested PR Sequencing

To minimise rebases, ship in this order:

1. **PR-A: P0 bundle** (P0-1..6) — single PR, can ship in a day.
2. **PR-B: Logger fix unblocks tests** (P1-4) — needed before P0-2 / P1-2 / P1-5 tests can land.
3. **PR-C: Stripe hardening** (P0-2 already shipped in PR-A; P1-2, P1-5).
4. **PR-D: License/Pricing parity** (P1-3).
5. **PR-E: CI E2E + flake fix** (P1-6, P1-7).
6. **PR-F: React 19 perf bundle** (P1-1, P1-8, P2-9, P2-10).
7. **PR-G: Duplication cleanup** (P2-1, P2-2, P2-3, P2-11, P2-12).
8. **PR-H: Backend perf** (P2-4, P2-5, P2-6, P2-7, P2-8, P2-13).
9. **PR-I: A11y sweep** (P3-1..6).
10. **PR-J: DX & docs** (P3-7..10).

---

## 7. Open Questions for the Owner

1. **Stripe price metadata** — does every Pro/Enterprise price object in Stripe have `metadata.tier` set? (Required for P1-2 to work cleanly.)
2. **License grace period** — do we want 30-day offline grace for self-hosted Enterprise customers? (Specialist #6 asked; not included in plan because it changes commercial behaviour.)
3. **Multi-key license rotation** — Phase 2 multi-key resolver was promised in [require-tier.js:23](../../server/middleware/require-tier.js#L23) but not implemented. Defer until first key rotation is needed?
4. **Bundle Footer placement** — in the slim, content-dense layout, where should the AGPL link live? Sidebar? Settings/About? Tiny footer?
5. **Test coverage threshold** — Specialist #7 noted the 80 % threshold isn't enforced in CI. Should P1-6 also enforce it (`failOnThreshold: true`)?

---

## 8. References

- AGPL §13 interpretation: [GNU AGPL 3.0 text](https://www.gnu.org/licenses/agpl-3.0.en.html), [opensource.com guide](https://opensource.com/article/17/1/providing-corresponding-source-agplv3-license)
- Existing recent work: [docs/plans/2026-04-13-comprehensive-code-review.md](2026-04-13-comprehensive-code-review.md) — this plan complements (does not duplicate) it.
- Specialists #1-8 raw output: in this audit's session log; condensed into the items above with `file:line` verification.
