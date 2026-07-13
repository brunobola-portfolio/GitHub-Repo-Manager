# UI/UX, Consistency & Functionality Audit — 2026-07-12

## 1. Executive Summary

The application is in fundamentally good health: an adversarial verification pass was run against every high-impact claim, no critical-severity finding survived, and zero claims were fully refuted — but three were downgraded and five highs were confirmed as reported. The dominant theme is not missing infrastructure but **inconsistent adoption of infrastructure that already exists**: the confirm-gate registry, the usage-meter, the request-generation guard pattern, `formatUserError`, PageShell/`--layout-max-w`, and the design tokens are all built and proven, yet specific high-traffic surfaces bypass each of them. The most consequential issues are (1) one-click, no-confirmation PR merge/close in the detail panel — the primary surface for those actions — while list rows are confirm-gated; (2) a missing staleness guard in every parameterized Work Board data hook, letting filter changes silently display data for the wrong query; and (3) four AI-invoking backend endpoints that sit entirely outside tier gating and spend accounting, exposing the operator's LLM bill. On the monetization path, the sole Upgrade CTA on six tier-gated Work Board tabs and several toast actions is a silent dead link due to a `#pricing` vs `#/pricing` hash mismatch, though other major upgrade paths work correctly. Layout-wise, primary nav destinations disagree on page width (2400px vs 1152px vs 1280px), visibly undoing the documented 2026-06-25 shell-width work. Everything found is fixable in small, well-scoped PRs; none touch `.github/workflows/`, so no owner-merge bottleneck applies, though the backend slices require a server restart to activate.

## 2. Scorecard

| Area (specialist) | Critical | High | Medium | Low | Assessment |
|---|---|---|---|---|---|
| UX states, destructive actions & a11y | 0 | 2* | 3 | 1 | Excellent primitives (ConfirmModal, toast, EmptyState) — but detail panels and one tab skipped them entirely |
| Frontend functional (hooks/data races) | 0 | 1 | 1 | 1 | One recurring defect pattern (no request-generation guard); the fix pattern already exists in-repo |
| Backend functional (auth, quota, rate limits) | 0 | 2 | 1 | 0 | Gating/metering machinery is solid but several AI surfaces and the 'ai' scope sit outside it |
| Copy, i18n & honesty | 0 | 1 | 1 | 2 | Pricing parity is unusually well-tested; the dead pricing-CTA hash is the one real gap |
| Design consistency (tokens, motion, primitives) | 0 | 1* | 4 | 2 | Tokens and motion vocabulary exist and are documented; a handful of surfaces hardcode around them |
| Premium polish (layout, page chrome) | 0 | 1 | 4 | 0 | One genuine layout-contract violation; the rest is chrome-uniformity drift |

\* The Live Inbox error-state finding was reported jointly by ux-states-a11y and design-consistency (counted once under UX states, marked in both rows).

Totals: **0 critical, 5 confirmed high, 2 downgraded-to-high, 1 downgraded-to-medium, 13 unverified medium/low backlog items, 0 refuted.**

## 3. Confirmed Findings

All findings in this section were **adversarially verified**: a second pass independently re-checked every cited file and line against the working tree and attempted to refute each claim. All five survived at their reported severity.

### 3.1 Merge/close PR and close/reopen issue skip confirmation entirely from the Detail Panels — HIGH

- **Area:** UX states / destructive actions
- **Files:** `src/components/RepoDetail/PRDetailPanel.jsx`, `src/components/RepoDetail/IssueDetailPanel.jsx`, `src/components/RepoDetail/PullRequestsTab.jsx`, `src/components/RepoDetail/IssuesTab.jsx`, `src/actions/prActions.js`, `src/actions/issueActions.js`
- **Evidence:** `prActions.js:126-145` (merge_pr) and `:148-167` (close_pr) declare `confirm` blocks, and `PullRequestsTab.jsx:102-131` routes list-row actions through the ConfirmModal (`:349-357`). But `PRDetailPanel.jsx:101-119` (`handleMerge`) and `:121-133` (`handleClose`) call `api.mergePull`/`api.updatePull` directly on click (buttons at `:330`, `:341`). Neither detail panel imports ConfirmModal, confirmGate, or the action registries (grep-verified). `IssueDetailPanel.jsx:76-88` mutates issue state with no confirm.
- **Impact:** One accidental click in the detail view — the primary surface for these actions — merges (squash/rebase: practically irreversible) or closes a PR with zero prompt, while the identical action from the list row asks "Merge PR #N?". Verification nuance: for **issues**, `IssuesTab.jsx:95-110` deliberately skips the confirm gate on list rows too ("existing UX has been confirmless"), so the list-vs-detail inconsistency holds only for PRs; the issue-side inconsistency is registry-declared-confirm vs. all inline UI.
- **Fix:** Route `PRDetailPanel` handleMerge/handleClose through the prActions registry + ConfirmModal exactly as `PullRequestsTab.jsx:99-131` already demonstrates. For issues, first decide the source of truth (IssuesTab's "confirmless by design" comment vs. the registry's `close_issue.confirm` declaration), then align both surfaces.

