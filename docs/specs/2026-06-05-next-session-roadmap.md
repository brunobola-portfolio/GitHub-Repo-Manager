# Next-Session Roadmap — Excellence / Licensing-Rebalance Program

**Date:** 2026-06-05
**Status:** handoff. The high-value work is shipped (10 PRs, #86–#95). What remains is maintainability (monolith splits) + a few low-risk loose ends. Derived from a read-only analysis panel (workflow task `we6vjctqq`) verified against source.

---

## What shipped (context)

| PR | Slice |
|----|-------|
| #86 | basic bulk (visibility/archive) free on own repos (`basicBulk` flag) |
| #87 | correct Free pricing claims + **load-bearing parity gate** (`tests/pricing-feature-parity.test.js` now parses PricingPage + FeatureComparison + README matrix + per-feature caps + bulk/sync/auditLog/deep-review tiers) |
| #88 | security: `repos-sync.js` `migration_jobs` lookup scoped by `user_id` (cross-tenant fix) |
| #89 | Migration Wizard + Settings PT→EN + `tests/build/no-portuguese-ui.test.js` guard |
| #90 | migration metered-free — Free = 1 full migration/month (`migration_full_executions` counter + `migration_plans.quota_charged`; `server/lib/migration-quota.js`) |
| #91 | sync preview-free (`GET /api/v1/repos/:owner/:repo/sync/preview` + `reposApi.previewSync` + `sync_preview` action) |
| #92 | client-side PAT format validation (`src/utils/patFormat.js`) |
| #93 | AI fetch quota-gate unification (`utils/aiFetch`→`api/aiFetch` gate; `api/ai.js` left separate by design) |
| #94 | remaining app-wide PT→EN; guard ROOTS broadened |
| #95 | fix #94 gaps: paste-card keyword desync bug, live PT in `App.jsx`, `MigratedPill`/`TargetModePicker` leaks, e2e selectors, **guard hardened to scan App.jsx/main.jsx + accent-free tokens** |

**Pricing lockstep (keep in sync, enforced by the parity gate):** `server/lib/feature-flags.js` ↔ `src/components/Pricing/PricingPage.jsx` ↔ `src/components/Pricing/FeatureComparison.jsx` ↔ README matrix (~L321).

---

## ⚠️ Process note: e2e is NOT a required CI check on this repo

#94 merged with a **red e2e** (a real regression). The merge is not blocked by e2e, so **always** run `gh pr checks <n>` and confirm **e2e** is `pass` before merging. **Roadmap item: make e2e a required status check.**

---

## Quick wins (small, low-risk — one PR each)

### 1. Forget migration credentials on plan completion — *MEDIUM (defense-in-depth)*
Encrypted creds linger up to 48h after a plan completes because the `plan-complete` handler only runs tagging.
- **Files:** `server/routes/migration.js` (plan-complete handler ~L87–91), `server/lib/migration-credential-manager.js` (`forget()` ~L72–76), new `server/__tests__/` test.
- **Approach:** after `taggingService.applyTaggingForPlan(planId)` settles, call `engine.credentials.forget(planId)` in a `.finally()` — but **only when `status === 'completed'`**. `forget()` is idempotent. Tagging retrieves creds inside its own awaited run, so chain `forget` after that promise, not synchronously.
- **Test:** emit `plan-complete` with `status: 'completed'` → assert `credentials_enc` is NULL; assert `forget` NOT called when status ≠ completed.

### 2. README doc-accuracy — *low*
- Badge "4200+" → real (~4243); prose "4200+ unit tests" likewise; "~200 endpoints" → **300+** (actual 303 `router.(get|post|put|delete|patch)` handlers in `server/routes`).
- **Files:** `README.md` (badge ~L24, prose ~L558, endpoint claim). Docs only; parity gate unaffected.

### 3. (Optional) usage-meter month boundary → UTC — *low*
`server/lib/usage-meter.js` `getCurrentPeriod()` builds start/end with local `new Date(y, m, 1)`, so monthly quota reset (AI queries + metered migrations #90/#91) is TZ-dependent and can misbucket near rollover.
- **Approach:** use `Date.UTC(...)` for both start and end + a TZ-boundary unit test (stub clock to last-day-of-month at a non-UTC offset). Check existing `usage_metrics.period_start` rows before shipping (one-time boundary shift is acceptable but document it).

---

## Monoliths (maintainability only — no honesty/security/behavior value)

**STRICT rules:**
- **Write & merge snapshot + behavior guard tests FIRST.** Never split a component whose guard tests aren't merged and green.
- Lowest-risk first. One component per PR, on a feature branch. Re-run the full guard suite after **every** extraction; stop and fix on any failure.

### 4. CommandPalette.jsx (1006) — *lowest risk*
Commands already externalized into ~10 helper modules; mostly presentational.
- **Guard tests:** snapshots per command group + ask-mode on/off + live-search results + empty states; behavior: ask-mode `?` toggle, translate/github search dispatch, recents persistence, `prReviewFocused` scoping.
- **Extract:** `SearchInput`, `AskModeBanner`, `RecentGroup`, `GitHubResults`, then a `CommandGroup` wrapper to DRY the repetitive `Command.Group` renders. Keep `AskModeResults` inline.

### 5. RepoConfigStep.jsx (836) — *medium*
4 hooks already extracted; the ~334-line repo-card render loop remains; heavy prop threading, thin coverage.
- **Guard tests:** empty state, collapsed/expanded card, multi-repo, Azure vs GitHub, conflict-detected, LFS banner, AI-unavailable; behavior: target-name conflict check, visibility cycle, expand toggle, AI description gen + quota notice, branch load-on-expand, LFS switch, project-picker conflict reset.
- **Extract:** `DashboardHeader`, `DescriptionField`, `RepoMetadataBadges`, `ConflictResolutionPanel`, then `RepoCard` as one cohesive component (don't over-split; add a `useRepoCardHandlers` hook if props exceed ~15).

### 6. MigrationWizard.jsx (931) — *medium*
State machine with dynamic step graphs (azure ~14 / url ~5 / github ~5), multi-variant steppers, import-job status derivation, auto-advance, dirty-close.
- **Guard tests:** step sequence per `sourceType`, auto-advance, each step renderer dispatch + lazy-Suspense, stepper variants (sidebar/horizontal/mobile), status derivation from `importJobs`, dirty-close confirm, footer button logic, import POST body, dry-run badge.
- **Extract:** `StepRenderer` (pure switch), `StepperControl` (3 variants), `useWizardNavigation`, `useWizardStepStatus`, `ConfirmCloseModal`. Run an e2e migration smoke after.

### 7. App.jsx (1688) — *highest risk; do LAST and most carefully*
Bidirectional hash↔state router, ~15 `APP_EVENTS` listeners, 20+ modal bridges, sidebar/org/session orchestration.
- **Guard tests:** hash↔`activeView` routing (deep-links like `#/repo/owner/name/pulls`, empty-hash→dashboard, no double-sync on mount), all ~15 `APP_EVENTS` listeners (emit→state, unsubscribe→no-effect), modal lifecycle per modal, responsive sidebar + org selection, session/auth gating.
- **Extract:** `useAppRouter`, `useAppEventBridge`, `ModalSurfaces`, `SidebarRegion`, `NotificationLayer`; then compose a `RenderActiveView`. Re-run the full guard suite after every extraction.

---

## Documentation

### 8. Document the AI-client two-contract design (do NOT unify yet)
`api/ai.js`'s `aiApi` returns honest **placeholders** (`{ mock: true, aiConfigured: false }` / `{ runtimeUnavailable: true }`) on unconfigured/503; `api/aiFetch.js` **throws** typed errors (`AINotConfiguredError`, …). This is intentional but undocumented in-code. Full unification = migrate the ~9 `aiApi` consumers to try/catch — a multi-PR effort, deferred.
- **Action:** add header comments to both files explaining the two contracts + which to prefer for new callers; write a short ADR (in `docs/architecture/` or `docs/reports/` — do **not** create a new subdir) capturing the rationale + the eventual unification plan.

---

## Recommended sequence

Quick wins first (items 1–3, no monolith touched), each its own small PR. Then the monoliths strictly test-guard-first and lowest-risk-first: **CommandPalette → RepoConfigStep → MigrationWizard → App.jsx**. Land item 8 (docs/ADR) whenever convenient. Confirm **e2e is green** on every PR before merging.
