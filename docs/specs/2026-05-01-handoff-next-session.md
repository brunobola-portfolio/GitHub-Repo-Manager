# UX Uniformity Initiative — Handoff for next session

**Last updated:** 2026-05-01 (end of session)
**Owner:** Bruno
**Status:** All 5 slices merged into `main`. Follow-ups documented below.

This is the canonical entry point for any new agent session resuming the UX uniformity initiative. Read it first; act from it.

---

## 1. What was done in the last sessions

| # | Slice | Status | Where it lives |
|---|---|---|---|
| 1 | Action Surface Unification | ✅ Merged via [#31 (synthesis)](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/pull/31) | commit `de076b3` on main |
| 2 | Intent affordances audit | ✅ Merged via [#28](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/pull/28) | commit `ed0c0a8` on main |
| 3 | Dashboard wiring | ⚠️ Part 1 only on main | commit `06698e5` on main |
| 4 | AI auto-fix Community Health | ✅ Merged via [#29](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/pull/29) (Tasks 1–8 + 11) | commit `b9f2a58` on main |
| 5 | Mobile parity sweep | ✅ Merged via [#30](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/pull/30) (Phase 1+2 = 6/17 audit rows) | commit `cd5086c` on main |
| — | AI quota friendly error | ✅ Merged | commit `b9e093a` on main (predates the 5 slices, related util) |
| — | User WIP feature work | ✅ Merged via stash-pop | commit `60e52f9` + recovery `93fbe1f` on main |

**Tests on main now:** **3002 passing / 3027 total** (24 skipped, 1 pre-existing fail). The 1 fail is `tests/lint/no-standalone-loader2.test.js` flagging two files in the user's WIP — listed in section 5 below.

**Specs + plans for each slice** are at `docs/specs/2026-05-01-*` and `docs/plans/2026-05-01-*`. Each task in the plans has line-by-line code + test snippets.

---

## 2. Cross-cutting decisions already locked

These came up during slice 1 brainstorming and apply to all remaining work:

1. **Confirmation policy:** modal-based via `<ConfirmModal>` from `src/components/ui/ConfirmModal.jsx`. **No** toast-with-Undo in any slice yet — that is a deferred standalone spec.
2. **`<ConfirmModal>` variant literals:** `'info' | 'warning' | 'danger'` (NOT `'destructive'`).
3. **Mobile context-menu trigger:** explicit `MoreHorizontal` button on the card. **No** long-press gesture handling.
4. **Tests:** Vitest unit/component, Playwright e2e. Tests live in `tests/` mirroring `src/`. Server tests in `server/__tests__/`.
5. **Commits:** Conventional Commits format. **NEVER** add `Co-Authored-By` lines (per `CLAUDE.md`).
6. **Branch model:** feature branches off `main`. Direct push to `main` IS authorized when the user asks (memory `feedback_push_on_request.md`). **Force-push to main is BLOCKED by branch protection** even with admin rights — plan accordingly.
7. **Worktrees:** preferred for multi-task slice work. Each gets its own `node_modules` (junction symlink doesn't work for vitest config resolution).

---

## 3. Reusable scaffolding shipped (DO NOT re-build)

| Capability | Where | When to use |
|---|---|---|
| **Action registry** | [`src/actions/repoActions.js`](../../src/actions/repoActions.js) | Adding a new repo action — single edit, surfaces consume automatically |
| **Action dispatcher** | [`src/actions/runAction.js`](../../src/actions/runAction.js) | `runAction(actionId, target, ctx, repoActions)` — single call site |
| **Action DI hook** | [`src/actions/repoActionContext.jsx`](../../src/actions/repoActionContext.jsx) | `useRepoActionContext()` — packages api/toast/modal/refresh/confirmGate |
| **Pure repo mutations** | [`src/utils/repoMutations.js`](../../src/utils/repoMutations.js) | Non-React callers needing `archiveRepos` / `deleteRepos` / `performAction` |
| **Confirmation hook** | [`src/hooks/useDangerAction.js`](../../src/hooks/useDangerAction.js) | Outside the action registry: `useDangerAction({ title, message, variant, requiresInput, onConfirm }).run()` |
| **Mobile FAB** | `src/components/ui/MobileFAB.jsx` | `<MobileFAB icon={…} label={…} onClick={…} shiftAboveBottomBar />` — renders only `< md` |
| **Sticky modal** | ``src/components/ui/ModalSticky.jsx`` (file since removed) | Replace `<Modal>` when the modal has action buttons that should stay visible on mobile |
| **Viewport-safe height** | [`src/hooks/useViewportSafeHeight.js`](../../src/hooks/useViewportSafeHeight.js) | iOS URL-bar-aware sizing (already used by `<ModalSticky>`) |
| **Mobile drawer** | `src/components/MobileDrawer.jsx` | `<MobileDrawer isOpen onClose side="…">` (left / right / bottom) |
| **Mobile breakpoint hook** | [`src/hooks/useMobileBreakpoint.jsx`](../../src/hooks/useMobileBreakpoint.jsx) | Returns boolean for `< md` (768 px) |
| **Friendly AI errors (client)** | `src/utils/aiErrorFriendly.js` | `friendlyAiError({ status, body }) → { headline, detail }` |
| **Friendly AI errors (server)** | [`server/middleware/ai-error-mapper.js`](../../server/middleware/ai-error-mapper.js) | `mapAIErrorToResponse(res, err)` — returns the response or null |
| **Confirm modal** | [`src/components/ui/ConfirmModal.jsx`](../../src/components/ui/ConfirmModal.jsx) | `{ title, message, variant, requiresInput, onConfirm, onClose }` |
| **Lint guard** | [`tests/lint/no-bare-destructive-buttons.test.js`](../../tests/lint/no-bare-destructive-buttons.test.js) | Fails CI if a red Button has no recognised confirm pattern |

**Recognised confirm patterns** (the lint guard accepts these neighbours within 5 lines):
- `useDangerAction(...)`
- `openModalWithData('showConfirm', ...)`
- `setConfirmAction(...)` (project state-based pattern)
- `setConfirmOpen(...)`
- `<ConfirmModal>` rendered as sibling
- `// danger-button-allowed: <reason>` (JS) or `{/* danger-button-allowed: <reason> */}` (JSX)

---

## 4. What's left — prioritized todo list

**Update 2026-05-01 (later session):** Priorities 1, 2, 3, plus the hygiene route-tests item are all shipped. Full vitest suite is now green (3030 passing, 24 skipped, **zero failures**). Only Priority 4 (E2E harness) and Priority 5 (Slice 3 Part 2 brainstorm) remain.

Pick highest-priority unblocked item first. Each line ends with the spec/plan reference and effort estimate.

### Priority 1 — unblocked, high value ✅ DONE

- [x] ~~**Slice 4 Task 9: Register `fix_community_health` action**~~ ✅ Commit `4ddf5aa`. Action surfaces in contextMenu + commandPalette; opens the existing Community Health modal (passes raw repo, no `focus` prop — would need extra App.jsx plumbing).
- [x] ~~**Pre-existing lint regression fix**~~ ✅ Commit `5a2648b`. `MigrationHistory.jsx` (line 256) and `RepoDetail/InlineEditField.jsx` (line 81) migrated from raw `<Loader2 animate-spin>` to `<Spinner size="md" tone="muted" />` and `<Spinner size="sm" tone="primary" />` respectively. Suite is fully green for the first time since slice 3.

### Priority 2 — unblocked, medium value ✅ DONE

- [x] ~~**Slice 4 follow-up: Apache-2.0 / GPL-3.0 / MPL-2.0 license templates**~~ ✅ Commit `5738375`. Templates fetched verbatim from the GitHub-maintained `choosealicense.com` mirror. Apache uses `[yyyy] [name of copyright owner]` → `{{year}} {{owner}}`, GPL-3.0 uses `<year> <name of author>` → `{{year}} {{owner}}`, MPL-2.0 has no per-project placeholders by design (copyright lives in source headers). `SUPPORTED_LICENSES` now exposes 5 entries. Pre-existing "throws on Apache-2.0 (queued)" test was flipped to positive coverage.
- [x] ~~**Slice 5 audit row 8: RepoDetail tabs scroll fade indicators**~~ ✅ Commit `fab9b82`. Tailwind arbitrary `[mask-image:linear-gradient(to_right,transparent,black_24px,black_calc(100%-24px),transparent)]` applied to the TabBar's overflow-x-auto wrapper in `RepoDetail.jsx`. Skipped scroll-snap (would need shrink-0 inside TabBar, affects PRDetailPanel consumer too).
- [x] ~~**Slice 5 audit row 16: tooltip touch audit**~~ ✅ Audit only (no commit needed). The only `<Tooltip>` matches are recharts chart tooltips (not button hover tooltips) in ActivityChart + LanguageChart. Icon-only buttons consistently use `title` and/or `aria-label` already; the rarely-used `TooltipButton` primitive in `RepoStates.jsx` uses `title={label}` directly. Zero offenders.

### Priority 3 — bigger pieces ✅ DONE

- [x] ~~**Slice 5 audit row 4: LanguageChart compact bar variant**~~ ✅ Commit `726466e`. Below `sm` shows a horizontal stacked bar (GitHub-style language bar) + a 2-column compact legend; the pie chart hides at `<sm` and reappears at `sm:flex`. `data-testid` on each variant for future component tests.
- [x] ~~**Slice 5 audit rows 10+11: WorkBoard mobile**~~ ✅ Commit `ae3a034`. KpiRow flipped from `grid-cols-2 md:grid-cols-4` to `grid-cols-1 sm:grid-cols-2 md:grid-cols-4` so KPIs stack 1-wide on iPhone SE. AISummaryCard's `flex-col sm:flex-row` was already correct — locked in via test. Step 8.3 (bottom-anchored tab bar) deferred (optional in plan; would interact with FAB / `shiftAboveBottomBar` contract).
- [x] ~~**Slice 5 audit row 12: Modal tab strip overflow**~~ ✅ Commit `5ce1843`. Centralised the fix in `Modal.jsx` itself — the wrapper around `<TabBar>` now has `overflow-x-auto` + the same 24px linear-gradient mask used by RepoDetail. Modals with few tabs get it as a no-op; SettingsModal (8 tabs) and any future multi-tab modal benefit automatically.
- [x] ~~**Slice 5 audit row 13: `<ModalSticky>` migration**~~ ✅ Commit `6808a71`. Audit of 18+ Modal consumers found only one offender: `LicenseActivationModal.jsx` had its Validate button inline in body content. Lifted into the `Modal.footer` prop (Modal already provides flex-shrink-0 footer; no `<ModalSticky>` wrapper needed). Every other consumer correctly uses the `footer` prop and inherits the sticky layout for free.
- [x] ~~**Slice 5 audit row 14: MigrationWizard responsive sweep**~~ ✅ Commit `d0f3290`. Four offenders fixed: `RepoConfigStep` stats grid (`grid-cols-4` → `grid-cols-2 sm:grid-cols-4`); `RepoConfigStep` header row (`flex-col sm:flex-row` instead of always-row); `ProgressStep` right-side status cluster (`flex-wrap` so retry button never clips); `BreadcrumbNav` (`overflow-x-auto whitespace-nowrap` + `shrink-0` per segment so long Azure project names scroll horizontally).

### Priority 4 — gated on infra

- [ ] **E2E test suites (slices 1, 4, 5).** All gated on a Playwright mock-mode setup that doesn't exist yet. The plan files contain the exact test scripts; only the harness needs to be built first. **Effort: half day for infra + 1 h per suite.**
- [ ] **Slice 4 Task 10: Community Health fix e2e.** Same gating. [Plan task 10](../plans/2026-05-01-community-health-ai-autofix.md#task-10-e2e-test).

### Priority 5 — needs brainstorming first

- [ ] **Slice 3 Part 2: deeper dashboard interactivity.** Not yet specced. Run the brainstorming skill to define scope. Likely candidates: AttentionFeed actions, MigrationActivity click-throughs, AIPromoStrip dismissal persistence.

### Hygiene / cleanup

- [x] ~~**Slice 4 follow-up: route tests for `actions-community.js` /generate + /commit-fix endpoints**~~ ✅ Commit `06eb211`. New file `server/__tests__/actions-community-fix-routes.test.js` (8 tests) covers: deterministic license path, unknown fileType (400), AI provider lookup, `ai_not_configured` (403), invalid owner param (400), happy-path commit + cache invalidation, missing required fields (400), commit helper error → 500. Pattern follows `work-board-actions.test.js`.
- [ ] **Toast-with-Undo (Phase 2 spec).** Multiple slices deferred this. Needs its own spec — dedicated brainstorming session.

### Optional follow-ups discovered while shipping the above

- WorkBoard step 8.3 (bottom-anchored tab bar at `<sm`) was marked optional in the plan. If pursued, plan to coordinate with the existing FAB `shiftAboveBottomBar` prop so they don't overlap.
- `fix_community_health` action could pass `{ repo, focus: 'fix' }` once `App.jsx:1116` is updated to forward a `focus` prop into `<CommunityHealthDashboard>` and the dashboard scrolls/highlights missing-file rows. Currently both action entries (`community_health` + `fix_community_health`) open the same modal with raw repo.

---

## Update 2026-05-02 — Premium polish audit + 13 commits shipped

A 5-dimension audit (parallel subagents) covered: code duplication / scaffolding consolidation, vaporware / silent failures, dashboard interconnections, AI prompt + model consistency, and menu / quick-action coverage. ~25 distinct findings; ~14 of them mapped to mechanical wins shipped in this session, the rest were either reclassified (audit was wrong) or deferred as architectural decisions.

**Phase 1 (high-impact, low-effort) — 11 commits shipped:**

- [x] ~~**Command palette enumerates `repoActions` registry on the repos view.**~~ Commit `f1d3041`. The slice-1 registry was never consumed by `Cmd+K`; users browsing repos couldn't discover ai_quality / transfer / mirror / sync via palette. New adapter `buildRepoActionsCommands` + `kind:'run'` switch case + `useRepoActionContext` wired into the palette. Top 3 displayRepos × commandPalette-surface actions = ~24 items, cmdk filters as user types.
- [x] ~~**JSON.parse guards in `server/lib/ai-features/semantic-search.js` (3 sites)**~~. Commit `9635a6f`. A single corrupt `repo_embeddings.embedding` row no longer crashes `findSimilarById` / `semanticSearch` / target-row lookup. New `parseEmbedding(json, repoId)` helper logs once at warn level and returns null; callers skip-vs-throw.
- [x] ~~**Honest 503 differentiation in `src/api/ai.js`**~~. Commit `5031170`. Previously the unconfigured short-circuit and the runtime-503 path returned identical "Connect AI..." placeholders, so a configured-but-temporarily-broken AI looked like a setup prompt. New `RUNTIME_UNAVAILABLE_NOTE` + `runtimeUnavailable: true` flag distinguishes them in indexRepo / search / enhanceReadme / getQualityReport / batchIndex.
- [x] ~~**`timeAgo()` consolidation — 4 of 6 variants → `formatRelativeTime`**~~. Commit `770cf80`. Dashboard MigrationActivity, PR review InlineComment, RepoDetail Issue/PRDetailPanel now use the canonical helper. Two variants stay local (AISummaryCard "5 min ago" verbose, RepoMetaBadges no-suffix compact, CurrentConfigSummary full sentence) — different intentional output styles; could fold in via a `style` option in a follow-up.
- [x] ~~**Dashboard wiring: Teams cards + MigrationActivity click-through**~~. Commit `29b0ed2`. Team cards (DashboardPremium) become real buttons → setSelectedTeam + navigate. MigrationActivity rows + summary stats open MigrationHistory modal. ALSO: removed the dishonest `cursor-pointer` from LanguageChart + ActivityChart cards/legends since they had no onClick — better to look static than to lie about interactivity.
- [x] ~~**Friendlier error message in LicenseActivationModal catch path**~~. Commit `72ae3cc`. Network failures previously dumped raw `err.message` ("Failed to fetch", TypeError stacks). Now threads through `formatUserError` for human title/body.
- [x] ~~**`<Skeleton>` primitive replaces 3 high-traffic ad-hoc skeletons**~~. Commit `e57fa0f`. WorkBoard SkeletonRow (cascades into every WB tab), Dashboard SkeletonCard (WhatNeedsYouGrid), AISummaryCard pre-data state. Visual upgrade — the primitive uses the polished `ds-skeleton` shimmer instead of the old animate-pulse.
- [x] ~~**Centralized Gemini model defaults**~~. Commit `ecc6dbb`. `GEMINI_DEFAULT_MODEL` + `GEMINI_DEFAULT_EMBEDDING_MODEL` exports + `getGeminiModelDefaults()` helper. 4 call sites that duplicated the literal model IDs (constructor signature, two factory paths, semantic-search error message) all flow through it. Provider-pricing keeps the IDs as lookup keys (different concern, correctly unchanged).
- [x] ~~**Co-located AI prompt templates in `community-health-fix.js`**~~. Commit `03dcb86`. The 5 generators now share a frozen `PROMPT_TEMPLATES` block at module top with `{placeholder}` substitution via a small `renderPromptVars` helper. Easier to audit/A-B test in one place than 5 inline strings.

**Phase 1 items also shipped earlier in the day:** lint regression fix (5a2648b), Apache/GPL/MPL license templates (5738375), RepoDetail tab fade (fab9b82), LanguageChart compact bar variant (726466e), WorkBoard mobile (ae3a034), Modal tab strip overflow (5ce1843), LicenseActivationModal sticky footer (6808a71), MigrationWizard sweep (d0f3290), route-level tests for community-health endpoints (06eb211).

**Phase 2 (AI hygiene) re-evaluated:**

- [x] ~~**SKIPPED: pr-review + readme-enhance system prompts → registry**~~. The user-editable `AI_PROMPT_REGISTRY` is designed for chat-persona / suggest-name-description style prompts the user might want to tune. Pushing per-feature generator system prompts through it expands DB schema + Settings UI for unclear ROI. Document for future demand.
- [x] ~~**SKIPPED: try-catch wrapping in 5 community-health generators**~~. The audit's claim was incorrect — `actions-community.js` route already wraps generator calls in try-catch and routes AIError through `mapAIErrorToResponse`. The generators don't need their own wrapping; raw errors propagate cleanly to the route's mapper.
- [x] ~~**SKIPPED: SettingsTab webhook/topic actions → registry**~~. These actions are context-bound (specific topic name, specific hook ID) and require form input. Adding `add_topic`/`remove_topic`/`ping_hook`/`delete_hook` to a context-menu / quickAction registry would clutter the UI without value — they correctly belong inside the Settings tab where their context lives.

**Skipped vaporware-audit items reclassified:**
- LanguageChart legend → language filter: deferred. The full chain (`repos:set-filter` listener) doesn't exist on the receiving side either (vaporware in the palette's `reposCommands.js`). Adding the legend onClick alone would be incomplete; the palette events also need a listener. Bigger refactor than warranted.
- TooltipButton primitive: already correct (uses `title={label}` directly). No work.
- Settings link from dashboard: exists in Sidebar already.

**Test suite at end of session: 3045 passing, 24 skipped, zero failures.** All build green.

### Phase 3 (architectural) — ✅ ALL THREE SHIPPED 2026-05-02

User said "todas". All three architectural items from the audit are now in main. 5 commits between `48b99d5` and `57e5602`. Suite 3084 passing, zero failures.

- [x] ~~**PR / Branch / Issue action registries**~~ ✅ Commits `8f38b4a` (registries) + `57e5602` (palette wiring).
   - `src/actions/prActions.js` (8 entries: view/open/copy×2/start_review/generate_description/merge/close)
   - `src/actions/branchActions.js` (5 entries: open/copy×2/protect/delete with type-name confirm)
   - `src/actions/issueActions.js` (8 entries: view/open/copy×2/plan_with_ai/comment/close/reopen)
   - Each ships with full unit tests (33 cases total: shape validators, applicability rules, confirm contracts, run() side effects, palette builders).
   - Command palette consumes via opt-in `selectedRepoDetailEntities = { prs, branches, issues }` prop. When App.jsx populates it (a future patch), the palette renders three new groups. When null/empty, groups stay hidden — adoption doesn't require App.jsx changes to ship.
   - Registry runners bridge to existing UX flows via window CustomEvents: `app:open-pr-detail`, `app:start-pr-review`, `app:generate-pr-description`, `app:open-issue-detail`, `app:plan-issue-with-ai`. RepoDetail tabs can listen and route to their existing handlers.
- [x] ~~**Centralized `fetchApi()` wrapper with CSRF**~~ ✅ Commit `1419a57`. The wrapper already existed (`fetchWithRetry` + `apiCall` in `src/utils/api.js` — slice-1 era infrastructure). What was missing was migration of three hand-rolled call sites that bypassed it: MigrationHistory.loadJobs, WorkBoard AISummaryCard.fetchSummary, Settings LicenseActivationModal.handleValidate. All three now route through `fetchWithRetry`, getting CSRF injection + retry-on-5xx + session-expiry detection for free. AISummaryCard test rewired to mock `fetchWithRetry` directly via a MockApiError that mirrors the real ApiError contract.
- [x] ~~**Keyboard shortcuts derive from registry**~~ ✅ Commit `48b99d5`. Catalog extracted from `useKeyboardShortcuts.js` to `src/config/keyboardShortcuts.js` (frozen `GLOBAL_SHORTCUTS` array + `collectRegistryShortcuts()` walker). The hook dispatches via a handler map keyed by the catalog's `action` field — no inline switch, no risk of catalog vs handler drift. Help modal renders a third "Repo Actions" group from `getAllShortcuts()` output. The `RepoAction.keyboardShortcut` field is documented in JSDoc; no action declares one yet — wiring per-context execution (focused-repo target) is a clean future extension that doesn't block the catalog work.

### Phase 3 adoption follow-ups — ✅ ALL THREE SHIPPED 2026-05-02 (later in same session)

User asked for everything to be done end-to-end. All three follow-ups are now in main. 2 commits between `3868310` and `30240c1`. Suite still 3084 passing, zero failures.

- [x] ~~**Wire App.jsx → palette `selectedRepoDetailEntities` prop**~~ ✅ Commit `3868310`. Tabs (PullRequestsTab / BranchesTab / IssuesTab) dispatch `repo-detail:prs-loaded` / `branches-loaded` / `issues-loaded` events whenever their data fetch resolves. App.jsx subscribes once, keeps a unified `repoDetailEntities` state, and passes a memo-derived `palettePropEntities` to `<CommandPalette>` (returns empty arrays when out of repo-detail context — avoids stale targets without needing a setState-in-effect reset). Tabs now derive their list arrays via `useMemo` so the CustomEvent useEffect dependency stays stable.
- [x] ~~**Bridge palette CustomEvents to App.jsx listeners**~~ ✅ Same commit `3868310`. Five intents wired:
  - `app:open-pr-detail` → re-emits `repo-detail:select-pr` (PullRequestsTab listens, calls setSelectedPR)
  - `app:start-pr-review` → App.jsx setReviewingPR + view='pr-review'
  - `app:generate-pr-description` → App.jsx openModalWithData(showDevToolkit)
  - `app:open-issue-detail` → re-emits `repo-detail:select-issue` (IssuesTab listens)
  - `app:plan-issue-with-ai` → re-emits `repo-detail:plan-issue` (IssuesTab listens)
- [x] ~~**Adopt registry runners inside PullRequestsTab / BranchesTab / IssuesTab**~~ ✅ Commit `30240c1`. Each tab now delegates to its registry:
  - **PullRequestsTab.handleMerge / handleClose** → `runPRAction(prActions.merge_pr | close_pr, pr)`. Helper consults `action.confirm(pr)` → if present, gates via existing `setConfirmAction` modal; if absent, runs directly.
  - **BranchesTab.handleDelete** → adopts `branchActions.delete_branch` including the registry's type-name verification (`requiresInput: branch.name`), upgrading the existing single-click confirm to a stronger guard. Also passes the full branch object (was only name) so `isApplicable` can read `.protected`.
  - **IssuesTab.handleClose / handleReopen** → `runIssueAction(issueActions.close_issue | reopen_issue, issue)`. Skips `close_issue.confirm` to preserve existing UX (no ConfirmModal in the tab); the gate stays available for the command-palette consumer that may opt in.
  - Toast text evolved to the registry's more-specific shape (`Merged PR #42`, `Closed PR #42`, `Closed issue #N`, `Reopened issue #N`). Two tests updated to match.

**Net result:** the PR / Branch / Issue action registries are now load-bearing in BOTH the inline tab handlers AND the command-palette enumeration. Single source of truth for what an action does, what its confirm shape is, and how the API is called. Adding a new entry surfaces it on every consumer automatically.

---

## Final premium-polish + full-suite validation pass — 2026-05-02

User asked: "Validar tudo… nao quero vaporware, nao quero bugs, ui sem erros e linda e consistente, premium feel, AI functional protegida se offline, menus e painéis ligados uniformes e funcionais, sem código duplicado, sem erros, tudo lindo premium UI e UX em desktop e mobile lindas e no final testes ok incluindo e2e."

Five parallel audits run + 3 commits to close the real gaps + e2e suite unblocked end-to-end.

### Audit verdicts

| Dimension | Result |
|---|---|
| **Vaporware in Phase 3** | ✅ ZERO — every CustomEvent, every action runner, every ctx callback chain end-to-end verified. Theme toggle works + persists. All 8 keyboard shortcuts have handlers. Action registry callbacks all populated by their consumers. |
| **AI offline behaviour** | ✅ Server returns proper `ai_not_configured` / `ai_overload` / `ai_quota_exceeded` / `ai_rate_limited` codes; client `src/api/ai.js` differentiates unconfigured from runtime-503 (commit `5031170`); AISummaryCard + AIRunButton properly degrade. Open follow-up (deferred): registry actions don't `isApplicable`-gate on AI status — they DO open modals that handle their own AI-off state, so it's discoverability gripe not silent failure. |
| **Code duplication** | 1 finding fixed (`copyToClipboard` helper centralized to `src/utils/clipboard.js`, replacing 4 copies); 6 other findings deferred as low ROI (existing `buildXActionCommands` builders are clear in their current per-registry form, factoring out a generic builder adds complexity without behaviour win). |
| **UI consistency / premium feel** | 4 findings shipped: per-tab Refresh button (Branches/PRs/Issues/Releases now match ActionsTab pattern); touch-invisible icons (BranchesTab delete + InlineEditField pencil) gain mobile fallback (`md:opacity-0` instead of always-hidden); hardcoded hex colours in IssueDetailPanel + PRDetailPanel borderLeftColor replaced with Tailwind semantic classes (`border-l-green-500` etc). |

### Commits this validation pass

- `ca280e6` — landing page theme toggle (consistency + e2e fix)
- `0d4532d` — clipboard helper + mobile parity + refresh buttons + semantic colours
- `f8116c5` — e2e suite re-aligned + real mobile FAB intercepting bottom nav fix

### Real production bug caught by e2e

**MobileFAB was intercepting the "More" bottom-nav button on mobile.** App.jsx rendered the FAB at `bottom-6 right-4` (default). Header.jsx renders a `fixed bottom-0` h-14 navigation for authenticated users on `<md`. The FAB's 56x56 footprint overlapped the nav's rightmost item (More), absorbing clicks. Fix: `shiftAboveBottomBar={!!user}` so FAB lifts to `bottom-20` whenever the bottom nav is visible.

Caught by `mobile-nav-quick-actions.spec.js` timing out for 15s on `.click()`.

### Final test results

- **Vitest:** 3088 passing, 24 skipped, **zero failures**.
- **Playwright e2e:** **79 passed, 9 skipped, zero failures** (full suite, ~1.4 min).
- **Build:** green (722ms).
- **ESLint:** clean.

---

## 5. Known issues + pitfalls (read before acting)

### Pre-existing test failure ✅ RESOLVED

The `tests/lint/no-standalone-loader2.test.js` regression is fixed (commit `5a2648b`). Both `MigrationHistory.jsx` and `RepoDetail/InlineEditField.jsx` now use the `<Spinner>` primitive. **The full vitest suite is green for the first time since slice 3 — 3030 passing, zero failures.**

### Git workflow gotchas (learned in last session)

1. **`git reset --hard` deletes untracked files** that aren't in git's index. Always `git status --short` first; commit or stash with `-u` before any reset.
2. **`git stash pop` STAGES every file** it restores. If you then `git add <specific file>` and commit, the staged stash files come along. Run `git restore --staged .` first to unstage.
3. **Branch protection on `main` BLOCKS force-push** even with `--admin` flag. Don't try to rewrite history on remote main; redo the work as new commits.
4. **Reflog saves the day.** `git reflog` keeps "lost" commits 30+ days. First recourse for recovery.
5. **For massive merge conflicts (10+ commits, 5+ files vs main),** use **synthesis**: branch off current main, copy/port the feature branch's final state, single squash commit. Documented in memory `feedback_synthesis_branch_for_conflict_resolution.md`.

### Per-cluster gotchas

- The **`SettingsTab.jsx` archive button** has an indirect confirm via `handleArchiveToggle()` calling `setConfirmAction()` — there's already a `// danger-button-allowed` comment at line ~466 explaining why. Don't remove it.
- The user's WIP merged in `60e52f9` includes new files in `server/lib/ai-features/{ai-chat-prompt.js,ai-prompt-registry.js}` + `server/routes/ai/prompts.js`. These were nearly lost in the stash-pop accident; verify they're present (`ls server/lib/ai-features/ai-chat-prompt.js`) before touching anything in that area.
- The slice 5 mobile primitives are in **`src/components/ui/MobileFAB.jsx`** and **`src/components/ui/ModalSticky.jsx`** (NOT under `Mobile*/`). Easy to look in the wrong directory.

---

## Second premium-polish pass — 2026-05-02 (later same session, panel + superpowers)

User asked for the same validation again with explicit "painel de assistentes e superpowers skill". Invoked `superpowers:dispatching-parallel-agents`, ran 5 fresh audits covering NEW angles (server-side / performance / a11y / cross-page nav / mobile parity deep). Real fixes shipped in 2 commits:

- `600e18a` — server AI error mapping (9 catch blocks across `dev-toolkit.js` + `indexing.js` now route through `mapAIErrorToResponse` / `handleAIError` instead of returning raw 500s on quota / rate-limit / auth failures). migration.js was already correct (audit was wrong on that file).
- `befa8ca` — touch-visible StatCard hint (was opacity-0 group-hover, invisible on touch); hash-based pricing nav replaced with React state routing (`onNavigatePricing` for TeamHub + new `app:navigate-pricing` CustomEvent for QuotaExceededState — preserves browser history); ActivityChart + LanguageChart lazy-loaded (recharts ~371 kB deferred, charts now in own 3.6 / 5.4 kB chunks); dashboard org avatars get `loading="lazy"` + `decoding="async"`.

### Audit verdicts (second pass, 2026-05-02 later)

- **Server security/error**: 9 real catch blocks fixed via mapper. Migration routes already correct. Input-validation gaps documented but not load-bearing.
- **Performance**: 1 unidentified 1044 kB esm chunk (pre-existing, requires `npm run build:analyze` to diagnose); 2 charts eager-loaded (now lazy); 5 avatars eager (now lazy).
- **A11y**: 12 findings, mostly false positives. Audit was wrong on the SlimIconButton HIGH item (every caller passes `label`). Other findings deferred as polish-tier.
- **Cross-page navigation**: 12 findings — 1 HIGH (hash navigation antipattern) fixed. URL-params for RepoList pagination + AttentionFeed context preservation deferred — none break user flows.
- **Mobile parity deep**: 10 findings — 1 HIGH (StatCard hint hidden on touch) fixed. Other findings (sparkline at < sm, chart tooltip font size, max-h-[60vh] on iPhone SE) all polish-tier.

### Final final test results (2026-05-02 later)

- **Vitest**: 3088 passing, 24 skipped, **zero failures**.
- **Playwright e2e**: **79 passed, 9 skipped, zero failures** (full suite, ~1.4 min).
- **Build**: green (740ms). Charts now split into `ActivityChart-*.js` (3.6 kB) + `LanguageChart-*.js` (5.4 kB) standalone; recharts loads only when dashboard charts visible.
- **ESLint**: clean.
- **Working tree**: clean.

### Remaining follow-ups — ✅ ALL FOUR SHIPPED 2026-05-02 (third pass)

User asked to close them out ("faz o que falta"). All four landed in 2 commits:

- [x] ~~**1044 kB chunk investigation**~~ ✅ Commit `13abc67`. Identified as `@git-diff-view/react` + transitive deps (highlight.js, lowlight, shiki). Both consumers already lazy-loaded it, but rolldown was packing the deps into the unnamed default ESM bundle. Added explicit `vendor-diff` manualChunks rule. The 1044 kB still exists (the lib is genuinely heavy) but now lives in a clearly-named lazy chunk that loads only when DiffRenderer / ReadmeEnhanceDiffPanel renders. Verified by inspecting which bundles statically import vs only register the URL.
- [x] ~~**RepoList pagination URL-persisted**~~ ✅ Commit `9a15ccd`. `useRepos` initial page reads from `?page=` on mount; `setPage()` writes via `history.replaceState` (page=1 strips the param to keep the URL clean); `popstate` listener syncs state when the user clicks browser back/forward. 6 unit tests in `tests/hooks/useReposPagination.test.jsx` pin the contract.
- [x] ~~**A11y polish**~~ ✅ Commit `9a15ccd`. ChatInput textarea switched from `focus:ring` (mouse-only) to `focus-visible:ring-2`. Other a11y findings (MobileQuickActionsFab, ModelCombobox) verified as false positives — the audited code already had `aria-expanded` / `aria-haspopup` / `aria-selected` correctly.
- [x] ~~**Empty catch blocks**~~ ✅ Commit `9a15ccd`. Three silent catches now log warn-level for non-404 errors: `dev-toolkit.js` README + contents fetch in `/ai/quality-report`, `suggest-name-description.js` README fetch + `repo_metadata` SQLite read. 404 stays silent (expected paths). Anything else (token expired, GitHub 5xx, sqlite I/O error) lands in structured logs.

### Final final final test results (2026-05-02 third pass close-out)

- **Vitest:** **3094 passing**, 24 skipped, **zero failures** (up by 6 from new pagination tests).
- **Playwright e2e:** **79 passed, 9 skipped, zero failures** (full suite, ~1.5 min).
- **Build:** green (751ms). vendor-diff chunk now properly named and verifiably lazy.
- **ESLint:** clean.
- **Working tree:** clean.

---

## 6. Bootstrap protocol for the next session

1. **Read this doc first.** It's the source of truth.
2. **Run** `git log --oneline -10 && git status --short && gh pr list --state open` to verify the state matches what's described above. If it diverges, trust the actual state.
3. **Pick the highest-priority unblocked item** from section 4.
4. **Use a worktree** if the work touches more than 2-3 files, OR if you need isolation from the user's WIP. Pattern:
   ```
   git worktree add s:/ghrm-worktree-<name> -b feat/<name>
   cd s:/ghrm-worktree-<name> && cp s:/Git\ Hub\ Repo\ Manager/.env . && npm install
   ```
5. **For each task: TDD — write failing test, run red, implement, run green, commit, push.** Conventional Commits, no `Co-Authored-By`.
6. **Update this handoff doc** when the task lands. Move the line from "what's left" to "what was done".
7. **Push to feature branch first**, then open PR via `gh pr create`. Squash-merge via `gh pr merge <num> --squash --admin --delete-branch`.
8. **If session is filling up,** commit a `wip(<scope>): partial <task> — <state>` and push. The next session reads this handoff and resumes.

### Key commands

```bash
# Test suites
npx vitest run                                                       # full
npx vitest run tests/actions tests/components/RepoList               # narrow scope
npx vitest run tests/lint/no-bare-destructive-buttons.test.js        # lint guard
npx vitest run tests/lint/no-standalone-loader2.test.js              # the pre-existing failure

# Build
npm run build

# Lint a specific file
npx eslint <path>

# Dev server
npm run dev
```

### When something breaks

- **Test fails after edit:** read the test message; if it's the lint guard, add a `// danger-button-allowed: <reason>` or refactor to use `useDangerAction`.
- **Module not found error:** check if the import path matches an existing file. The user's WIP added some new server libs that might be referenced.
- **`git pull` rejected (conflicts with WIP):** `git stash push -u -m "pre-pull"`, pull, then `git stash pop`. **Beware:** stash pop stages files — see gotcha 2 above.

---

## 7. Memory pointers (auto-loaded into agent context)

The agent's auto-memory is at `C:\Users\bruno\.claude\projects\s--Git-Hub-Repo-Manager\memory\`. Relevant entries (added/updated this session):

- `project_ux_uniformity_initiative_status.md` — current state of all 5 slices + remaining work
- `reference_shared_scaffolding.md` — index of the 14 reusable utilities listed in §3 above
- `feedback_safe_branch_workflow.md` — git workflow lessons from this session

Plus the pre-existing memories that remain valid:

- `feedback_push_on_request.md` — direct push to main is OK on explicit request
- `feedback_avoid_long_local_tests.md` — push and let CI; don't run full e2e locally
- `feedback_vite_inline_dce_guards.md`
- `feedback_git_add_check_artifacts.md`
- `project_agpl_license.md`
- `project_support_email.md`

---

## 8. Definition of "everything done" for the whole initiative

The original user goal: *"premium tudo interligado, funcional, sem erros. lindo. em desktop e Mobile."*

Concretely:
- ✅ Discoverable: every action available from at least 2 entry points (slice 1)
- ✅ Predictable: every destructive action confirms with the same shape (slices 1+2)
- ✅ Connected: dashboard cards lead somewhere meaningful (slice 3 part 1)
- ✅ Health is actionable: Community Health offers fixes, not just diagnoses (slice 4)
- ⚠️ Mobile-equivalent: some flows still desktop-only (slice 5 has 11 audit rows still queued)
- ✅ Honest about errors: AI failures show "AI provider quota exceeded — retry in 14s" (already shipped)

**The initiative is 80% there.** The remaining 20% is the slice 5 cluster work + slice 4 task 9 + slice 3 part 2 brainstorm + the lint regression fix. None of it is hard; it's just careful per-file work.

---

## Update 2026-05-01 (later session) — Initiative substantially complete

The remaining mechanical work has been shipped (10 commits between `4ddf5aa` and `06eb211`). The initiative is now ~95% complete:
- ✅ Mobile-equivalent: every previously-flagged audit row is shipped or verified clean. Bullet 5 ("Mobile-equivalent: some flows still desktop-only") in §8 above can be closed.
- ✅ Test suite is fully green for the first time since slice 3 baselined 3002 passing — now 3030 passing, zero failures.

What's actually left:
1. **Priority 4** — Playwright mock-mode harness + the e2e suites that depend on it (~half day for infra + 1 h per suite).
2. **Priority 5** — Slice 3 Part 2 dashboard interactivity (needs brainstorming session).
3. **Toast-with-Undo Phase 2** (separate spec to write).
4. **WorkBoard bottom tab bar** (optional, deferred per plan).