### 3.2 Work Board data hooks have no request-cancellation/staleness guard — filter changes can commit data for the wrong query — HIGH

- **Area:** Frontend data race
- **Files:** `src/hooks/useWorkBoard.js`, `src/components/WorkBoard/tabs/StalePRsTab.jsx`
- **Evidence:** `useWorkBoardFetch` (`useWorkBoard.js:37-137`) has no AbortController and no generation counter; the sole guard is `mountedRef`, which verification proved **ineffective against url changes**: when `staleAfterDays` changes, the effect cleanup sets `mountedRef.current = false` (`:130`) and the new setup synchronously sets it back to `true` (`:102`) in the same commit, so a still-pending fetch for the old url passes the `:80` check and overwrites data/meta. `StalePRsTab.jsx:151-152, 189-196` wires a user-facing Select into the url with no cancellation. Verification also found the same defect in every parameterized hook in the file — `useDORAMetrics`/`useDORASummary` (`:156-164`), `useTechDebt`/`useReviewLoad` (`:166-174`), `useKpiSnapshots` (`:176-179`) — plus aggravators: the 60s auto-refresh interval (`:107-109`) and visibilitychange refetch (`:122`) can each strand an old-url fetch across a filter change.
- **Impact:** Flipping "Stale after" 7 → 30 → 7 with out-of-order responses leaves the dropdown showing one threshold while the list silently reflects another, with no error — a correctness bug on the Pro-tier Stale PRs surface, replicated across five hooks.
- **Fix:** Add a request-generation guard; the exact pattern already exists in-repo at `useYourWork.js:74-90` (`fetchIdRef`) and `useHostAllowlist.jsx:17-49` (`requestSeq`). Optionally pass an AbortController signal into `apiFetch`.

### 3.3 Live Inbox load-failure state is a raw dead-end error string with no retry and no dark-mode variant — HIGH

- **Area:** UX states + design consistency (joint finding)
- **Files:** `src/components/Dashboard/Premium/InboxPanel.jsx`, `src/hooks/useInbox.jsx`, `src/design-system.css`
- **Evidence:** `InboxPanel.jsx:186` renders `<p className="p-6 text-sm text-red-600">{String(error.message || error)}</p>` — no `formatUserError`, no retry, no `dark:` variant. `jsonFetch` (`src/api/dashboardInbox.js:63-70`) surfaces raw strings like "Failed to fetch". `useInbox.jsx` exposes `refresh()` (returned at `:128`) but the panel never destructures it (`:32`). The same component ships a polished AIQuotaExhaustedCard (`:161-170`), skeletons, and per-section empty copy; the canonical fix pattern exists one directory up (`MigrationActivity.jsx:108-116`: EmptyState + Retry). Verification additionally measured red-600 on the panel's dark canvas at ~3.7:1 contrast — below WCAG AA 4.5:1, in a repo whose CI hard-gates axe color-contrast to 0 (the gate simply never reaches this error state).
- **Impact:** Any transient failure (expired session, server hiccup) strands the user on the flagship Premium panel with a raw exception string in an accessibility-failing color and no recovery short of a full page reload.
- **Fix:** Render an EmptyState-style error card through `formatUserError` (`src/utils/errors.js:370`) with a "Try again" button bound to `refresh()`, using `text-red-600 dark:text-red-400`.

