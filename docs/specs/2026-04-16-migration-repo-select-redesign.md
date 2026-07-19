# Select Repositories Step — Redesign & Enrichment

**Date:** 2026-04-16
**Status:** Draft
**Approach:** Enriched List + Side Detail Panel + Sticky Summary (Option A)
**Related:** Builds on [2026-03-26-configure-step-redesign.md](2026-03-26-configure-step-redesign.md) and [2026-03-25-migration-wizard-redesign.md](2026-03-25-migration-wizard-redesign.md)

## Overview

Redesign the **Select Repositories** step (step 3) of the Migration Wizard to enable confident, informed decisions at any scale (2–500 repos). The current step shows only name, size, language and branch count; the user has no way to anticipate migration risk, name conflicts, or repo health *before* committing to a selection.

This spec introduces:

1. Enriched per-repo metadata (activity, default branch, LFS sniff, conflict status)
2. A deterministic **risk engine** that surfaces blockers, warnings and info flags
3. A new visual layout aligned with the existing wizard language (hero dashboard + card-rows)
4. A slide-in **detail panel** for deep inspection without leaving the step
5. A sticky **selection summary bar** with totals, estimates and resolver shortcuts
6. Propagation of the enriched data to Configure, AI Review, Schedule and Summary — so nothing is re-fetched and everything feels coherent

## Goals

1. Enable triage at any scale (chips only appear when relevant; virtualized list when >50 repos)
2. Surface migration risk **before** selection (size, LFS, name conflicts, reserved names, invalid chars)
3. Eliminate duplicated backend calls between Select and Configure
4. Keep the visual language 100% consistent with the existing wizard (gradients, card-rows, stagger motion, stat grids)
5. Propagate enrichment so downstream steps feel seamless
6. Deliver excellent keyboard & screen-reader support (row listbox + live region + shortcuts)

## Non-Goals

* Changing `SourceTypeStep`, `SourceStep` (azureConnect), `UrlInputStep`, `GitHubSourceStep`, `TargetConfigStep`
* Changing `WorkItemsStep` or `WikiStep` (out of scope)
* Changing `ProgressStep` / `SimpleProgressStep` (out of scope)
* Editing per-repo configuration (targetName, visibility, branches, description) — that remains the Configure step's responsibility
* Full-tree file scanning for large files (infeasible for 53 GB repos; see §3.4)

---

## Design

### Section 1 — Data Model

Each repo in wizard state is enriched to carry decision-relevant information.

```js
{
  // Existing (from /api/azure/repos)
  id, name, size, language, branches, isDisabled, isFork, isTfvc, tfvcPath,

  // Already returned by listRepos, newly surfaced in UI
  defaultBranch,          // e.g. "main", "master", "develop"
  webUrl,                 // Azure DevOps URL for deep-link

  // Fetched at batch load (see §2.1)
  lastCommitDate,         // ISO string — via /stats/branches for default
  lastCommitAuthor,       // display name

  // Cheap sniff (see §2.2)
  hasLfsMarker,           // boolean — true if .gitattributes contains `filter=lfs`

  // Computed client-side by risk engine (see §3)
  risk: {
    level: 'blocker' | 'warning' | 'info' | 'ok',
    flags: [{ type, severity, message, suggestion?, actions? }],
  },

  // Pre-computed batch conflict check (see §2.3)
  conflictStatus: 'idle' | 'checking' | 'clear' | 'conflict',

  // Lazy — populated only when detail panel opens
  commitCount,            // number
  contributorCount,       // number
  commitActivity,         // [{ month: 'YYYY-MM', count }]
  readmePreview,          // markdown string, capped ~4KB
}
```

**Wizard state stays the single source of truth.** `useMigrationWizard` is extended to store enriched fields on each repo; downstream steps read them without re-fetching.

### Section 2 — Backend Endpoints

#### 2.1 `POST /api/azure/repos/activity` *(new, batch)*

Input: `{ org, project, repoIds: string[], pat? }`
Output: `{ [repoId]: { lastCommitDate, lastCommitAuthor } }`

