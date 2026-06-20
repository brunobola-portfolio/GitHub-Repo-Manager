# Audit Panel Report — GitHub Repo Manager

_Compiled from a multi-specialist panel across security, monetization, backend correctness, migration, database, frontend correctness/performance, accessibility, testing/CI, and product honesty. High/critical findings carry an adversarial verifier verdict (severity already corrected per verdict). Medium/low findings were **not** independently verified and are labeled **unverified**._

_Run: 10 specialist explorers + adversarial verification + synthesis. 43 agents, 79 raw findings → 70 kept (9 refuted)._

---

## 1. Executive Summary

The codebase is in solid shape overall — most findings are medium/low and several "high" submissions were correctly downgraded by the verifier. The handful of things that genuinely deserve your attention as a solo founder:

1. **GDPR erasure gap (the one true critical).** User self-service data erasure (`server/routes/user-data.js`) deletes ~13 tables but skips `dashboard_inbox_state`, which has **no foreign key at all** (`server/db.js:1089-1096`, confirmed). Because the code is explicitly framed as GDPR Article 17 / SOC 2 compliance, leaving personal data behind is a compliance violation, not just a data-hygiene bug. One-line fix.

2. **Two product-honesty issues that affect purchasing decisions.** `sso: true` is declared for Enterprise (`feature-flags.js:106`, confirmed) and advertised in the README + 5 pricing components, but **no SSO/SAML/OIDC implementation exists** — only GitHub OAuth. And the README claims an `npm run dev:kill` script that doesn't exist. These erode trust; fix the marketing or the code.

3. **Silent failures in the migration/import engine.** LFS push failures are swallowed as warnings while the migration still reports `success: true` (`import-service.js:520-526`, confirmed), producing repos with orphaned LFS pointers that fail on clone. Two fire-and-forget batch-import IIFEs (`azure/git.js:260-274`, confirmed; `azure/tfvc.js:180-205`) have no `.catch`, so an orchestrator failure can strand jobs in `running` forever. These are availability/data-integrity risks in your headline feature.

4. **Defense-in-depth gaps on monetization gates.** The audit-log and several tier checks are enforced only at the mount point, not in the handler. Today they're protected; the risk is a future refactor silently exposing Enterprise features. Cheap to harden.

5. **A cluster of accessibility violations** (contrast, redundant aria-labels, focus restoration) that are quick wins and matter for WCAG AA conformance if you sell to enterprise.

The test-suite findings are real but mostly "mock-driven tests give false confidence" — worth a sprint, not an emergency.

---

## 2. Prioritized Findings Table

