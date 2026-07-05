# Prod & Premium Remediation Plan — execution tracker

**Source:** `docs/reports/2026-07-05-prod-premium-readiness-panel.md` (88 findings, panel-verified)
**Mode:** direct-to-main commits (owner-authorized), one commit per cluster, push after each wave.
**Method:** Opus implementation agents on disjoint file sets; Fable reviews every diff, runs targeted tests, commits. Agents never run git.
**Resume:** update the Status column as work lands. To resume in a new session: read this file + the report, continue the first `pending` wave.

## Wave A — legal/monetization/data honesty

| # | Item | Files (primary) | Status |
|---|---|---|---|
| A1a | GDPR erasure sweep: enumerate user-scoped tables dynamically (sqlite_master minus explicit survive-allowlist) so new tables can't be missed | `server/routes/user-data.js` | pending |
| A1b | Schedule the written-but-never-run purge jobs (BYOK retention pass, gh_cache, gh_outbox, undo-log) as boot janitors with graceful-shutdown stop | `server/index.js`, `server/lib/retention.js` | pending |
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
| B1a | Fail startup when ALLOW_MOCK_AUTH set in production (secrets gate) | `server/lib/startup-secrets-check.js` | pending |
| B1b | SQLite backup story: scheduled `.backup()` janitor + retention + restore doc | `server/index.js`, new lib, docs | pending |
| B1c | Health checks → `/live`/`/ready` probes | `Dockerfile`, `railway.toml` | pending |
| B1d | Compression + immutable caching for hashed assets on Express SPA | `server/index.js` | pending |
| B1e | SSE drain on shutdown (close SSE clients before server.close) | `server/index.js` | pending |
| B1f | X-Request-Id ↔ logged requestId correlation; pino redact backstop; 4MB AI body-limit on /api/v1/ai/* | `server/index.js`, `server/lib/logger.js` | pending |
| B2a | Bulk visibility: replace forced-private with Public/Private picker modal | `src/actions/repoActions.js` + modal | done |
| B2b | PR review submit: success toast + refetch | `PRReview/PRReviewView.jsx` | done |
| B2c | ReadmeEnhanceDiffPanel: pass diffViewTheme | `AI/ReadmeEnhanceDiffPanel.jsx` | done |
| B2d | DevToolkit ReviewTab: light-mode legible bubble palette | `DevToolkit/ReviewTab/ReviewTab.jsx` | done |

## Wave C — quick wins (polish PR)

| # | Item | Status |
|---|---|---|
| C1 | PT strings (HeroSyncChip, MarksBadge, MarksDetailModal, Steppers) + widen anti-PT guard (accent-free words; note server prompts) | pending |
| C2 | WorkBoard window.alert → toast | pending |
| C3 | document.title per view | pending |
| C4 | Landing footer "Vite 7" → sourced version | pending |
| C5 | ErrorBoundary: generic message, raw error to details/console | pending |
| C6 | AIInstructionsSection tabs → shared ui/TabBar | pending |
| C7 | Wizard "Back to Selection" history.back() → wizard step nav | pending |
| C8 | Silent catch{} in ProgressStep/MigrationHistory → toast.errorFromException | pending |
| C9 | `.dark html` scrollbar selector fix (`html.dark`) | pending |
| C10 | `color-scheme: light dark` for native controls | pending |
| C11 | ::selection dark-mode token | pending |

## Wave D — structural mediums (as credit allows)

| # | Item | Status |
|---|---|---|
| D1 | Event-table retention job (pr/issue/deployment events, workflow_runs) | pending |
| D2 | MigrationWizard dark-only islands (SizeStrategyCard, TFVC, PingAuthorPopover) | pending |
| D3 | A11y: name destructive icon buttons; migration progressbar semantics + completion announcement | pending |
| D4 | Dead code: OrganizationSelector; dead tables audit_log v1/license_keys; stale server/migrations/*.sql note | pending |
| D5 | Unsaved-changes guard (RepoDetail Settings / SettingsModal) | pending |
| D6 | Browser-Back history model (pushState for drill-ins) | pending |
| D7 | Select regressions (PromptPicker, SavedCredentialsPicker, ModelCombobox, DevToolkit selectors) | pending |
| D8 | Pause→Resume control in ProgressStep | pending |

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