Implementation: fan-out `GET /_apis/git/repositories/{repoId}/stats/branches?name={defaultBranch}` in parallel with `p-limit(5)` (avoid rate-limit). For repos without a default branch, return `{ lastCommitDate: null }`.

Errors on individual repos are swallowed (activity is a nice-to-have, not a hard requirement). Logs warning server-side.

#### 2.2 `POST /api/azure/repos/lfs-check` *(new, batch, optional)*

Input: `{ org, project, repoIds, pat? }`
Output: `{ [repoId]: boolean }` (true = `.gitattributes` contains `filter=lfs`)

Implementation: fan-out `GET /items?path=/.gitattributes&includeContent=true&versionDescriptor.version={default}` in parallel. 404 → false. Parse for `filter=lfs`. Fast: 1 small file per repo.

Called at same time as activity batch. Non-blocking to render.

#### 2.3 `POST /api/import/check-duplicates` *(existing, now called in batch at Select step)*

Already exists at [server/routes/import.js:923](../../server/routes/import.js#L923). Currently called per-repo in Configure; move to a **single batched call** right after fetching the repo list, with all repo names. Re-runs when `source.targetOrg` changes (debounced 500ms).

Configure step reads `repo.conflictStatus` from state and only re-checks a specific repo when the user edits its `targetName`.

#### 2.4 Lazy detail endpoints (opened per repo, cached in state)

* `POST /api/azure/repos/commit-activity` — `{ org, project, repoId, months: 12 }` → `[{ month, count }]`
* `POST /api/azure/repos/readme` — `{ org, project, repoId, ref? }` → raw README content (first README in root, any case)
* `POST /api/azure/repos/full-stats` — `{ org, project, repoId }` → `{ commitCount, contributorCount }` (iterates commits with `top=100`, caps at 500, returns "500+" if capped)

None of these block the initial list render. All cached in wizard state so re-opening the panel for the same repo is instant.

### Section 3 — Risk Engine

A pure client-side module `src/components/MigrationWizard/steps/RepoSelectStep/riskRules.js`.

```js
// Signature
function evaluateRepo(repo, context) => { level, flags }
// context = { allRepos, conflicts, targetOrg }

// Rules (in order of evaluation — first blocker wins for the left-border color)
ruleArchived         // isDisabled               → info
ruleStale            // lastCommit > 2y          → info
ruleEmpty            // size === 0 & branches=0  → info
ruleSizeWarning      // size > 5 GB              → warning
ruleSizeCritical     // size > 10 GB             → blocker
ruleLfsSuggested     // hasLfsMarker             → warning (enable LFS on target)
ruleNameConflict     // conflicts[name] === true → blocker
ruleDuplicateInBatch // same name in 2 TFVC dirs → blocker
ruleInvalidChars     // /^[A-Za-z0-9._-]+$/ fail → blocker
ruleReservedName     // name ∈ RESERVED_NAMES    → blocker
                     // RESERVED_NAMES = ['.git', '.github', 'www', 'api',
                     //                   'settings', 'login', 'logout',
                     //                   'admin', 'sponsors', 'topics']
```

Each rule is a pure function `(repo, context) => flag | null`. Flag shape:

```js
{
  type: 'size-critical',
  severity: 'blocker' | 'warning' | 'info',
  message: 'Repository exceeds 10 GB.',
  suggestion: 'GitHub may reject pushes over 10 GB. Consider LFS migration first.',
  actions: [
    { id: 'skip',   label: 'Skip this repo' },
    { id: 'split',  label: 'Learn how to split…', href: '/docs/large-repos' },
  ],
}
```

Level rollup: `blocker` > `warning` > `info` > `ok`. Stored in `repo.risk`, recomputed via `useMemo` when repos/conflicts/targetOrg change.

**Testing:** each rule has a unit test in `tests/components/MigrationWizard/RepoSelectStep/riskRules.test.js`. Pure functions → trivially testable.

### Section 4 — Visual Layout

```text
┌─ HERO DASHBOARD (rounded-2xl, gradient from-indigo-500/10 to-violet-500/10) ─┐
│ [🚀]  Choose what to migrate                     [✨ Smart Select ▾] [Reset] │
│       12 repos found · 3.2 GB total                                           │
│ ┌──────┬──────┬──────┬──────┐                                                 │
│ │  12  │   2  │   1  │   3  │  ← StatCard grid (4 cols, bg-white/60)         │
│ │Total │At-risk│Block.│Stale │                                                │
│ └──────┴──────┴──────┴──────┘                                                 │
└───────────────────────────────────────────────────────────────────────────────┘

[TFVC banner (existing) if applicable]

QUICK-FILTER CHIPS (only those with count > 0)
 [All 12] [⚡ Recommended 8] [⚠ At risk 3] [🚫 Blocked 1]
 [📦 Large 2] [💤 Stale 3] [🗃 Archived 1] [🔐 TFVC 0] [🔁 Conflicts 1]

TOOLBAR
 [🔍 Search…]  [Sort ▾]  [⊞/▦ View]  [Select ▾]            8 of 12 selected

REPO LIST (virtualized when >50)
 ┌─gradient-accent──────────────────────────────────────────────────┐
 │  │▣│  repo-name         [lang][size][branches][activity][LFS]   │
 │        default-branch · last commit 3d ago                    ▸  │
 │                                            [⚠ 2 risks]  [● conf] │
 └──────────────────────────────────────────────────────────────────┘
 …

STICKY SUMMARY BAR (appears when ≥1 selected)
 ┌── backdrop-blur-xl, bg-slate-950/70, border-indigo-500/20 ──────┐
 │ ◉ 3 selected · 2.1 GB · ~18 min · ⚠ 1   [Fix issues →]          │
 └─────────────────────────────────────────────────────────────────┘

DETAIL PANEL (slides from right, 420px, closes on Esc/backdrop)
 ┌───────────────────────────────────┐
 │ ←  repo-name              ⧉  🔗   │
 │ last update 3d ago · Bruno M.     │
 ├───────────────────────────────────┤
 │ ⚠ Risk Report (3)                 │
 │   [expanded flag cards]           │
 │                                   │
 │ 📊 Activity                       │
 │   sparkline + numbers             │
 │                                   │
 │ 📋 Details                        │
 │   default branch · language · …   │
 │                                   │
 │ 📖 README (preview)               │
 │   max-height 240px, fade bottom   │
 └───────────────────────────────────┘
```

#### Styling notes (matches existing wizard language)

* **Hero dashboard** — exact class signature of [RepoConfigStep.jsx:238](../../src/components/MigrationWizard/steps/RepoConfigStep.jsx#L238)
* **Stat cards** — `bg-white/60 dark:bg-slate-900/50 rounded-xl px-4 py-3 text-center` with `text-xl font-bold` number + `text-[10px] uppercase tracking-wider` label
* **Row accent** — `absolute top-0 left-0 bottom-0 w-[3px] rounded-l-xl bg-gradient-to-b from-{riskColor}`; color driven by `risk.level`:
  * `blocker` → `from-red-500 to-red-600`
  * `warning` → `from-amber-500 to-orange-500`
  * `info` → `from-slate-400 to-slate-500`
  * `ok` → `from-indigo-500 to-violet-500` *(default, identical to Configure)*
* **Sticky bar** — `sticky bottom-0 backdrop-blur-xl bg-slate-900/70 border-indigo-500/20 rounded-2xl shadow-indigo-500/10`
* **Detail panel** — `absolute right-0 top-0 bottom-0 w-[420px] bg-slate-900/95 backdrop-blur-xl border-l border-slate-800 shadow-[-8px_0_40px_rgba(0,0,0,0.4)]`; slide in via `motion` spring (`stiffness: 380, damping: 32`)

#### Loading state

Replace the existing `Loader2` spinner with **5 skeleton rows** using `ds-card-shimmer` from `design-system.css`. Matches density, keeps the user anchored visually.

### Section 5 — Functionality

#### 5.1 Smart-Select dropdown

```text
✨ Smart Select ▾
├── ⚡ Recommended (N)          → level='ok' & !archived & !stale
├── 🕒 Active in last year (N)
├── 🚫 Exclude archived
├── 🚫 Exclude stale
├── 🚫 Exclude blockers
├── ─────────────
├── ✏️  Select by pattern…      → small modal with regex + live count
└── 💾 Save as preset…           → localStorage['repoSelect:presets']
```

Presets scoped by `user + project` (keyed as `${org}/${project}`) to avoid cross-project leakage.

#### 5.2 Quick-filter chips

Chips are additive (multi-select = OR). Each chip shows a live count; the chip is hidden if `count === 0`. Keyboard: `F` focuses the first chip, arrow keys navigate, `Space/Enter` toggles.

#### 5.3 Search & Sort

* **Search**: matches on `name` + `language` + `description` (when lazy-loaded). Debounce 150ms. Highlight match in the row.
* **Sort**: adds `Last activity`, `Risk level` (blockers first), `Size asc/desc` to the existing options.
* **View mode** toggle (`⊞ List / ▦ Compact`): compact collapses row to 1 line (name + risk dot), useful for 200+ repos.

#### 5.4 Bulk-actions

Single primary button with dynamic label:
* `Select All` → `Deselect All (N)` → `Select All in filter (N)` when a filter is active.

Keyboard shortcuts:
* `Ctrl+A` — select all visible
* `Ctrl+Shift+A` — deselect all
* `I` — invert
* `/` — focus search
* `↑↓` — navigate rows
* `Space` — toggle selected
* `Enter` — open detail panel
* `Esc` — close panel
* `J/K` — prev/next repo within open panel
* `?` — open shortcut cheatsheet overlay

#### 5.5 Conflict preview in batch

Immediately after the initial repo fetch, issue **one** call to `/api/import/check-duplicates` with all repo names. Re-run on `source.targetOrg` change (debounced 500ms). Feeds `ruleNameConflict`. Configure step no longer runs it at mount.

#### 5.6 Detail panel

Contents (top to bottom):

1. **Header** — back-arrow, name, external link to `webUrl`, close button
2. **Risk Report** — expanded list of flags; each with suggestion text and any `actions` rendered as small buttons (e.g. `Auto-rename`, `Skip`, `Enable LFS`, `Learn more ↗`)
3. **Activity** — 12-month commit sparkline + `commitCount · contributorCount` (lazy)
4. **Details** — default branch, language, size, created date, Azure DevOps deep-link
5. **README preview** — fetched lazily; rendered with `react-markdown` (already available via other features) capped at 240px height with a bottom fade overlay

Navigation: `↑/↓` buttons in the panel header switch between repos without closing; `J/K` keyboard shortcuts do the same.

#### 5.7 Sticky selection summary bar

```text
◉ 3 selected   2.1 GB   ~18 min   ⚠ 1 warning   [Fix issues →]
```

* **Estimated time** — empirical `f(totalSize, totalBranches)`: baseline 30 MB/s clone + 3 s per branch overhead. Documented as heuristic, not a guarantee.
* **Warnings/blockers count** — clicking `Fix issues →` filters list to show only `risk.level ≠ ok` items among the selected.
* **Next button is blocked** when any selected repo has `risk.level === 'blocker'`. Tooltip explains. Keyboard: also blocks `Enter` navigation.

#### 5.8 Virtualization

* Threshold `VIRTUALIZATION_THRESHOLD = 50`. Below: native scroll. At or above: `@tanstack/react-virtual` (already in `package.json`).
* Keeps scroll position when filter/sort changes.

#### 5.9 Persistence

* **Filter state** — `sessionStorage['repoSelect:filters']`. Lost on wizard close (intentional — state shouldn't leak across sessions).
* **View mode** — `localStorage['repoSelect:viewMode']` (user preference, global).
* **Selection** — lives in wizard state; already preserved by breadcrumb nav when `source.org/project` unchanged.

#### 5.10 Accessibility

* List is `role="listbox" aria-multiselectable="true"`; rows `role="option" aria-selected` + `aria-describedby` to the risk pill
* `aria-live="polite"` region (single instance in `WizardPanel`) announces selection count & warning count changes
* Detail panel uses `focus-trap` (shared hook `useFocusTrap`) and `aria-modal="true"`
* All chips have `aria-pressed` for toggle state
* `Esc` closes panel and restores focus to the row that opened it

### Section 6 — Shared Components (cross-step coherence)

New directory `src/components/MigrationWizard/ui/repo/` with components reused across Select, Configure, AIReview, Schedule, Summary:

| Component | Props | Reused in |
|---|---|---|
| `RiskBadge` | `level, flags, size?` | Select rows, Configure cards, AIReview findings, Summary pre-flight |
| `RepoMetaBadges` | `repo, density?` | Select rows, Configure cards, AIReview repo list |
| `RepoRiskReport` | `flags, onAction` | Select detail panel, AIReview deep-dive |
| `StatCard` | `icon, label, value, tone?` | Select hero, Configure dashboard, Schedule summary |
| `SkeletonRow` | `variant?` | Select loading, Configure loading |
| `SectionHero` | `icon, title, subtitle, actions, children` | Select hero, Configure dashboard |

All extracted from existing inline markup; no visual regression intended. Centralizes the gradient tokens, sizing, and motion timings.

### Section 7 — Downstream Propagation

#### RepoConfigStep

* Reads `repo.conflictStatus` from wizard state; removes the `useEffect` that ran `checkConflict` for every repo on mount. Only re-runs `checkConflict` when the user edits an individual `targetName`.
* Renders `RiskBadge` on each card (reusing the Select component).
* Shows `defaultBranch` and `lastCommitDate` via shared `RepoMetaBadges`.
* Archived repos get `opacity-60` and an `Archived` pill.

#### AIReviewStep

`migrationApi.runAiReview(...)` is extended to accept `clientFindings` — the risk flags computed locally. Backend combines deterministic client flags with semantic LLM insights (ordering, inter-repo deps). UX: the **"Evaluating risks"** phase renders client flags instantly; subsequent phases still await the LLM. Perceived performance improves significantly.

#### ScheduleStep

`SummaryCard` gets the shared `StatCard` treatment. Adds stats: `Total size`, `Warnings count` (amber tone, hidden if 0).

#### SummaryStep

* New **Pre-flight** section near the top:

  ```text
  ✓ Pre-flight resolved 3 blockers and 2 warnings before migration
  • 1 name conflict → auto-renamed
  • 2 LFS markers detected → LFS enabled on target
  • 1 size warning → migrated with extended timeout
  ```

  Populated from the `risk.flags` snapshot captured when migration started.

#### BreadcrumbNav (minor)

When `selectedCount > 0` AND `totalWarnings > 0`, the pill becomes `3 repos ⚠` (existing shape, appended icon). Subtle feedback without disruption.

### Section 8 — Motion & Design Tokens

New file `src/components/MigrationWizard/ui/motion.js`:

```js
export const WIZARD_EASE = [0.16, 1, 0.3, 1]
export const WIZARD_SPRING = { type: 'spring', stiffness: 380, damping: 30 }
export const STAGGER_FAST = 0.03     // rows in large lists (>50)
export const STAGGER_NORMAL = 0.05   // cards in Configure
```

All step-level motion imports from this module. Eliminates the current mix of `'easeInOut'`, `'easeOut'`, ad-hoc springs.

Icon size conventions:
* Badges: `w-3`
* Buttons (secondary): `w-3.5`
* Section icons: `w-4`
* Hero icons: `w-5`

### Section 9 — File Layout

```text
src/components/MigrationWizard/
├── steps/
│   ├── RepoSelectStep.jsx                  # orchestrator — existing file replaced after flag removal
│   └── RepoSelectStep/                     # child components
│       ├── useEnrichedRepos.jsx
│       ├── useRiskEngine.jsx
│       ├── riskRules.js                    # pure rules
│       ├── SelectionDashboard.jsx
│       ├── QuickFilters.jsx
│       ├── SearchAndSort.jsx
│       ├── BulkActions.jsx
│       ├── SmartSelectMenu.jsx
│       ├── PatternSelectModal.jsx
│       ├── RepoList.jsx                    # virtualized wrapper
│       ├── RepoRow.jsx
│       ├── RepoDetailPanel.jsx
│       ├── RiskActionButton.jsx
│       └── SelectionSummaryBar.jsx
├── ui/
│   ├── motion.js
│   └── repo/
│       ├── RiskBadge.jsx
│       ├── RepoMetaBadges.jsx
│       ├── RepoRiskReport.jsx
│       ├── StatCard.jsx
│       ├── SkeletonRow.jsx
│       └── SectionHero.jsx
├── MigrationWizard.jsx                     # minor: breadcrumb warning pill
└── …

server/
├── routes/
│   └── azure.js                            # add /repos/activity, /repos/lfs-check, /repos/commit-activity, /repos/readme, /repos/full-stats
└── azure-service.js                        # add corresponding service functions

tests/
└── components/MigrationWizard/RepoSelectStep/
    ├── riskRules.test.js
    ├── useEnrichedRepos.test.jsx
    └── RepoRow.test.jsx

server/__tests__/
└── azure-repos-enriched.test.js
```

### Section 10 — Responsive Behavior

* `< 768 px`: chips scroll horizontally (`overflow-x-auto`); detail panel is full-screen instead of 420 px side-panel; sticky bar spans full width.
* `≥ 768 px && < 1280 px`: default layout.
* `≥ 1280 px`: detail panel can optionally be persistent (split view) — feature-flagged; default off for v1.

### Section 11 — Error & Empty States

* **Load error** — existing design preserved, improved copy and a `Retry` button.
* **Permission-denied (empty + TFVC off)** — keep existing `EmptyRepoState` with PAT diagnostics; it already works well.
* **All filters return 0** — illustration + "Clear filters" CTA. No selection bar when list is empty-filtered.
* **Blocker on attempted Next** — toast-less; Next button is disabled with tooltip *"N blocker(s) must be resolved — open a row to see options"*.

---

## Implementation Checkpoints

1. **Backend**: add the five new endpoints (`/activity`, `/lfs-check`, `/commit-activity`, `/readme`, `/full-stats`). Wire existing `listRepos` to also return `defaultBranch` and `webUrl` (already in response, just surface them consistently).
2. **State**: extend `useMigrationWizard` repo shape; ensure backwards compat for repos loaded pre-enrichment.
3. **Shared components**: build `src/components/MigrationWizard/ui/repo/*` and `motion.js` first — zero behavior changes, just extraction.
4. **Risk engine**: `riskRules.js` + `useRiskEngine` hook + unit tests.
5. **Select step**: rebuild around `useEnrichedRepos` + new subcomponents. Behind a feature flag `MIGRATION_SELECT_V2` initially; default on after QA.
6. **Downstream wiring**: Configure consumes cached conflict status; AIReview sends `clientFindings`; Schedule `SummaryCard` adopts `StatCard`; Summary adds Pre-flight block.
7. **BreadcrumbNav**: warning pill micro-change.
8. **Accessibility sweep**: live region, focus trap, keyboard shortcuts, cheatsheet overlay.

## Testing Strategy

* **Unit** — each rule in `riskRules.js` (pure); `useEnrichedRepos` state transitions; `useRiskEngine` memoization.
* **Integration (Vitest)** — `RepoRow` renders correct accent/badge for each `risk.level`; Smart-Select presets persist & restore; Pattern regex selection is sandboxed (no ReDoS — cap pattern length + timeout).
* **E2E (Playwright)** — happy path (Azure → pick → configure → schedule); large-repo warning path; name-conflict path with auto-rename; keyboard-only navigation.
* **Backend (Node test)** — `/repos/activity` batching respects `p-limit(5)`; error on individual repo does not fail the batch.

## Rollout & Risk

* Feature flag `MIGRATION_SELECT_V2` (default off in dev, on in staging) for a week.
* Telemetry: log `repo_select_risk_flags_shown` (counts by type), `repo_select_blocker_prevented_next` (prevention events), `repo_select_smart_select_used` (preset/menu usage).
* Rollback: flag off reverts to existing `RepoSelectStep.jsx` which is kept alongside during the transition.

## Open Questions

None remaining — all decisions resolved in brainstorming sessions on 2026-04-16.