| Severity | Area | Title | Location | Confidence |
|---|---|---|---|---|
| Critical | Database / GDPR | `dashboard_inbox_state` missing FK + omitted from erasure | `server/db.js:1089-1096`; `server/routes/user-data.js:149-249` | High (verified) |
| High | Backend correctness | Unhandled rejection in git batch-import queue | `server/routes/import/azure/git.js:260-274` | High (verified) |
| High | Backend correctness | Unhandled rejection in TFVC batch-import queue | `server/routes/import/azure/tfvc.js:180-205` | High (verified) |
| High | Migration | LFS push fails silently, migration still reports success | `server/import-service.js:520-526` | High (verified) |
| High | Backend correctness | License cache warm-up swallows startup errors | `server/middleware/require-tier.js:193-203` | High (verified) |
| High | Honesty | SSO declared in tier config but not implemented | `server/lib/feature-flags.js:106`; `server/routes/auth.js` | High (verified) |
| High | a11y | Redundant aria-label + aria-label-as-status on ConfirmModal buttons | `src/components/ui/ConfirmModal.jsx:96,99` | High (verified) |
| High | a11y | `text-slate-400` on light bg fails WCAG AA contrast (~2.6:1) | `src/components/CommandPalette.jsx:483-503` | High (verified) |
| Medium | Security | CSRF bypass trusts `Bearer grm_live_` prefix without validating key | `server/middleware/csrf.js:126` | High (verified, downgraded) |
| Medium | Monetization | Audit route has no handler-level tier check (mount-only) | `server/routes/audit.js:8`; `server/routes/v1/index.js:67` | High (verified, downgraded) |
| Medium | Monetization | Revoked DB license honored up to 5 min in edge cases | `server/middleware/require-tier.js:44,86-101` | High (verified, downgraded) |
| Medium | Backend correctness | `check-duplicates` auth-fallback returns 200 instead of 4xx | `server/routes/import/url.js:159` | High (verified, downgraded) |
| Medium | Migration | Default-branch align fails silently, can leave broken HEAD | `server/import-service.js:538-555` | High (verified, downgraded) |
| Medium | Migration | Replace-retry patch loses config on malformed/null JSON | `server/routes/migration.js:547-564`; `server/lib/migration-task-config.js` | High (verified, downgraded) |
| Medium | Database | `repo_assignments.assigned_by` missing FK action + erasure | `server/db.js:87`; `server/routes/user-data.js:149-230` | High (verified, downgraded) |
| Medium | Frontend correctness | `handleSubmit` recreated every keystroke (cascading deps) | `src/components/DevToolkit/shared/ChatInput.jsx:9-21` | High (verified, downgraded) |
| Medium | Frontend perf | Render-time `new Date()` x3 per RepoCard; memo misses `pushed_at` | `src/components/RepoList/RepoCard.jsx:225-235,245` | High (verified, downgraded) |
| Medium | Frontend perf | `Object.values(modalStates).some()` unmemoized every render | `src/App.jsx:185` | High (verified, downgraded) |
| Medium | Testing/CI | E2E runs only mock mode — no real OAuth path exercised | `.github/workflows/ci.yml:84`; `playwright.config.js:101` | High (verified, downgraded) |
| Medium | Testing/CI | Migration quota test fully mocks DB — integration gap | `server/__tests__/migration-quota-route.test.js:18-54` | High (verified, downgraded) |
| Medium | Testing/CI | AI tier tests assert mocks, not real feature-flag logic | `server/__tests__/ai-tier-and-limits.test.js:11-52` | High (verified, downgraded) |
| Medium | Security | Audit-log query built via conditional SQL concatenation | `server/routes/audit.js:19-28` | Unverified |
| Medium | Security | No step-up auth for destructive ops (24h sliding session) | `server/index.js:214` | Unverified |
| Medium | Security | API-key scopes enforced only on mutations, not reads | `server/middleware/api-key-auth.js:98-102` | Unverified |
| Medium | Security | Webhook signature skipped when unset in non-prod | `server/middleware/auth.js:61-66` | Unverified |
| Medium | Monetization | AI quota check + increment not atomic (race) | `server/lib/usage-meter.js:77-96` | Unverified |
| Medium | Monetization | Migration charge after status→running can orphan plan | `server/routes/migration.js:432-438` | Unverified |
| Medium | Monetization | Free full-plan quota enforced at execute, not creation | `server/routes/migration.js:266-323` | Unverified |
| Medium | Database | `migration_jobs.user_id` missing ON DELETE CASCADE | `server/db.js:219` | Unverified |
| Medium | Database | Nullable col in UNIQUE constraint defeats uniqueness | `server/db.js:492,501` | Unverified |
| Medium | Database | Quota charge race on concurrent execute | `server/routes/migration.js:196-198` | Unverified |
| Medium | Backend correctness | Temp dir cleanup swallows errors (disk leak) | `server/routes/v1/repos-sync.js:82` | Unverified |
| Medium | Backend correctness | Shutdown health-probe signal swallows errors | `server/index.js:399` | Unverified |
| Medium | Migration | SSE catch-up can send stale task progress | `server/migration-engine.js:1048-1050` | Unverified |
| Medium | Migration | retryTask doesn't re-validate config | `server/migration-engine.js:643-658` | Unverified |
| Medium | Migration | LFS fetch failure not surfaced when detection misses | `server/import-service.js:402-413` | Unverified |
| Medium | Frontend correctness | CompareSimilarDrawer setState after unmount | `src/components/AI/CompareSimilarDrawer.jsx:39-62` | Unverified |
| Medium | Frontend correctness | AttentionFeed closure over stale `topItems` | `src/components/Dashboard/AttentionFeed.jsx:145-175` | Unverified |
| Medium | Frontend correctness | CommunityHealthFixModal no abort on dep change | `src/components/AI/CommunityHealthFixModal.jsx:94-99` | Unverified |
| Medium | Frontend perf | RepoCardQuickActions rebuilds action array per card | `src/components/RepoList/RepoCard.jsx:21-58` | Unverified |
| Medium | Frontend perf | RepoGrid unvirtualized below 50 items | `src/components/RepoList/RepoGrid.jsx:11-63` | Unverified |
| Medium | Frontend perf | Dashboard charts compute even when hidden on mobile | `src/components/Dashboard/ActivityChart.jsx`; `LanguageChart.jsx` | Unverified |
| Medium | Frontend perf | RepoCard memo misses `language`/`topics`/`aiMeta` | `src/components/RepoList/RepoCard.jsx:240-252` | Unverified |
| Medium | a11y | Hardcoded `duration-300` bypasses motion tokens | `src/components/Header.jsx:88,205,248,363` | Unverified |
| Medium | a11y | `role="presentation"` + onClick lacks keyboard support | `src/components/RepoDetail/PullRequestsTab.jsx:321` | Unverified |
| Medium | a11y | Focus not restored to trigger on modal dismiss | `src/components/ui/Modal.jsx:104` | Unverified |
| Medium | a11y | Decorative icons missing `aria-hidden` | `src/components/CommandPalette.jsx:480,500,520` | Unverified |
| Medium | Honesty | "87 mock repos" but only 9 seeded server-side | `README.md:412`; `server/db.js:1190` | Unverified |
| Medium | Honesty | DORA metrics: no visible tier gate / empty-data UX | `README.md:203`; `server/lib/event-aggregations.js` | Unverified |
| Medium | Testing/CI | API-key auth not tested against tier-gated routes | `server/__tests__/api-key-auth.test.js` | Unverified |
| Medium | Testing/CI | Credential encrypt→embed→clone not tested end-to-end | `server/__tests__/import-service-core.test.js`; `azure-credentials-vault.test.js` | Unverified |
| Medium | Testing/CI | CI doesn't validate test count / naming | `.github/workflows/ci.yml:58` | Unverified |
| Medium | Testing/CI | Month-boundary quota reset never integration-tested | `server/lib/usage-meter.js:18-24` | Unverified |
| Low | Security | License validation single cached key, no rotation | `server/middleware/require-tier.js:26` | Unverified |
| Low | Security | Rate-limit tier ambiguity on middleware ordering | `server/middleware/tenant-rate-limit.js:65` | Unverified |
| Low | Monetization | `checkUsageLimit` returns Infinity for unknown metric silently | `server/lib/usage-meter.js:60-72` | Unverified |
| Low | Monetization | Team member limit per-team not global | `server/routes/teams.js:146-148` | Unverified |
| Low | Monetization | `migration_assist` metered but not gated | `server/routes/ai/migration.js` | Unverified |
| Low | Database | Non-parameterized table names in migration (whitelisted) | `server/db.js:33,37` | Unverified |
| Low | Backend correctness | `validate-url` missing explicit `.status(200)` (style) | `server/routes/import/url.js:43` | Low (verified, downgraded) |
| Low | Frontend perf | Framer Motion in critical path (already code-split) | `src/main.jsx:11`; `vite.config.js:82-83` | Unverified |
| Low | a11y | `.ds-focus-ring` JIT-discovery fragility | `src/design-system.css:259` | Unverified |
| Low | Testing/CI | Coverage thresholds 2pp below baseline (intentional buffer) | `vitest.config.js:59-64` | Low (verified, downgraded) |
| Low | Honesty | AI Deep Review prose ambiguous (table is correct) | `README.md:333-339` | Unverified |
| Low | Honesty | "Actions Analytics" overstated vs implementation | `README.md:136-142` | Unverified |
| Low | Honesty | Dry-run "unlimited" comment clarity | `server/lib/feature-flags.js:34` | Unverified |
| Low | Honesty | `npm run dev:kill` documented but script missing | `README.md:715-716` | Unverified |