### 3.4 'ai' API-key scope is offered in the UI but never enforced — an ['ai']-only key cannot call any AI endpoint — HIGH

- **Area:** Backend authorization
- **Files:** `server/middleware/api-key-auth.js`, `server/routes/api-keys.js`, `src/components/Settings/ApiKeysSection.jsx`
- **Evidence:** `api-keys.js:13` accepts scope `'ai'` and `ApiKeysSection.jsx:16-21` presents it as an independent checkbox ("Access AI features and queries"). But `api-key-auth.js:98-102` gates every mutating request on write/admin only, and `requireScope()` (`:114-120`) — defined and unit-tested — is applied to **zero routes** (repo-wide grep: only the middleware, its tests, and docs). All AI generation endpoints are POSTs (`server/routes/ai/core.js:127, :384, :442`, dev-toolkit, migration, indexing), CSRF explicitly exempts `grm_live_` bearers (`csrf.js:126`), so the write-scope gate is the operative barrier: an ['ai']-only key gets 403 "lacks the required write scope" before reaching AI logic. Verification confirmed the scope is inert in both directions — it grants nothing on POSTs and restricts nothing on GETs.
- **Impact:** A user who deliberately scopes a key to AI-only — exactly the least-privilege behavior the Settings UI invites — finds every AI feature broken for that key, with a misleading error; the only workaround (adding write) defeats the purpose of scoping.
- **Fix:** Wire `requireScope('ai')` onto the AI POST routes (it already passes session users through), or remove the 'ai' option from the schema/UI until enforced. Requires backend restart.

### 3.5 Primary nav destinations disagree on page width: Dashboard/Repos go full-bleed while Work Board and Teams clamp to two different narrower columns — HIGH

- **Area:** Layout consistency
- **Files:** `src/index.css`, `src/App.jsx`, `src/components/Dashboard/DashboardShell.jsx`, `src/components/WorkBoard/WorkBoardPage.jsx`, `src/components/Teams/TeamHub.jsx`, `src/components/ui/PageShell.jsx`
- **Evidence:** `App.jsx:670` wraps all views in `max-w-[var(--layout-max-w)]`; `index.css:60` sets it to 2400px with a comment (`:56-59`) documenting the 2026-06-25/2026-07-06 decision to remove dead gutters on 2560px displays. Dashboard and Repos add no inner cap, but `WorkBoardPage.jsx:247` nests `<PageShell maxWidth="2xl">` (max-w-6xl = 1152px) and `TeamHub.jsx:127` `<PageShell maxWidth="3xl">` (1280px) inside the same shell. All four are sibling tabs in the primary nav (`Header.jsx:149-156`).
- **Impact:** At 1920px+ (and especially the 2560px displays the shell work was measured for), navigating Dashboard → Work Board snaps content from up to 2400px to a centered 1152px column (~380-620px dead gutter per side); Teams clamps to 1280px, matching neither. Verification identified the root cause as **two conflicting documented decisions**: PageShell's docstring (`PageShell.jsx:24-35`) standardizes pages on max-w-6xl from an earlier audit, while the later shell work widened the app to 2400px.
- **Fix:** Reconcile the two contracts — remove/widen the nested PageShell caps so Work Board and Teams inherit `--layout-max-w`, or explicitly document a deliberate narrower reading column in PageShell's docstring.

## 4. Downgraded Findings

Verified real, but the adversarial pass corrected the severity.

### 4.1 AI-invoking endpoints bypass all tier gating and usage-meter accounting — CRITICAL → HIGH

