# Prod & Premium Remediation Plan — execution tracker

**Source:** `docs/reports/2026-07-05-prod-premium-readiness-panel.md` (88 findings, panel-verified)
**Mode:** direct-to-main commits (owner-authorized), one commit per cluster, push after each wave.
**Method:** Opus implementation agents on disjoint file sets; Fable reviews every diff, runs targeted tests, commits. Agents never run git.
**Resume:** update the Status column as work lands. To resume in a new session: read this file + the report, continue the first `pending` wave.

## Wave A — legal/monetization/data honesty

| # | Item | Files (primary) | Status |
|---|---|---|---|
| A1a | GDPR erasure sweep: enumerate user-scoped tables dynamically (sqlite_master minus explicit survive-allowlist) so new tables can't be missed | `server/routes/user-data.js` | done |
| A1b | Schedule the written-but-never-run purge jobs (BYOK retention pass, gh_cache, gh_outbox, undo-log) as boot janitors with graceful-shutdown stop | `server/index.js`, `server/lib/retention.js` | done |
| A2a | Yearly billing: thread billingPeriod into checkout end-to-end; hide yearly toggle unless yearly Stripe prices are configured | `Pricing/PricingPage.jsx`, server billing route, `server/config.js` | done |
| A2b | Pricing claims honesty: SOC 2 / AES-256-at-rest / data-residency copy → only what code substantiates | `Pricing/PricingPage.jsx` | done |
| A2c | Settings upsell: correct quota numbers from ground truth; extend parity gate to cover LicensePlanSection | `Settings/LicensePlanSection.jsx`, `tests/pricing-feature-parity.test.js` | done |
| A2d | Roadmap vs pricing write-back contradiction: reword Roadmap (backend is ungated; Free keeps write-back per pricing page) | `Roadmap/RoadmapPage.jsx` | done |
| A3a | Naive-UTC timestamps: central parse fix in format.js (+Z for SQLite naive strings), remove leaf hand-patches | `src/utils/format.js` + leaf components | done |
| A3b | Status vocabulary: canonicalize `complete`→`completed` (writers + stats + data migration + UI map) | `server/routes/import/*`, `server/lib/db-migrations.js` | done |
| A3c | MigrationHistory duration via formatDurationSeconds; standardize `N/A`→`—` | `MigrationHistory.jsx`, `RepoDetail/OverviewTab.jsx`, `SettingsTab.jsx` | done |

## Wave B — ops hardening + flagship UX