---

## 3. Detailed Findings

### CRITICAL

#### C1 — `dashboard_inbox_state` has no FK and is skipped by GDPR erasure
**Location:** `server/db.js:1089-1096` (schema, confirmed); `server/routes/user-data.js:149-249` (erasure transaction).
**What's wrong:** The table stores per-user inbox archive/snooze state keyed on `user_id`, but unlike 20+ other user-scoped tables it declares **no foreign key**. The self-service erasure transaction deletes ~13 tables and omits this one, and the data-export path omits it too. The erasure flow is explicitly labeled GDPR Article 17 / SOC 2 CC6.5 code.
**Impact:** When a user erases their account, their inbox personal data persists indefinitely. That's a direct compliance violation, plus orphaned-row accumulation. This is the one finding the verifier elevated rather than downgraded.
**Fix:** Add `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE` to the schema, and add `DELETE FROM dashboard_inbox_state WHERE user_id = ?` to the erasure transaction (and to the export). Note: existing deployments need a migration since SQLite can't add FKs to an existing table without a table rebuild — the explicit DELETE in the transaction is the immediate must-have.

---

### HIGH

#### H1 — Unhandled rejection in git batch-import queue
**Location:** `server/routes/import/azure/git.js:260-274` (confirmed — bare `(async () => { ... })();` with no `.catch`).
**What's wrong:** The fire-and-forget orchestrator IIFE has no error boundary. Per-job errors inside `runImport` are handled, but if the orchestrator loop or a DB write inside it throws, the rejection is unhandled.
**Impact:** Jobs stranded in `running` state permanently, blocking future imports. The global `unhandledRejection` handler logs but does not remediate.
**Fix:** `})().catch(err => logger.error({ err }, 'Batch import queue failed'));` and wrap the loop body so one job failure can't crash the orchestrator. Mark any still-`running` jobs as `interrupted` on catch.