- **Files:** `server/routes/work-board-actions.js`, `server/routes/repos/actions-community.js`, `server/middleware/work-board-ai-gate.js`, `server/lib/usage-meter.js`
- **Confirmed core:** `/suggest-action` (`work-board-actions.js:345-386`), `/ai-summary` (`:275`), `/draft-comment` (`:388`), and `/community-health/generate` (`actions-community.js:524`) all call the LLM provider with no `requireTier`, no `checkUsageLimit`/`incrementUsage` (files never import usage-meter), while every sibling AI route (deep-review, pr-chat, indexing, dev-toolkit, migration, work-board-ai `/interpret`) is uniformly gated and metered. `/suggest-action`'s only guard is a 30-min cache keyed by attacker-controlled body values, and the route never verifies the item exists — unique keys mean fresh LLM calls on demand.
- **Why downgraded:** "Unlimited" was overstated: prod applies a global 200 req/15min/IP limiter (`server/index.js:213-214`, `tenant-rate-limit.js:92-98`); `/ai-summary` is effectively ~1 call/5min/user via cache+cooldown; `/draft-comment` has a 10/hr per-user limiter (`:95-103` — the original claim of "30/hr at line 51" was factually wrong); operator cost exposure requires a server fallback key (BYOK-only deployments shift cost to the user). The genuinely unbounded-per-user endpoints are `/suggest-action` and `/community-health/generate`. Real gating bypass + rate-shaped cost exposure + pricing-honesty inconsistency (Free users get AI that Pro-gated siblings charge for) = high, not critical.
- **Fix:** Add `checkUsageLimit`/`incrementUsage` (or route through `requireWorkBoardAI`) to all four endpoints; add a real per-user rate limiter to `/suggest-action`. Requires backend restart.

### 4.2 Upgrade/See-plans pricing CTAs are silent dead links — hash mismatch `#pricing` vs `#/pricing` — CRITICAL → HIGH

- **Files:** `src/hooks/useAppRouter.js`, `src/contexts/ToastProvider.jsx`, `src/components/states/UpgradeRequired.jsx`, `src/components/states/FeatureState.jsx`, `src/utils/errors.js`, `src/components/WorkBoard/shared/shared-ui.jsx`, `src/components/Settings/AuditLogSection.jsx`
- **Confirmed core:** the router only registers `#/pricing` (`useAppRouter.js:57-67`) and ignores unknown hashes; `ToastProvider.jsx:19-20` dispatches `#pricing`, and `UpgradeRequired.jsx:41` / `FeatureState.jsx:24` default `pricingHref='#pricing'` with **zero callers overriding** (grep-verified). Dead surfaces: the sole CTA on six tier-gated Work Board tabs via UpsellCard, the gated states in Settings Audit Log/AI Config, and four tier-required toast actions (`errors.js:128/:133/:244/:259`). Clicks rewrite the fragment and nothing happens.
- **Why downgraded:** "Every pricing CTA / entire monetization path" was refuted — multiple major upgrade paths work correctly via the app event bus: `QuotaUpgradeButton` (`navigateToPricing()`), `AIErrorState` (`openBilling()`), the QUOTA_EXCEEDED toast (quota modal), Header nav, CommandPalette, RoadmapPage. Pricing remains reachable; no data loss or security impact.
- **Fix:** Change the two component defaults to `#/pricing`; for ToastProvider prefer emitting `navigateToPricing()` (`appEvents.js:169`) over hash mutation — the codebase's own comment at `useAppEventBridge.js:65-67` calls direct hash mutation an anti-pattern. Add the proposed regression test asserting every pricing-CTA hash literal matches a registered route (none exists today).

### 4.3 CommitsTab nests an anchor inside a `<motion.button>` — HIGH → MEDIUM

- **Files:** `src/components/RepoDetail/CommitsTab.jsx`
- **Confirmed core:** `CommitsTab.jsx:100-151` wraps each commit row in a button; `:138-150` renders an `<a target="_blank">` inside it — the canonical axe nested-interactive violation and invalid HTML. Siblings `IssuesTab.jsx:213-226` and `PullRequestsTab.jsx:290-303` already use the stretched-overlay pattern with comments saying it replaced exactly this bug.
- **Why downgraded:** the "icon click also triggers row onClick" claim is false — the anchor has `stopPropagation` (`:143`), so the mouse path works today; the axe CI gate never scans the Commits tab (`e2e/a11y-smoke.spec.js:26-109`), so this is an unscanned leftover, not a gate regression; and the project's own 2026-07-05 readiness panel rated this defect class medium. Harm is limited to screen-reader announcement/focus inconsistency on one tab.
- **Fix:** Convert to the overlay-anchor pattern used by IssuesTab/PullRequestsTab, and add the Commits tab to the axe smoke-scan list.

## 5. Medium/Low Polish Backlog (unverified)

These came from the specialist sweep but did not go through the adversarial verification pass — treat file:line refs as strong leads, not proven facts.