| # | Item | Files (primary) | Status |
|---|---|---|---|
| B1a | Fail startup when ALLOW_MOCK_AUTH set in production (secrets gate) | `server/lib/startup-secrets-check.js` | done |
| B1b | SQLite backup story: scheduled `.backup()` janitor + retention + restore doc | `server/index.js`, new lib, docs | done |
| B1c | Health checks → `/live`/`/ready` probes | `Dockerfile`, `railway.toml` | done |
| B1d | Compression + immutable caching for hashed assets on Express SPA | `server/index.js` | done |
| B1e | SSE drain on shutdown (close SSE clients before server.close) | `server/index.js` | done |
| B1f | X-Request-Id ↔ logged requestId correlation; pino redact backstop; 4MB AI body-limit on /api/v1/ai/* | `server/index.js`, `server/lib/logger.js` | done |
| B2a | Bulk visibility: replace forced-private with Public/Private picker modal | `src/actions/repoActions.js` + modal | done |
| B2b | PR review submit: success toast + refetch | `PRReview/PRReviewView.jsx` | done |
| B2c | ReadmeEnhanceDiffPanel: pass diffViewTheme | `AI/ReadmeEnhanceDiffPanel.jsx` | done |
| B2d | DevToolkit ReviewTab: light-mode legible bubble palette | `DevToolkit/ReviewTab/ReviewTab.jsx` | done |

## Wave C — quick wins (polish PR)

| # | Item | Status |
|---|---|---|
| C1 | PT strings (HeroSyncChip, MarksBadge, MarksDetailModal, Steppers) + widen anti-PT guard (accent-free words; note server prompts) | done |
| C2 | WorkBoard window.alert → toast | done |
| C3 | document.title per view | done |
| C4 | Landing footer "Vite 7" → sourced version | done |
| C5 | ErrorBoundary: generic message, raw error to details/console | done |
| C6 | AIInstructionsSection tabs → shared ui/TabBar | done |
| C7 | Wizard "Back to Selection" history.back() → wizard step nav | done |
| C8 | Silent catch{} in ProgressStep/MigrationHistory → toast.errorFromException | done |
| C9 | `.dark html` scrollbar selector fix (`html.dark`) | done |
| C10 | `color-scheme: light dark` for native controls | done |
| C11 | ::selection dark-mode token | done |

## Wave D — structural mediums (as credit allows)

| # | Item | Status |
|---|---|---|
| D1 | Event-table retention job (pr/issue/deployment events, workflow_runs) | done |
| D2 | MigrationWizard dark-only islands (SizeStrategyCard, TFVC, PingAuthorPopover) | done |
| D3 | A11y: name destructive icon buttons; migration progressbar semantics + completion announcement | done |
| D4 | dead OrganizationSelector removed; dead DB tables deferred (needs migration + registry sync) | partial |
| D5 | Unsaved-changes guard (RepoDetail Settings / SettingsModal) | done |
| D6 | Browser-Back history model (pushState for drill-ins) | done |
| D7 | RepoSelector+BranchSelector+SavedCredentialsPicker migrated (renderOption additive); PromptPicker+ModelCombobox left with rationale | done |
| D8 | Pause→Resume control in ProgressStep | done |

## Deferred (needs owner decision or separate initiative)
- Teams + AIAssistant audit sweep (surfaces unaudited by the panel)
- Playwright visual pass both themes at 1920/2560
- Repo-grid virtualization; server input-validation uniformity sweep
- 2026-06-25 layout spec (separate approved scope)

## Log
- 2026-07-05: plan created; report committed.
- 2026-07-05: Wave A2 landed (yearly billing honest end-to-end + /billing/config probe; compliance claims rewritten; LicensePlanSection corrected + parity gate 5th surface; Roadmap page + ROADMAP.md write-back reconciled). 57 targeted tests green.
- 2026-07-05: Wave B2 landed (bulk visibility split into two honest actions; PR review submit toast+refetch; ReadmeEnhance diff theme; DevToolkit chat light-mode). 52 targeted tests green.
- 2026-07-05: Wave A3 landed (parseServerTimestamp UTC fix app-wide + 4 leaf de-patches; complete->completed writers + migration 27 + tolerant reads; durations + em-dash placeholders). 85 targeted tests green.
- 2026-07-05: Wave A1 landed (registry-driven GDPR erasure covering ~37 user-scoped tables + schema-introspection completeness test; export gap + credential-leak fix; maintenance janitors scheduling retention/gh_cache/gh_outbox/undo-log). 58 targeted tests green.
- 2026-07-05: Wave C landed (PT strings EN + wider anti-PT gate incl. server chat prompt; alert->toast; per-view document.title; Vite 8 footer; friendly ErrorBoundary; AIInstructions tabs on shared TabBar; wizard step-nav CTA; scrollbar/color-scheme/::selection theme fixes). 95 targeted tests green. C8 pending.
- 2026-07-05: C8+D8+D3(progressbar) landed by lead (ProgressStep: load-error retry state, pause/cancel toasts, Resume button, progressbar+live-region a11y; MigrationHistory: rerun/resume/export toasts). 4 new RTL tests.
- 2026-07-05: Wave D-alpha landed (SizeStrategyCard/TFVC/FixPlanItem/PingAuthorPopover light+dark pairs incl. trigger chip + DashboardHeader badge; delete-release/webhook aria-labels; webhook dot text alternative). Also FIXED pre-existing CI red: AutoFixDrawer conflict test broken by a8b5576 CSRF mint (route-aware fetch mock).
- 2026-07-05: Wave B1 landed (prod boot fails on ALLOW_MOCK_AUTH; scheduled WAL-safe SQLite backups + restore doc; health probes in Dockerfile/railway; compression + immutable asset caching; SSE-aware shutdown drain; request-id/log unification + pino redact; v1 AI body-limit; event-table retention 365d; vercel.json placeholder removed). 67 tests green. NOTE for owner: deploy.yml is a silent no-op behind a green badge — needs workflow-scope change (fail loudly or rename to Build Verify).
- 2026-07-05: Wave D-beta landed (Select renderOption additive + 3 pickers migrated with a11y; dead OrganizationSelector deleted; unsaved-Settings guard in RepoDetail; MigrationActivity error-vs-empty + wizard CTA; AI-topics Index action). 489 tests green across affected suites. SettingsModal reported no-dirty-tracking by design; ModelCombobox/PromptPicker left bespoke with rationale.
- 2026-07-05: FINAL VALIDATION — full unit suite locally: 5115 passed / 24 skipped / 0 failed (583 files). CI green through B1 (a07d4592); D-beta run in progress at time of writing. All planned waves landed except deliberate deferrals (see below).

## Session outcome (2026-07-05)
All 9 clusters landed direct-to-main with per-cluster review + targeted tests + lint. Deliberately deferred: D4 dead-table drops (needs migration + erasure-registry sync), D6 Back-button history model (product decision), Badge/pill + tooltip + relative-time-dialect consolidations, axe-gate widening, Teams/AIAssistant sweep, Playwright visual pass, deploy.yml honesty (owner-only, workflow scope).
- 2026-07-05: Wave E4 landed (Back-button history: pushState on drill-ins repo-detail/pr-review + different-repo, replaceState on laterals/tab changes, popstate listener for same-fragment pops; pr-review stays out of hash space). 30 tests green.