#### H2 — Unhandled rejection in TFVC batch-import queue
**Location:** `server/routes/import/azure/tfvc.js:180-205`.
**What's wrong:** Same pattern as H1; additionally the inline `UPDATE migration_jobs SET status='running'` and the completion/failure DB ops lack their own error boundaries, so a DB failure escapes uncaught.
**Impact / Fix:** Identical to H1 — add `.catch`, guard DB ops, mark stuck jobs `interrupted`. **Merge with H1 for one cleanup PR.**

#### H3 — LFS push fails silently while migration reports success
**Location:** `server/import-service.js:520-526` (confirmed) — `catch (e) { logger.warn(...) }` with no re-throw; success object (lines ~566-576) returns `success: true` unconditionally.
**What's wrong:** When `git lfs push` fails (auth, rate limit, network), the migration still completes "successfully," leaving the target with LFS pointers to missing objects.
**Impact:** Cloning the migrated repo fails with "LFS object not found." Silent data loss in the product's flagship feature; the comment at 517-519 even acknowledges the orphaned-pointer risk.
**Fix:** Re-throw on definitive failures (401/403); only swallow transient timeouts (ideally with retry). Add `lfsObjectsUnpushed: true` to returned metadata so `SummaryStep` warns and the plan isn't marked `completed` with orphaned objects.
**Note:** This is distinct from the recently-shipped fix (which made `git lfs push` *run* for the lfs-migrate path) — H3 is about the push itself *failing* being swallowed.

#### H4 — License cache warm-up swallows startup errors
**Location:** `server/middleware/require-tier.js:193-203` — `refreshLicenseCache().then(...).catch(() => {})`.
**What's wrong:** The only unguarded throw is the synchronous `db.prepare().get()` inside `getStoredLicense()`. A DB error at startup is silently discarded and the server proceeds with no license tier (effectively degrading to free) with zero operator signal.
**Impact:** Silent tier misconfiguration at deploy; operators get no diagnostic. Runtime validation has proper handling, so scope is startup-only.
**Fix:** `.catch(err => logger.warn({ err }, 'Failed to warm license cache at startup'))`.