**Design system & tokens**
- Medium — `.ds-scrollbar` defined twice with conflicting behavior; the layered `index.css:209-265` version is dead code (unlayered `design-system.css:292-299` always wins under cascade-layer semantics). Delete one; design-system.css is the canonical ds-* home.
- Medium — Chart/gauge strokes hardcode raw hex instead of the theme-aware `--ds-chart-series-*` tokens ActivityChart already uses (`KpiRow.jsx:70-73`, `AISummaryCard.jsx:30`, `CommunityHealthDashboard.jsx:55-58`).
- Medium — RepoDetail header (`RepoDetail.jsx:163-181, :204-211`) and `MigratedPill.jsx` hand-roll status pills instead of the canonical `ui/Badge.jsx`, forfeiting its AA-contrast guarantees.
- Low — DORATab KPI number (`DORATab.jsx:40`) drops `ds-font-display`/`tabular-nums` that sibling `KpiRow.jsx:113` uses; digits shift width on update.

**Motion**
- Medium — Landing `PricingPreview.jsx:79` uses a spring translate on hover, violating the documented "ease-only, no translate" contract (`motion.js:16-18`, `design-system.css:221`) that the real Pricing page follows.
- Medium — `RepoGrid.jsx:46-60` never exit-animates filtered-out cards, unlike the MigrationWizard's equivalent list (`RepoSelectStep/RepoList.jsx:15-27` uses AnimatePresence).
- Low — Framer durations widely re-hardcoded as literals matching DURATION constants verbatim (`AIAssistant.jsx:410/:447`, `StatCard.jsx:52,70`, `PRDetailPanel.jsx:160`, 100+ files); zero visual divergence today, pure maintainability sweep.

**UX states & error handling**
- Medium — j/k row navigation (`useFocusedRow.js:44-47`) keeps firing while a ConfirmModal is open; `InboxPanel.jsx:109-112` already has the `[role=dialog]` guard that never propagated to useFocusedRow's five consumers.
- Medium — `SettingsTab.jsx:217-226` webhook loader swallows fetch errors with an empty catch while every sibling handler in the same file uses `toast.errorFromException`.
- Low — `ActionsTab.jsx:37-45` sync-failure catch comment claims "load() will surface the error" but load() re-fetches independent endpoints that typically still succeed; sync failures are invisible.

**Frontend data integrity**
- Medium — DevToolkit `fetchBranches` (`useDevToolkit.js:45-56`) has no cancellation; quick repo switching via `RepoBadge.jsx:87` can populate branches/baseBranch for the wrong repo. `fetchCompare` in the same file already has the abortRef pattern to copy.
- Low — `usePRData.js:13-46` writes the shared cache keyed by a mutable ref read at resolve time; dormant (sole call site passes `enabled: false`) but will cross-contaminate PR caches the moment anyone enables it.

**Backend**
- Medium — The per-tier 'ai' rate-limit bucket (`tenant-rate-limit.js:6-22`, prod free=10/15min) is dead code: `server/index.js:273-274` only instantiates 'api' and 'auth'. Instantiate and mount `aiLimiter` on AI route groups (pairs naturally with finding 4.1).

**Layout & page chrome**
- Medium — CommitsTab and ActionsTab skip the `SectionPanel` primitive all four sibling RepoDetail tabs use (`CommitsTab.jsx:82-93`, `ActionsTab.jsx:96-129`).
- Medium — Settings tabs alternate between `PanelHeader` (AIConfig, AIInstructions, WorkBoard) and hand-rolled icon-badge headers (`ApiKeysSection.jsx:404-410`, `AuditLogSection.jsx:105-111`, `LicensePlanSection.jsx:380-386`).
- Medium — PR review Walkthrough file table (`WalkthroughTab.jsx:83-100`) has no overflow handling inside its fixed 320px column, unlike every other table (`AuditLogSection.jsx:172`, `DLQTable.jsx:66-69`).

**Copy, docs & i18n**
- Medium — `docs/index.md:12/:143` says "~280 endpoints / 50 route modules"; the linked `docs/api/API.md:8` says ~310, and actual count is 309 handlers across 70 files.
- Low — Command Palette group headings mix Title Case and sentence case (`CommandPalette.jsx:472 vs :647/:662/:677`); `AdminDLQPage.jsx:170` "Dead-letter Queue Admin" mixes casing.
- Low — Four Portuguese JSX comments remain in `OrgPanel.jsx:251/:258/:265/:303` (invisible to the anti-PT guard, which strips comments); rendered text is English.

