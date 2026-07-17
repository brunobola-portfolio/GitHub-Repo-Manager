# Code / UI / UX Audit Panel — 2026-07-17

Synthesis of a 5-specialist panel (frontend code, backend code, UI consistency, UX flows, product gaps) plus a trends/wow scan. All findings were deduplicated against the June–July 2026 remediation waves (PRs #42–#205); nothing below re-reports an already-fixed item. Findings marked **[verified]** were independently confirmed by a skeptic pass against the current code; unmarked items are unverified medium/low.

---

## 1. Executive summary

The app is in strong shape after the 2026 remediation waves — the panel found **0 critical** issues and no regressions in previously fixed areas. The biggest live risk is **cost**: three AI surfaces (`/ai/index`, `/ai/batch-index`, `/ai/search`, `/ai/translate-search`, `/ai/suggest-name-description`) still bypass the monthly spend cap that #197 made the only guardrail for Pro/Enterprise users — a real denial-of-wallet gap. The biggest user-facing risk is a **stale-deploy footgun**: a fire-and-forget chunk prefetch in `App.jsx` surfaces a sticky "Something went wrong" toast to every user with an old tab open after a deploy. Two flows are honest-to-goodness dead ends (session-expired content pane with no login button; a documented Postgres scale-out path that cannot boot). Teams remains the weakest product area: member "invites" are silent simulations and billing is strictly per-individual, so Enterprise doesn't actually cover a team. Everything else is small-radius polish — one WCAG contrast slip, a handful of motion/token drift items, and four deployment/ops gaps that block serious self-hosted adoption.

---

## 2. FIX NOW — confirmed problems

### High

1. **AI indexing/search endpoints bypass the monthly spend cap** [verified] — `server/routes/ai/indexing.js:82-86, 290-294, 154`. `POST /ai/index`, `POST /ai/batch-index` (up to 20 uncapped provider calls per request, repeatable) and `GET /ai/search` call `aiService.analyzeRepo()`/`embedText()`/`semanticSearch()` directly — `checkAISpendCap`/`recordAISpend` are never touched (grep-confirmed: only core/dev-toolkit/migration/shared reference them). For Pro/Enterprise, count quotas resolve to Infinity, so the spend cap is the *only* cost guardrail — and it never fires here. **Do:** wrap these calls with the `checkAISpendCap()` pre-check + `recordAISpend()` post-call pair (or route through `guardedGenerate`), and add a regression test mirroring `server/__tests__/ai-guarded-generate.test.js`. Effort M.

2. **`/ai/translate-search` and `/ai/suggest-name-description` also skip the spend cap** [verified] — `server/routes/ai/core.js:345-379` (calls `providerGenerateWithRetry` directly, no cap check unlike its sibling `/ai/chat`); `server/routes/ai/suggest-name-description.js:195` (calls `provider.generate()` with no spend accounting at all when a provider is configured). **Do:** route translate-search through `guardedGenerate()`; add the manual cap/record pair to suggest-name-description (its deterministic-fallback flow doesn't fit guardedGenerate). Effort S.

3. **Fire-and-forget CommandPalette prefetch turns deploy-stale tabs into a sticky error toast** [verified] — `src/App.jsx:229-237`. The idle warm-up `import('./components/CommandPalette')` has no `.catch`. A failed chunk fetch (most commonly an old tab after a new deploy invalidates hashed chunk URLs) escalates to the global `unhandledrejection` handler (`src/main.jsx:49-57`), is NOT filtered by `BENIGN_NOISE_PATTERNS` (`src/utils/errorClassification.js:32-36`), and renders ToastProvider's sticky duration-0 "Something went wrong" toast (`src/contexts/ToastProvider.jsx:158-189`). **Do:** add `.catch(() => {})` to the warm-up import; audit for other bare background `import()` prefetches. Effort S.

4. **Session-expired content pane is a dead end** [verified] — `src/components/RepoList/RepoStates.jsx:24-37`. The `AUTHENTICATION` branch of ErrorState renders text only ("Session Expired… Please login again") with no button, while the sibling generic branch has "Try Again" and BACKEND_UNAVAILABLE has instructions. Once the dismissible SessionBanner is closed, the user has no in-app path to re-authenticate. **Do:** thread an `onLogin` prop (App.jsx already has `handleLogin`) into `RepoStates.ErrorState` and render a primary "Log in again" button in that branch. Effort S.

5. **PostgreSQL adapter is non-functional at boot; docs present it as supported** [verified] — `server/db.js:21-51`, `server/index.js:64` (unawaited `initDB()`), `server/lib/adapters/postgres-adapter.js:141-166`, `server/migrations/README.md`. `initDB()` runs SQLite-only DDL (`AUTOINCREMENT`, `PRAGMA table_info`) verbatim; the async Postgres adapter returns Promises the sync call sites treat as arrays — `DATABASE_URL=postgres://…` throws on the very first `PRAGMA` call. The adapter's comment points at "separate PostgreSQL migration files" that the migrations README confirms don't exist; no CI job exercises Postgres. Meanwhile `docs/operations.md` tells operators to just use Postgres backup tooling. **Do:** either finish the path (dialect-branch DDL, await initDB, CI job with a postgres service container) or remove the `postgres://` branch and the operations.md guidance until it's real. Effort L (honesty fix: S).

6. **Team "invite" is fully silent — the code calls it a simulation** [verified] — `server/routes/teams.js:133-183` ("// Add Member (Simulated Invite by Username)"). Adding a member inserts straight into `team_members` (creating a placeholder users row from the public GitHub profile if needed) with no email, no in-app notification, no consent step. **Do:** send a transactional email via the existing `server/lib/email.js` / Resend adapter (already used for license delivery) and/or an in-app notification on next login; at minimum document the silent behavior in `docs/architecture/teams.md`. Effort M.

7. **Light-mode contrast failure in WorkBoard empty state** [verified] — `src/components/WorkBoard/WorkBoardPage.jsx:114`. `text-slate-400 dark:text-slate-400` (identical both themes) on a white card is ~2.7:1, failing WCAG AA; siblings at lines 259/269 correctly use `text-slate-500 dark:text-slate-400`. Copy-paste slip. **Do:** change to `text-slate-500 dark:text-slate-400`. Effort S.

### Medium

8. **`useGitHub` action functions get a new identity every render, defeating the documented sidebarProps memoization** — `src/hooks/useRepos.js:175, 336, 378, 421`; `src/hooks/useGitHub.js:119-129`; `src/App.jsx:546-558`. `performAction`/`archiveRepos`/`deleteRepos`/`createRepo` are plain function declarations, then re-wrapped by `withOrgRefresh(fn)` in the hook body on every render — so the `sidebarProps` useMemo (whose comment claims it keeps the memo'd Sidebar from re-rendering) is invalidated every render. **Do:** `useCallback` the four functions in useRepos (matching `patchRepoLocal`/`refresh`) and memoize the `withOrgRefresh(...)` results in useGitHub. Effort M.

9. **Usage-quota check-then-increment TOCTOU race allows quota overrun under concurrency** — `server/lib/usage-meter.js:60-97`. `checkUsageLimit`/`checkAIFeatureLimit` read the count, but the increment happens after the slow provider call — N concurrent requests at `limit-1` all pass. Same race in `checkAISpendCap`/`recordAISpend`. **Do:** atomic guarded increment (`UPDATE … SET count = count+1 WHERE … AND count < ?`) before the provider call with compensating decrement on failure — the pattern `chargeMigrationQuotaTxn` in `server/routes/migration.js` already uses correctly. Effort M.

### Low

10. **Dashboard inbox archive/snooze trusts unvalidated `itemId` shape** — `server/routes/dashboard.js:34-86`. Parameterized (no injection) but any opaque string of any length is stored, allowing unbounded junk rows in `dashboard_inbox_state`. **Do:** validate against `^(pr|issue):[^/]+/[^#]+#\d+$` plus a length cap, 400 on mismatch. Effort S.

11. **Migration replace-retry / retry-lfs persists destructive config before the retry is known to start** — `server/routes/migration.js:614-647, 653-684`. If `engine.retryTask` throws before the task flips to running, `onConflict: 'replace'`/LFS-migrate config is already permanently persisted and silently inherited by later retries. **Do:** persist the config mutation only after the task transitions to running, or roll it back in the `.catch()` (mirror the execute handler's rollback at migration.js:499-506). Effort S.

12. **Duplicate global stats fetch on every login** — `src/hooks/useOrgs.js:156-172`. Two effects both react to `user` becoming truthy and both resolve to the same global-stats URL. **Do:** consolidate into one effect; org-scoped refetch only on explicit `selectedOrg` change. Effort S.

13. **Redundant mock-data init effect ignores the URL-seeded page** — `src/hooks/useRepos.js:78-90` vs `141-165`. The standalone mock-init effect always writes page-1 data that the page-aware effect immediately supersedes (and is wrong when `?page=N`). **Do:** delete the standalone effect. Effort S.

14. **Team workflow-runs fetch failure silently swallowed** — `src/components/Teams/TeamDetails.jsx:713-737`. `wfRes.ok` failure toasts + sets `actionsError`; `runRes.ok` failure silently renders empty/stale run history. **Do:** give `runRes` the same error treatment (or a scoped "runs failed to load" note). Effort S.

15. **GDPR erasure registry coverage relies on a runnable helper, not a confirmed CI gate** — `server/routes/user-data.js:148-189`. Registry currently looks complete and a test exists, but confirm the test calls `scanSchemaForUnclassifiedUserTables(db)` against the *production schema module* on every CI run — a fixture-only test keeps passing after a real migration adds an uncovered user-keyed table. **Do:** verify/add that assertion. Effort S.

---

## 3. IMPROVE — UI/UX polish worth doing

1. **WorkBoard's local EmptyState fork diverges from the canonical primitive** — `src/components/WorkBoard/shared/shared-ui.jsx:40`. Local re-implementation (same `data-testid`) differs on padding, icon tile, has no entrance motion and no CTA support, vs `src/components/ui/EmptyState.jsx` used by 29 files. **Do:** delete the fork, import the canonical component, map `subtitle`→`description`. Effort S.

2. **Command-palette shortcut glyph hardcoded to macOS for everyone** — `src/components/Header.jsx:120-129` renders `<kbd>Cmd K</kbd>` while its own tooltip says Ctrl+K; same Mac-only phrasing in `src/components/Onboarding/onboardingSteps.js:7` and `src/components/Roadmap/RoadmapPage.jsx:20`. The OS-aware `src/components/ui/Kbd.jsx` (`modifier="mod"`) already exists. **Do:** use `<Kbd modifier="mod">K</Kbd>` and OS-neutral onboarding copy. Effort S.

3. **MarksBadge hover translate violates the "no hover scale/translate" motion contract** — `src/components/MigrationHistory/MarksBadge.jsx:45`. Flat pill with `whileHover={{ y: -1 }}`; repo-wide grep found no other offenders — isolated regression vs the #202 motion pass. **Do:** drop whileHover/whileTap, rely on color/opacity transition like MigratedPill/TrackedChip. Effort S.

4. **Enterprise pricing card border hardcodes raw amber hex** — `src/components/Pricing/PricingCard.jsx:31`. Inline `linear-gradient(135deg, #f59e0b, #d97706, #eab308)` six lines below the Pro tier's correct `--ds-accent-brand` token usage; no light/dark variant. **Do:** add a `--ds-accent-enterprise` token pair (or Tailwind amber arbitrary values) and reference it. Effort S.

5. **CODEOWNERS suggestions table missing the horizontal-scroll wrapper** — `src/components/CodeownersSuggestModal.jsx:226-252`. The only `<table>` in src/components without `overflow-x-auto` (all 5 others were standardized in #202/#203); long mono glob paths force the modal/page to scroll horizontally. **Do:** wrap in `<div className="overflow-x-auto">` like WorkItemsStep/DLQTable. Effort S.

6. **Spring physics duplicated ad hoc instead of the SPRING vocabulary** — `src/components/ui/motion.js` vs `Pricing/PricingPage.jsx:363` (re-types SPRING.knob), `MigrationHistory/MarksDetailModal.jsx:65`, `MobileQuickActionsFab.jsx:126`, `MigrationWizard/steps/AIReviewStep.jsx:361/369`, `SummaryStep.jsx:140`, `PRReview/ReviewToolbar/ReviewStatusBar.jsx:98` — seven near-miss one-off stiffness/damping pairs. **Do:** import SPRING at these call sites; add genuinely new feels to motion.js as named exports. Effort M.

7. **Repo Settings save row not sticky on mobile** — `src/components/RepoDetail/SettingsTab.jsx:362-379`. Inline comment already scopes the fix ("mobile sticky version is a TODO follow-up"); long forms hide Save and the dirty-state indicator below the fold. **Do:** add the `md:hidden fixed bottom-0` sticky save bar per the slice-5 docs pattern. Effort S.

---

## 4. MISSING — what real users need before adoption

1. **Team/seat-based billing** — `server/db.js:354-365` (`user_subscriptions` keyed 1:1 on `user_id`), `server/middleware/require-tier.js:119-129`, `src/components/Pricing/FeatureComparison.jsx:103-110`. FeatureComparison sells tiered team sizes/AI quotas, but every quota resolves against the individual's own subscription — a Free engineer on an Enterprise team gets Free AI limits; a company cannot cover its team with one seat. **Do:** implement seat-based tier grants for `team_members`, or (short-term honesty fix) add an explicit "AI quotas are per individual account" disclaimer in FeatureComparison + `docs/billing-and-licensing.md`. Effort L (disclaimer: S).

2. **No metrics/APM surface for production operability** — `server/lib/monitoring.js`; no prom-client/OpenTelemetry in package.json. Self-hosters get "is it up" (/live, /ready) and "did an exception fire" (Sentry) but no latency percentiles, throughput, or error-rate dashboards/alerting. **Do:** minimal prom-client `/metrics` (request-duration histogram, in-flight, DB timings) behind admin auth or a private port, documented in docs/operations.md. Effort M.

3. **Reverse-proxy / TLS example for self-hosters** — `docker-compose.yml`, `docs/operations.md`, `server/index.js:75` (`trust proxy, 1`). Production requires HTTPS cookies and assumes exactly one TLS-terminating hop, but no nginx/Caddy/Traefik example ships anywhere. **Do:** add a ~5-line Caddy auto-TLS snippet (or docker-compose.proxy.yml override) and document what breaks when the hop count doesn't match. Effort S.

4. **Orphaned `vercel.json` implies a one-click deploy that 404s** — `vercel.json` builds the static frontend only; better-sqlite3, express-session and SSE are incompatible with Vercel serverless as structured, and the file is referenced nowhere in README/docs. **Do:** delete it, or add a README note that it is frontend-only and the backend must be hosted separately. Effort S.

---

## 5. WOW roadmap — prioritized ideas

Quick wins first, then differentiators.

| # | Idea | Area | Effort | Notes |
|---|------|------|--------|-------|
| 1 | **Proactive "next action" chip atop the Command Palette** — one best-guess suggestion ("3 PRs need your review — Enter to open") pinned above recents on empty query | `src/components/CommandPalette.jsx`, `useCommandPalette.jsx` | S | Palette is currently cold-start; signals (route, risk, recency) already exist |
| 2 | **DORA benchmark bands + live pulse** — overlay Google Elite/High/Medium/Low bands behind the 4 KPI cards; subtle pulse on new deploy/incident via existing SSE | `src/components/WorkBoard/tabs/DORATab.jsx` | S | Today: flat KPI cards + plain polyline |
| 3 | **Audio standup** — play button that reads the existing AI narrative via browser SpeechSynthesis; zero AI cost, no backend change | `Dashboard/Premium/InboxPanel.jsx`, `WorkBoard/AISummaryCard.jsx` | S | |
| 4 | **Celebratory micro-interaction** on inbox-zero and clean migration completion, gated by `MotionConfig reducedMotion` | `ui/AnimatedCheck.jsx`, `ui/motion.js` | S | No celebration pattern exists anywhere yet |
| 5 | **Risk-colored diff minimap rail** — heat rail along the PR diff edge from existing PRRiskBadges hunk data; click to jump | `PRReview/DiffPanel/*`, `RepoDetail/PRRiskBadges.jsx` | M | Risk data is computed but never rendered as an overview |
| 6 | **Live presence** — avatar stack of teammates viewing this repo/PR/team, over a lightweight SSE heartbeat channel | `src/hooks/useSSE.js`, `Teams/TeamHub.jsx`, `PRReview/PRReviewView.jsx` | M | Reuses existing SSE plumbing; pairs with fixing the silent invite |
| 7 | **Command-palette recipe macros** — record a sequence of registered actions, name it, bind to a favorite slot | `CommandPalette.jsx`, `CommandPalette/recents.js`, `config/keyboardShortcuts.js` | M | Raycast-style differentiator |
| 8 | **Ambient fleet health heatmap** — tint dashboard org/category sections with a live green→red glow from aggregated RepoHealthBadge/risk data | `Dashboard/WhatNeedsYouGrid.jsx`, `AI/RepoHealthBadge.jsx` | M | |
| 9 | **Cross-repo PR/issue dependency graph** — parse cross-references, render a blocking DAG across the fleet in WorkBoard | `WorkBoard/WorkBoardPage.jsx`, `hooks/useWorkBoard.js` | L | Plays to the app's actual differentiator (fleet, not single repo) |
| 10 | **Migration flight-recorder** — persist the per-job SSE event stream and expose a scrubbable replay timeline in MigrationHistory | `server/db.js` (migration_jobs/marks), `MigrationHistory.jsx` | L | Trust/auditability is the migration product's core value |

---

## 6. Appendix — refuted or duplicate findings

**Refuted by skeptic pass:** none — every finding submitted for verification was confirmed.

**Duplicates vs. the already-known/remediated list (excluded from main sections):**

- *Icon-only buttons use native `title=` tooltips instead of ui/Tooltip* (ui-consistency panel, 235 uses across 103 files) — duplicate of the known "Native title= tooltips (154 sites) coexist inconsistently with ui/Tooltip" item from prior audits; counts have grown but the finding is not new. Prior guidance stands: swap the highest-traffic row-action buttons, default new icon-only buttons to Tooltip.

**Precision notes on confirmed findings:**

- In finding FIX-1, the skeptic noted `findSimilarById` is a pure DB cosine-similarity lookup (no provider call) — the uncapped surface for `/ai/search` is its `semanticSearch → embedText` path only. Core claim unaffected.
- The GDPR erasure item (FIX-15) is a *soft flag* — the registry currently matches the schema; only the CI-gate wiring needs confirming. The original critical GDPR-erasure gap from the 2026-06-20 audit remains tracked separately.