#### H5 — SSO declared in tier config but not implemented (vaporware)
**Location:** `server/lib/feature-flags.js:106` (`sso: true`, confirmed); `server/routes/auth.js` (GitHub OAuth only).
**What's wrong:** README + FeatureComparison/PricingPreview/PricingPage/RoadmapPage/LicensePlanSection all advertise SSO/SAML for Enterprise, but there are no SAML/OIDC packages, routes, middleware, or any consumption of the `sso` flag.
**Impact:** Directly affects Enterprise purchasing decisions — paid customers expect a feature that doesn't exist. Trust/integrity issue (and arguably legal exposure on a paid tier).
**Fix:** Either remove `sso: true` and the pricing claims, or label it clearly as roadmap ("Coming soon"). Don't market it as shipped.

#### H6 — ConfirmModal buttons: redundant aria-label + aria-label-as-status
**Location:** `src/components/ui/ConfirmModal.jsx:96` (`aria-label={cancelText}` duplicates visible text), line 99 (confirm button uses `aria-label` to convey loading state).
**What's wrong:** Duplicate accessible names confuse screen readers (WCAG 2.1 AA); loading state should use `aria-busy`, not an overridden label.
**Fix:** Drop the redundant `aria-label` (visible text already names the button). Replace the conditional loading label with `aria-busy={isLoading || isSubmitting}`.

#### H7 — `text-slate-400` on light backgrounds fails WCAG AA contrast
**Location:** `src/components/CommandPalette.jsx:483-503` (e.g. repo name / PR number metadata).
**What's wrong:** `#94a3b8` on white ≈ 2.6:1, below the 4.5:1 requirement for normal text. Dark mode (slate-400 on slate-900) is fine.
**Fix:** Use `text-slate-500` (or `text-slate-600` for fine metadata) / the `--ds-fg-muted` token in light mode. Worth a repo-wide grep for `text-slate-400` on light surfaces.

---

### MEDIUM (verified — severity corrected down)

#### M1 — CSRF bypass trusts `Bearer grm_live_` prefix without validating the key
**Location:** `server/middleware/csrf.js:126`. **What's wrong:** CSRF is skipped for any `Authorization: Bearer grm_live_...` via prefix check only; the bypass relies on downstream `apiKeyAuth` (only mounted via `requireAuth`). **Impact:** Real but narrow — exploitable only if an unprotected mutation endpoint accepts the unvalidated bearer; SameSite=Lax + double-submit cookies provide defense-in-depth. **Fix:** Validate the key exists/format strictly before bypassing, or only bypass after `apiKeyAuth` has authenticated.

#### M2 — Audit route lacks handler-level tier check (mount-only gate)
**Location:** `server/routes/audit.js:8`; mounted with `requireTier('enterprise')` at `server/routes/v1/index.js:67`. **What's wrong:** Handler uses only `requireAuth`; tier protection lives solely at the single mount point. **Impact:** Protected today; risk is a future refactor/remount silently exposing Enterprise audit logs to Free/Pro. **Fix:** Add `requireTier('enterprise')` directly in the handler for defense-in-depth.

#### M3 — Revoked DB license honored up to 5 minutes (edge case)
**Location:** `server/middleware/require-tier.js:44,86-101`. **What's wrong:** Cached path validates JWT `exp` but not whether the stored key still exists. Normal API uninstall calls `refreshLicenseCache()` synchronously (safe); only out-of-band DB deletion serves stale tier for ≤5 min until background refresh. **Fix:** Reduce TTL for DB-sourced licenses, or have `clearStoredLicense()` emit an event to invalidate the cache immediately.

#### M4 — `check-duplicates` auth fallback returns 200 on failure
**Location:** `server/routes/import/url.js:159`. **What's wrong:** When the `/user` fallback fails, returns `res.json({duplicates:{},...})` → 200 OK, signaling success on a partial failure. Client degrades gracefully, so impact is limited to semantic incorrectness. **Fix:** `res.status(401).json({ error: 'Could not authenticate with GitHub', duplicates:{}, duplicateDetails:{} })`.