## 6. Refuted Claims

None. Every claim submitted to adversarial verification was confirmed or downgraded; no finding was thrown out. (Individual sub-claims corrected during verification are noted inline above: the issues-list confirm parity in 3.1, the draft-comment limiter figure in 4.1, the "every pricing CTA" universality in 4.2, and the click-propagation claim in 4.3.)

## 7. Suggested Fix Order (PR slices)

Small, reviewable PRs grouped by file locality, highest severity first. None touch `.github/workflows/`, so no owner merge is required for any slice. PRs 5 and 6 touch `server/` and **require a backend restart to activate**.

1. **PR 1 — Confirm-gate the detail panels** (`src/components/RepoDetail/PRDetailPanel.jsx`, `IssueDetailPanel.jsx`, `src/actions/*`): route merge/close through the prActions registry + ConfirmModal per the PullRequestsTab pattern. Decide the issue-confirm source of truth first (one-line decision, document it in the action registry). Fixes 3.1.
2. **PR 2 — Request-generation guards** (`src/hooks/useWorkBoard.js`, `useDevToolkit.js`, `usePRData.js`): transplant the `fetchIdRef` pattern from `useYourWork.js` into all five parameterized Work Board hooks; mirror `fetchCompare`'s abortRef into `fetchBranches`; capture the key in usePRData's closure. Same defect class, one PR. Fixes 3.2 + two backlog items.
3. **PR 3 — Pricing CTA hash fix** (`ToastProvider.jsx`, `UpgradeRequired.jsx`, `FeatureState.jsx`, + regression test): two default changes plus `navigateToPricing()` in ToastProvider; test asserts every pricing-hash literal is a registered route. Tiny, high-value. Fixes 4.2.
4. **PR 4 — Inbox error state** (`InboxPanel.jsx`): EmptyState-style error card via `formatUserError` + Retry bound to the hook's existing `refresh()`, with dark variant. Fixes 3.3.
5. **PR 5 — Backend: AI metering + 'ai' limiter** (`server/routes/work-board-actions.js`, `server/routes/repos/actions-community.js`, `server/index.js`): wire `checkUsageLimit`/`incrementUsage` into the four unmetered endpoints, add a per-user limiter to `/suggest-action`, and instantiate/mount the dead 'ai' tenant-limit bucket. **Backend restart required.** Fixes 4.1 + the dead-limiter backlog item.
6. **PR 6 — Backend: enforce (or remove) the 'ai' key scope** (`server/middleware/api-key-auth.js` consumers, `server/routes/ai/*` or `server/routes/api-keys.js` + `ApiKeysSection.jsx`): wire `requireScope('ai')` onto AI POSTs, or drop the option until enforced. **Backend restart required.** Fixes 3.4.
7. **PR 7 — Page-width reconciliation** (`WorkBoardPage.jsx`, `TeamHub.jsx`, `PageShell.jsx` docstring): remove/widen the nested PageShell caps and reconcile the PageShell docstring with the 2400px shell decision. Verify at 1920/2560. Fixes 3.5.
8. **PR 8 — RepoDetail sweep** (`CommitsTab.jsx`, `ActionsTab.jsx`, `SettingsTab.jsx`): overlay-anchor pattern for commit rows (+ add Commits tab to the axe smoke scan), SectionPanel wrappers for Commits/Actions, `toast.errorFromException` in the webhook and sync catches. One directory, four backlog items + 4.3.
9. **PR 9 — Modal keyboard guard** (`useFocusedRow.js`): extend InboxPanel's `[role=dialog]` guard into the hook so j/k stops leaking through ConfirmModal for all five consumers.
10. **PR 10 — Design-token/motion consistency** (`index.css`/`design-system.css` scrollbar dedupe, chart-token routing in KpiRow/AISummaryCard/CommunityHealthDashboard, PricingPreview whileHover removal, DORATab typography, RepoGrid AnimatePresence).
11. **PR 11 — Chrome uniformity** (Settings PanelHeader standardization, Walkthrough table overflow, Badge adoption in RepoDetail header/MigratedPill).
12. **PR 12 — Docs & copy** (`docs/index.md` counts, Command Palette/DLQ casing, OrgPanel PT comments; optional low-priority DURATION-constant sweep as a follow-up or fold into touched files opportunistically).

