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
- 2026-07-05: Wave E3 landed (migration 28 drops dead audit_log v1 + license_keys with registry/docs sync; Work Board webhookConnected reads GitHub event tables not the Stripe ledger; stale server/migrations/*.sql deleted + README SoT note). 57 tests green. Frontend follow-up flagged: draft:* localStorage keys have no TTL.
- 2026-07-05: draft:* localStorage TTL landed by lead (draft:_meta index + once-per-session 30d sweep, legacy adoption; spec-compliant localStorage mock in tests/setup.js). 6 new tests.
- 2026-07-05: Wave E1 landed (9 relative-time dialects unified on formatRelativeTime; useRelativeTime = ticking wrapper; RepoDetail list timestamps relative+title; 5 byte-formatters -> formatFileSize; dates pinned to en-US like numbers). 211 mirror tests green.
- 2026-07-05: Wave E2 landed (Teams: load-error vs empty states + Retry everywhere, errorFromException on mutations, format.js timestamps, ActivityTab honesty fix — no more fabricated demo activity on prod errors; AIAssistant: mid-stream disconnect preserves partial text + interrupted marker + retry). 51 tests green incl. anti-PT gate. Panel blind spots closed.
- 2026-07-05: E-WAVE CLOSE-OUT — full suite 5143 pass / 24 skip / 0 fail (586 files). E1 7f289106, E2 279b35b2, E3 25681d66, E4 4922db2d, drafts-TTL 551f671d all on main.
- 2026-07-05: VISUAL PASS (Playwright, mock env) validated live: dashboard/repos/workboard/pricing light+dark premium; document.title per view; canonical time vocabulary; yearly toggle correctly hidden; honest claims; Back-from-drill-in works. FOUND+FIXED runtime bug: Forward traversal clobbered by mirror writing from a half-applied render (setActiveView is startViewTransition-wrapped/async vs sync's other setters) — sync-target guard in useAppRouter + 2 regression tests. Screenshots in .dev/visual-pass/.
- 2026-07-05: Owner-report follow-up landed by lead (chunk-load auto-recovery: one-shot reload on stale dynamic-import failures with 30s re-arm; marks 401 session gate stops per-card request spam without backend session). 19 tests green.
- 2026-07-06: Wave F3 landed 11bfac68 (tooltip convention documented on ui/Tooltip — interactive controls use Tooltip, native title only on static text; converted Header palette chip/NavButton/SystemHealthIndicator, CommunityHealthDashboard Fix-with-AI, PatPasteGuide Open-PAT with explicit aria-label, OrgManagerModal profile link; Tooltip Escape dismissal per WCAG 1.4.13 without swallowing the key from parent modals; Header icons w-[15px]→w-4, w-[18px]→w-4.5). 33 tests green.
- 2026-07-06: Wave G1 landed e3a944c9 (WorkBoardRowLink role="button" wrapper — shared by all 4 WorkBoard tabs — replaced by stretched z-0 open-in-app button; InlineActions/kebab/GitHub-link lifted z-10; row hover moved to group-hover; work-board axe test flipped warn-only→full gate; nested-interactive now ZERO across all 9 views; 8-case mirror). Verified independently: axe 9/9, 83 WorkBoard unit tests. Remaining warn-only rule: color-contrast (G3 in flight) + scrollable-region-focusable.
- 2026-07-06: F-WAVE CLOSE-OUT — full suite 5214 pass / 24 skip / 0 fail (591 files). F1 3f6cd80a, F2 98b054b9, F3 11bfac68, F4 9bc01383 all on main. Remaining follow-ups: WorkBoard cards nested-interactive (warn-only in a11y spec), color-contrast design pass, server validation remainder (crud contents, issues labels/assignees, actions-community).
- 2026-07-06: Wave F1 landed 3f6cd80a (nested-interactive eliminated at the source: RepoCard container de-roled with a stretched aria-pressed select button behind z-10 sibling controls — body-click-to-select preserved; PR/Issue rows use the stretched-title-button pattern with the row-open aria-labels kept; axe gate widened critical→critical+serious with documented DEFERRED_SERIOUS_RULES color-contrast + scrollable-region-focusable; scans 4→9 views incl. repo-detail/PR/issues/wizard/settings; Work Board warn-only — its own cards still nest controls, flagged for the WorkBoard owner). 83 unit + 9/9 axe chromium + regression e2e green.
- 2026-07-06: Wave F2 landed 98b054b9 (Badge tone/size/ring/icon/dot/as API, legacy variant path byte-identical; 18 bespoke pills migrated across Dashboard/Settings/MigrationWizard/WorkBoard onto the two canonical scales; interactive chips stay buttons per documented convention; solid-fill emphasis pills + ProgressStep/SimpleProgressStep status maps + counter pills deliberately left; 30-test Badge suite). 301 tests green across 41 mirror files.
- 2026-07-06: Wave F4 landed 9bc01383 (zod schemas prMerge/prReviewComment/prReviewReply/prReviewSubmit wired via validateBody on pulls merge/comments/replies/reviews; side normalised to LEFT/RIGHT; UI-only keys stripped from review comments instead of rejected; existing repoLabelCreateSchema wired on POST labels; 20-case suite against real schemas + middleware). 44 tests green. Agent-flagged follow-ups (not done): crud contents PUT/DELETE, issues labels/assignees (needs relaxed empty-array variant), actions-community hooks/dispatches.