#### M5 — Default-branch alignment can leave repo with broken HEAD
**Location:** `server/import-service.js:538-555`. **What's wrong:** PATCH to set `default_branch` doesn't check response status (fetch only throws on network errors), so a 403/422 silently leaves HEAD pointing at a deleted ref. Scoped to the `reusedExistingRepo` path. **Fix:** Check `res.ok`; on failure retry the push to restore a valid default branch, or throw so the user knows manual repair is needed.

#### M6 — Replace-retry patch loses config on malformed/null JSON
**Location:** `server/routes/migration.js:547-564`; `server/lib/migration-task-config.js`. **What's wrong:** `withPatch` resets `obj={}` on null/parse error, dropping `sizeStrategy`/LFS settings. Schema validation makes null unlikely in normal flow, so impact requires legacy/manual data. **Fix:** Preserve `sizeStrategy` when patching; log a warning on malformed config.

#### M7 — `repo_assignments.assigned_by` no FK action + skipped by erasure
**Location:** `server/db.js:87`; `server/routes/user-data.js:149-230`. **What's wrong:** FK has no `ON DELETE` action and erasure omits `repo_assignments`, leaving dangling `assigned_by` references after tombstoning. **Fix:** Add `DELETE FROM repo_assignments WHERE assigned_by = ?` to the erasure transaction; add `ON DELETE CASCADE`/`SET NULL` on a future migration.

#### M8 — ChatInput `handleSubmit` recreated every keystroke
**Location:** `src/components/DevToolkit/shared/ChatInput.jsx:9-21`. **What's wrong:** `value` in `useCallback` deps recreates `handleSubmit` (and cascades to `handleKeyDown`) on each keystroke. Practical impact small. **Fix:** Read value from the ref at submit time, or use functional `setValue`, dropping `value` from deps.

#### M9 — RepoCard render-time Date allocation + incomplete memo
**Location:** `src/components/RepoList/RepoCard.jsx:225-235,245`. **What's wrong:** `new Date()` x3 per card per render; memo comparison omits `pushed_at`, so "updated X ago" can go stale. **Fix:** `useMemo` the time-ago keyed on `repo.pushed_at`; add `pushed_at` to the memo comparator.

#### M10 — `anyModalOpen` recomputed every render in App
**Location:** `src/App.jsx:185`. **What's wrong:** `Object.values(modalStates).some(Boolean)` runs unmemoized, changing the `enabled` prop identity into `useKeyboardShortcuts` and re-creating its listener each render. **Fix:** `useMemo(() => Object.values(modalStates).some(Boolean), [modalStates])`.

#### M11 — E2E runs only in mock mode (no real OAuth path)
**Location:** `.github/workflows/ci.yml:84`; `playwright.config.js:101`. **What's wrong:** All E2E auto-authenticate via mock mode; real OAuth is unit-tested only. **Fix:** Add one E2E smoke test against a wiremock/replay OAuth flow.

#### M12 — Migration quota test fully mocks DB
**Location:** `server/__tests__/migration-quota-route.test.js:18-54`. **What's wrong:** Mocks `usage-meter` and all DB queries, so a divergence between `getCurrentUsage()` and the quota decision, or month-boundary rollover, wouldn't be caught. **Fix:** Add an in-memory SQLite integration test exercising charge→deny→reset across a simulated month rollover.

#### M13 — AI tier tests assert mocked values, not real tier logic
**Location:** `server/__tests__/ai-tier-and-limits.test.js:11-52`. **What's wrong:** Mocks `checkUsageLimit`, `checkAIFeatureLimit`, and `requireTier`, so tests verify response shape given canned values rather than that tier→features→limit mapping is correct. **Fix:** Keep `feature-flags.js` + `usage-meter.js` real, mock only DB/auth/AI services.

---

### MEDIUM (unverified — not independently checked)