## 8. Coverage Notes per Specialist

All six specialists completed successfully; no failed agent, so no fully uncovered domain. Two returned no coverage notes, which limits confidence about what they did *not* sweep.

- **design-consistency (ok):** Full reads of design-system.css, index.css, motion.js, and the core ui primitives; repo-wide greps for hardcoded hex/rgb, arbitrary Tailwind values, inline Framer literals, and bespoke Badge/Tooltip/Spinner markup; targeted reads across RepoList, Dashboard (incl. Premium Inbox), WorkBoard, Landing/Pricing, Setup. Explicitly ruled out several false positives (LanguageChart's GitHub hex map, RepoCard's justified inline rgba, SystemSetup's always-dark splash, white-tint overlays, the RefreshCw spin affordance). **Not reached:** line-by-line dark-mode audit of Teams/, Settings/AIConfig/, PRReview/DiffPanel/, DevToolkit/ (grep + spot checks only); MigrationWizard radius/shadow beyond two steps; Roadmap/, FeatureComparison, Admin/ beyond grep.
- **ux-states-a11y (ok):** Deep-read all RepoDetail tabs, both detail panels, the action registries, Modal/ConfirmModal/useFocusTrap/useFocusedRow/useKeyboardShortcuts, AIAssistant + useAI, the Premium Live Inbox, and the migration Progress/ReplaceConfirm flows (found those solid — good loading/error/retry and type-to-confirm on Replace). **Not reached:** DashboardPremium.jsx lines 120-574 and its child panels (TodayPanel, AttentionFeed, WhatNeedsYouGrid, MigrationActivity, etc.); most MigrationWizard steps beyond Progress (BulkActions/MigrationHistory sampled only); AIIssuePlanner, IssueSidebar, PRFilesTab, InlineEditField, CommitDetailPanel; most of src/hooks/ beyond those named.
- **frontend-functional (ok):** All of src/contexts/, appEvents.js + every consumer (confirmed no window CustomEvent violations and matching cleanups), useGitHub-vs-App destructuring verified, ~30 of 65 hooks read in full; both race findings traced to their live UI triggers. **Not reached:** ~34 hooks (list provided in raw notes — incl. useAuth, useKeyboardShortcuts, useFocusedRow, useDangerAction); App.jsx read only around router/useGitHub wiring; src/utils beyond appEvents/aiFetch (retry-queue, api.js, errors.js unread); no systematic client-tier-check vs `server/require-tier.js` cross-reference — flagged as needing a dedicated pass.
- **backend-functional (ok, no notes provided):** Produced two verified high findings (the 'ai' scope and the AI metering bypass) plus the dead 'ai' limiter — but returned no coverage notes, so the extent of the sweep across the ~310-handler surface (auth flows, migration engine, webhooks, teams, admin) is **unknown**; treat unlisted backend areas as unaudited rather than clean.
- **copy-i18n-honesty (ok):** Full PT sweep of src/ (accented-char + word greps, cross-checked against the anti-PT guard's scope); pricing/tier honesty cross-checked across FeatureComparison, feature-flags.js, README, and the parity test — found consistent (this surface is unusually well-audited already); all 22 docs/index.md link targets verified on disk; the pricing-hash bug fully traced through router, dispatchers, and all call sites. **Not reached:** endpoint-by-endpoint API.md diff beyond the total count; the README's described mobile bottom-nav ("Home/Repos/Work/Teams/More") could not be located by grep and was not audited; the "5,200+ unit tests" badge unverified (long local runs avoided per project preference); e2e specs and server-side notification templates; exhaustive Settings button-label casing; CHANGELOG/ROADMAP line-by-line.
- **premium-polish (ok, no notes provided):** Produced the confirmed page-width finding and four chrome-uniformity backlog items, but returned no coverage notes — breadth across PRReview, Teams, DevToolkit, and mobile viewports is **unknown**; treat as partially covered.