- **Security:** Audit-log conditional SQL concatenation (`audit.js:19-28`) — params are bound but string is built dynamically; refactor to a fixed `FILTERS` map. No step-up auth for destructive ops under 24h rolling session (`index.js:214`). API-key scopes enforced only on mutations, not reads (`api-key-auth.js:98-102`). Webhook signature skipped when `WEBHOOK_SECRET` unset in non-prod (`auth.js:61-66`).
- **Monetization:** AI quota check/increment not atomic (`usage-meter.js:77-96`) — TOCTOU under concurrency. Migration charge after status→running can orphan plan (`migration.js:432-438`). Free full-plan quota enforced only at execute, not creation (`migration.js:266-323`). Concurrent-execute quota charge race (`migration.js:196-198`).
- **Database:** `migration_jobs.user_id` missing `ON DELETE CASCADE` (`db.js:219`). Nullable column in UNIQUE constraint defeats intent (`db.js:492,501`).
- **Backend correctness:** Temp-dir cleanup swallows errors → disk leak (`repos-sync.js:82`). Shutdown health-probe signal swallowed (`index.js:399`) → traffic not drained on deploy. _(Both: just add `.catch` logging.)_
- **Migration:** SSE catch-up sends stale progress (`migration-engine.js:1048-1050`). `retryTask` doesn't re-validate config (`:643-658`). LFS-fetch failure unsurfaced when `.gitattributes` detection misses (`import-service.js:402-413`).
- **Frontend correctness:** setState-after-unmount in CompareSimilarDrawer (`:39-62`), CommunityHealthFixModal no abort-on-dep-change (`:94-99`), AttentionFeed stale-closure over `topItems` (`:145-175`) — all want AbortController/cancellation cleanup.
- **Frontend perf:** RepoCardQuickActions rebuilds action array per card (`RepoCard.jsx:21-58` — hoist `Object.values(repoActions)` to module scope). RepoGrid unvirtualized below 50 (`RepoGrid.jsx` — reuse the wizard's virtualization). Dashboard charts compute while hidden on mobile (`ActivityChart/LanguageChart`). RepoCard memo misses `language`/`topics`/`aiMeta` (`:240-252`).
- **a11y:** Hardcoded `duration-300` vs motion tokens (`Header.jsx`). `role="presentation"`+onClick lacks keyboard support (`PullRequestsTab.jsx:321`). Focus not restored to trigger on modal dismiss (`Modal.jsx:104`). Decorative icons missing `aria-hidden` (`CommandPalette.jsx:480,500,520`).
- **Honesty:** "87 mock repos" but 9 seeded server-side (`README.md:412` / `db.js:1190` — client-generated; clarify copy). DORA metrics lack visible tier gate + empty-data UX (`README.md:203`).
- **Testing/CI:** API-key auth untested against tier-gated routes. Credential encrypt→embed→clone not E2E-tested. CI doesn't validate test count/naming (`ci.yml:58`). Month-boundary quota reset never integration-tested (`usage-meter.js:18-24`).

---

### LOW

- **Security:** Single cached license public key, no rotation/`kid` support (`require-tier.js:26`). Rate-limit tier ambiguity on middleware ordering (`tenant-rate-limit.js:65`) — document/enforce `attachTier` runs first.
- **Monetization:** `checkUsageLimit` silently returns Infinity for unknown metrics (`usage-meter.js:60-72`) — a metric typo grants unlimited quota; add a warning log. Team member limit per-team not global (`teams.js:146-148`) — likely intentional; document. `migration_assist` metered but never gated (`ai/migration.js`) — add a check or drop the meter.
- **Database:** Non-parameterized (but whitelisted) table names in PRAGMA/DROP (`db.js:33,37`) — document why PRAGMA can't be parameterized.
- **Backend correctness:** `validate-url` missing explicit `.status(200)` (`url.js:43`) — pure style; Express defaults to 200.
- **Frontend perf:** Framer Motion in critical path (`main.jsx:11`) — already code-split; optional `modulepreload`.
- **a11y:** `.ds-focus-ring` JIT-discovery fragility (`design-system.css:259`).
- **Testing/CI:** Coverage thresholds 2pp below baseline (`vitest.config.js:59-64`) — intentional, documented buffer.
- **Honesty:** AI Deep Review prose ambiguous though table is correct (`README.md:333-339`). "Actions Analytics" overstated vs implementation (`README.md:136-142`). Dry-run "unlimited" comment clarity (`feature-flags.js:34`). `npm run dev:kill` documented but the script doesn't exist (`README.md:715-716`) — users hit "missing script"; add it or fix the docs.

---

## 4. Quick Wins vs Strategic

### Quick wins (high value / low effort)
- **C1 erasure DELETE** — one line in the erasure transaction closes a GDPR gap (plus the export). _Do this first._
- **H1+H2 batch-import `.catch`** — two `.catch(err => logger.error(...))` calls prevent stranded jobs.
- **H4 license warm-up `.catch` logging** — one line.
- **H5 SSO honesty** — remove/relabel the `sso` flag and pricing copy; the dishonest claim is the immediate liability.
- **H6 ConfirmModal aria** — swap label→`aria-busy`, remove redundant labels.
- **H7 / contrast** — global `text-slate-400`→`text-slate-500` in light mode.
- **M2 audit handler tier check**, **M4 status code**, **M10 `useMemo`**, decorative `aria-hidden`, dead `dev:kill` doc, backend `.catch` logging on repos-sync/shutdown — all single-edit fixes.
- **Low-effort monetization hardening:** warning log for unknown metrics (`usage-meter.js`), gate or drop `migration_assist`.

### Strategic (larger efforts)
- **H3 LFS integrity** — proper failure propagation + retry + metadata + SummaryStep warning + plan-status logic. Touches the migration contract; test carefully.
- **Atomic quota enforcement** (M-tier monetization races) — wrap check+operation+increment in a transaction or pre-decrement pattern across AI and migration paths.
- **Test-suite integration coverage** — convert the mock-heavy tier/quota/OAuth/credential tests to real in-memory-DB integration tests; add E2E OAuth smoke and month-rollover tests. One focused sprint.
- **API-key scope-to-endpoint mapping** + step-up auth for destructive ops — a real authz design effort, not a patch.
- **FK + cascade migration** across `dashboard_inbox_state`, `repo_assignments`, `migration_jobs` — requires SQLite table rebuilds; bundle into one schema-hardening migration.
- **Frontend perf pass** — RepoGrid virtualization, module-scope action arrays, hidden-chart deferral, complete memo comparators — coherent as one performance PR.

---

## 5. Looked Solid

Areas the panel probed without surfacing serious issues:

- **SQL injection surface** — parameterized queries used throughout; the only flags were a conditional-but-bound builder (`audit.js`) and whitelisted PRAGMA table names, both low risk.
- **Core session/cookie security** — `httpOnly`, `sameSite: 'lax'`, `secure` in prod, rolling + absolute timeout ceiling all present; the only gap is the absence of step-up auth, not a misconfiguration.
- **CSRF defense-in-depth** — SameSite=Lax + double-submit cookies layered; the bearer-prefix gap is the one logical seam.
- **Migration provenance & replace-conflict flows** — generally robust; findings were edge cases (malformed config, branch-align failure), not core-path defects.
- **Per-job error handling inside `runImport`** — individual import jobs are correctly try/caught; only the orchestrator wrapper lacked a boundary.
- **Pricing/feature-parity numbers** — the parity test keeps PricingPage/FeatureComparison/feature-flags numerically in sync; the gaps are SSO (unimplemented) and the parity test not asserting *runtime enforcement*, not mismatched numbers.
- **Code-splitting & motion a11y** — Framer Motion is properly vendored/code-split and respects `reducedMotion="user"`; no real bundle problem.
- **Accessibility primitives** — focus trap, initial-focus, and escape handling exist in `Modal`; the gaps are usage-level (restoreFocusRef not always passed), not missing infrastructure.
- **Coverage governance** — the threshold buffer is a deliberate, documented anti-flake measure, not an oversight.

---

_Files re-verified directly during compilation: `server/db.js:1089-1096` (no FK — confirmed), `server/lib/feature-flags.js:106` (`sso: true` — confirmed), `server/import-service.js:520-526` (silent LFS catch — confirmed), `server/routes/import/azure/git.js:260-274` (uncaught IIFE — confirmed)._
