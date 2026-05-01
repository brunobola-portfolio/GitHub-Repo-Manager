# Action Surface Unification

**Date:** 2026-05-01
**Status:** Spec — pending review
**Author:** brainstorm session
**Owner:** Bruno
**Decomposition note:** This is slice **(1) of (5)** in the broader UX uniformity initiative. Slices (2) Intent affordances, (3) Dashboard wiring, (4) AI auto-fix Health, (5) Mobile parity sweep are out-of-scope for this spec and will get their own specs.

---

## 1. Goals & non-goals

### Goal

Make every repository action discoverable and actionable from any entry point (right-click context menu, quick-action button on the card, bottom selection bar, command palette), with consistent affordances about *what is going to happen*, and confirmation proportional to each action's risk.

### Non-goals

1. Redesigning `CommandPalette.jsx` — only export the builder; UI changes are a separate spec.
2. Toast-with-Undo — confirmations stay modal-based via `showConfirm` for now. Toast-Undo is a Phase 2 spec.
3. Long-press gestures on mobile — keep the existing `MoreHorizontal` button as the trigger.
4. Dashboard interactivity, AI auto-fix Health, mobile parity sweep — those are slices (3), (4), (5).
5. Redesigning the modals/pages each action *opens* (`MigrationWizard`, `Transfer`, etc.) — only invoke them consistently.

### Success criteria

- Adding a new repo action is **a single edit** in the registry (today: 3+ files).
- Every action has a human-readable `description` available in at least one surface before the user clicks.
- Destructive/irreversible actions never run without `showConfirm`.
- The selection bar serves all 8 batch actions: 7 already present in the context menu's batch mode plus `visibility_selected` (the one new addition this spec introduces).
- Mobile preserves the current `More`-button trigger without regression.

---

## 2. Architecture

### File layout

```
src/
├── actions/
│   ├── repoActions.js           ← THE registry (single source of truth)
│   ├── runAction.js             ← runner: confirm → run → toast → refresh
│   └── repoActionContext.jsx    ← React hook providing ctx to surfaces
├── components/
│   ├── RepoContextMenu.jsx      ← consumes registry, no own dispatch logic
│   ├── RepoList/
│   │   ├── RepoCard.jsx         ← Top 5 + More from registry
│   │   ├── SelectionBar.jsx     ← rich pill (desktop)
│   │   └── SelectionSheet.jsx   ← NEW — mobile bottom-sheet variant
│   └── ui/
│       └── ContextMenu.jsx      ← extended item shape: + description, + intent
└── utils/
    ├── aiActions.js             ← unchanged in this spec; cross-link in JSDoc
    └── repoMutations.js         ← NEW — extracted from App.jsx (performAction, archiveRepos)

tests/
└── actions/
    ├── repoActions.test.js      ← shape, IDs, snapshot, confirmation discipline
    └── runAction.test.js        ← runner behaviour: gate, errors, refresh
```

### Action shape (JSDoc in `.js`)

```js
/**
 * @typedef {Object} RepoAction
 * @property {string} id                              snake_case, unique
 * @property {((repo) => string)|string} label
 * @property {((repo) => string|null)|string|null} [description]
 * @property {LucideIcon} icon
 * @property {'navigation'|'copy'|'mutation'|'destructive'|'read-only'} intent
 * @property {Array<'contextMenu'|'quickAction'|'selectionBar'|'commandPalette'>} surfaces
 * @property {number} [quickActionPriority]           lower wins; only top 5 visible
 * @property {boolean} [isBatchSafe]                  default false
 * @property {(repo) => boolean} [isApplicable]       default () => true
 * @property {(target) => ConfirmConfig|null} [confirm]
 * @property {boolean} [triggersRefresh]              if true, runAction calls ctx.refresh() after success
 * @property {(target, ctx) => Promise<void>} run
 */

/**
 * @typedef {Object} ConfirmConfig
 * @property {string} title
 * @property {string} message                         aligned with existing showConfirm contract
 * @property {string} confirmText
 * @property {'info'|'warning'|'destructive'} variant
 * @property {{ kind: 'typeName', match: string }|null} [verification]
 */
```

### The runner

```js
// src/actions/runAction.js
export async function runAction(actionId, target, ctx) {
  const action = repoActions[actionId]
  if (!action) { ctx.toast.error(`Unknown action: ${actionId}`); return }

  const isBatch = Array.isArray(target)
  if (isBatch && !action.isBatchSafe) {
    ctx.toast.error(`${action.id} cannot run in batch mode`); return
  }

  const confirm = action.confirm?.(target)
  if (confirm) {
    const ok = await ctx.confirmGate(confirm)
    if (!ok) return
  }

  try {
    await action.run(target, ctx)
    if (action.triggersRefresh) ctx.refresh?.()
  } catch (err) {
    ctx.toast.errorFromException(err, { fallbackTitle: `${action.id} failed` })
  }
}
```

### Context provider

```js
// src/actions/repoActionContext.jsx
export function useRepoActionContext() {
  const { toast } = useToast()
  const { openModal, openModalWithData, closeModal } = useModal()
  const { refresh } = useGitHub()
  // performAction & archiveRepos extracted from App.jsx into src/utils/repoMutations.js
  // (see Migration Step 1 — extraction is part of this spec)
  return useMemo(() => ({
    api: reposApi,
    toast,
    openModal,
    openModalWithData,
    closeModal,
    refresh,
    performAction,
    archiveRepos,
    confirmGate: (cfg) => new Promise((resolve) => {
      openModalWithData('showConfirm', {
        ...cfg,
        onConfirm: () => { closeModal('showConfirm'); resolve(true) },
        onCancel:  () => { closeModal('showConfirm'); resolve(false) },
      })
    }),
  }), [toast, openModal, openModalWithData, closeModal, refresh])
}
```

`confirmGate` is a *wrapper* over the existing `showConfirm` modal contract, not a rewrite. The modal's `onConfirm`/`onCancel` callbacks remain responsible for closing themselves.

### What disappears

- [`RepoList/index.jsx` lines 177–288](../../src/components/RepoList/index.jsx) — the 110-line `switch (action)` block.
- [`App.jsx handleQuickAction`](../../src/App.jsx) — the ~50-line `switch (action)` block (App.jsx:488-590 region).
- Net deletion: ~160 lines of imperative dispatch.

---

## 3. Action catalogue

> **Confirm column legend.** The shorthand strings in the Confirm column map to `ConfirmConfig` as follows:
>
> - `—` → `confirm: () => null` (no confirmation)
> - `toast only` → `confirm: () => null`; success toast is informational only
> - `modal info` → `{ variant: 'info', verification: null }`
> - `modal warning` → `{ variant: 'warning', verification: null }`
> - `modal warning + list of repos` → `{ variant: 'warning', message includes the repo list }`
> - `type-name modal` → `{ variant: 'destructive', verification: { kind: 'typeName', match: <repo.name or "delete N repos"> } }`

### Single-repo actions

| ID | Label | Intent | Surfaces | Confirm | quickActionPriority |
|---|---|---|---|---|---|
| `open_detail` | Open Details | navigation | menu, quick, palette | — | 10 |
| `open_repo_settings` | Open Settings | navigation | menu, palette | — | — |
| `open_on_github` | Open on GitHub | navigation | menu, palette | — | — |
| `copy_clone_https` | Copy HTTPS URL | copy | menu (sub), palette | — | — |
| `copy_clone_ssh` | Copy SSH URL | copy | menu (sub), palette | — | — |
| `copy_clone_gh` | Copy `gh` CLI | copy | menu (sub), palette | — | — |
| `migrate` | Migrate to GitHub | mutation | menu (sub), palette | — | — |
| `migration_history` | Migration History | navigation | menu (sub), palette | — | — |
| `dry_run` | Dry-Run (Simulate) | read-only | menu (sub), palette | — | — |
| `ai_commit` | Generate Commit Message | read-only | menu (sub), palette | — | — |
| `ai_pr` | Generate PR Description | read-only | menu (sub), palette | — | — |
| `ai_quality` | Quality Report | read-only | menu (sub), quick, palette | — | 40 |
| `ai_suggest_name_desc` | Suggest Name & Description | mutation | menu (sub), palette | — | — |
| `ai_compare` | Compare with Existing | read-only | menu (sub), palette | — | — |
| `ai_security` | Security / Secrets Scan | read-only | menu (sub), palette | — | — |
| `transfer` | Transfer to Org | mutation | menu (sub), palette | modal info | — |
| `mirror` | Mirror / Fork | mutation | menu (sub), palette | — | — |
| `sync` | Sync Repository | mutation | menu (sub), palette | modal info | — |
| `export_meta` | Export Metadata | read-only | menu (sub), palette | — | — |
| `visibility` | Make Public/Private | mutation | menu, quick, palette | modal warning | 20 |
| `archive` | Archive/Unarchive | mutation | menu, quick, palette | toast only `@unconfirmed-by-design highly reversible` | 30 |
| `delete` | Delete Repository | destructive | menu, palette | type-name modal | — |
| `community_health` | Community Health | navigation | menu, quick, palette | — | 50 |

**Top 5 quick-actions** (left-to-right on hover): `open_detail` → `visibility` → `archive` → `ai_quality` → `community_health`. Sixth slot is `MoreHorizontal` opening the context menu at the button position. The `More` button is visible on **all breakpoints** (in mobile it's the only trigger; in desktop it's an alternative to right-click for users who don't right-click).

### Batch actions (`isBatchSafe: true`)

| ID | Label | Confirm |
|---|---|---|
| `archive_selected` | Archive N | toast only |
| `transfer_selected` | Transfer N | modal info + list of repos |
| `migrate_selected` | Migrate N | — |
| `dry_run_selected` | Dry-Run N | — |
| `export_meta_selected` | Export N | — |
| `ai_batch_index_selected` | Batch Index with AI | — |
| `visibility_selected` | Make N Public/Private | modal warning + list (**new feature**) |
| `delete_selected` | Delete N | type "delete N repos" modal |

### Selection bar layout

**Desktop (rich pill, left-to-right):**
`Archive` · `Transfer` · `Migrate` · `Visibility` · `Export` · separator · `Delete` (red, right-aligned).
Overflow `⋯`: `Dry-Run`, `AI Batch Index`.

**Mobile (`useMobileBreakpoint()` true):** `<SelectionSheet>` — full vertical list of all batch actions with labels, opened from the count pill, using existing `<MobileDrawer>`.

### Description / tooltip surfacing

- **Quick-action buttons:** native `title` tooltip (already wired) shows `description`.
- **Context menu items:** two-line layout — bold label + small description below, only for leaf items (submenus stay single-line because their children carry their own descriptions). `ContextMenu.jsx` extends item shape with `description` + `intent`. Width bumps from `min-w-[200px] max-w-[280px]` → `min-w-[260px] max-w-[340px]`.
- **`showConfirm` modal:** description copy goes into the modal `message` field.

### ID renames vs today

The new registry uses snake_case throughout, aligning with `AI_ACTIONS` already in [aiActions.js](../../src/utils/aiActions.js). Renames the migration must apply:

| Today (camelCase) | Registry (snake_case) |
|---|---|
| `openDetail` | `open_detail` |
| `openRepoSettings` | `open_repo_settings` (already correct in `AI_ACTIONS`) |
| `aiCommit` | `ai_commit` |
| `generatePR` | `ai_pr` |
| `aiQuality` | `ai_quality` |
| `aiSuggest` | `ai_suggest_name_desc` |
| `aiCompare` | `ai_compare` |
| `aiSecurity` | `ai_security` |
| `aiBatchIndex_selected` | `ai_batch_index_selected` |
| `migrationHistory` | `migration_history` |
| `dryRun` / `dryRun_selected` | `dry_run` / `dry_run_selected` |
| `exportMeta` / `exportMeta_selected` | `export_meta` / `export_meta_selected` |

Call-sites to update: `RepoContextMenu.jsx`, `RepoList/index.jsx` switch, `App.jsx handleQuickAction`, any `app:open-repo-settings` event consumers.

---

## 4. Migration plan

### Steps

Each step is a separate commit, mergeable in isolation. Behavioural equivalence between old and new code paths is enforced by tests, not by deletion order — transient duplication during the rollout is tolerated.

1. **Foundation with full `run()` implementations.** Create `src/actions/repoActions.js`, `runAction.js`, `repoActionContext.jsx`. Every `run()` is fully implemented (calls `reposApi`, `archiveRepos`, etc., not stubs). Extract `performAction` + `archiveRepos` from `App.jsx` into `src/utils/repoMutations.js` so they're reachable from `ctx`. Tests pass against the registry directly. **No surfaces wired yet.**
2. **Migrate context menu.** `RepoContextMenu.jsx` consumes the registry filtered by `surfaces.includes('contextMenu')`. Extend `ContextMenu` item shape with `description` + `intent`. Delete the 110-line switch in `RepoList/index.jsx`; replace with `onAction={(id, target) => runAction(id, target, ctx)}`.
3. **Migrate quick-actions.** `RepoCard.jsx` quick-actions consume the registry filtered by `surfaces.includes('quickAction')` and ordered by `quickActionPriority`. Top 5 + `MoreHorizontal`.
4. **Migrate selection bar.** `SelectionBar.jsx` becomes a rich pill (desktop) consuming `surfaces.includes('selectionBar') && isBatchSafe`. New `SelectionSheet.jsx` (mobile) using `MobileDrawer`. Switch via `useMobileBreakpoint()`.
5. **Delete `App.jsx handleQuickAction` switch.** Migrate the call-sites of `onQuickAction(...)` in `App.jsx` to `runAction(...)`. Delete the 50-line switch.
6. **Export `buildRepoActionCommands`.** `repoActions.js` exports a builder filtering `surfaces.includes('commandPalette')`. *Does not* touch `CommandPalette.jsx` — only the builder is available for a future spec to consume.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Stale UI after mutation (`refresh()` not fired)** | Architectural rule: every action with `intent in ['mutation','destructive']` declares `triggersRefresh: true`. `runAction` calls `ctx.refresh?.()` after `run()` resolves successfully (never on failure). Tested explicitly. |
| **Breaking external action IDs (AI assistant)** | `aiActions.js` stays intact in this spec. The IDs that overlap (`open_repo_settings`) are already snake_case there — no rename required for the AI assistant path. |
| **`showConfirm` race in `confirmGate`** | `runAction.test.js` verifies that cancel resolves `false` AND `action.run` is never called; only confirm resolves `true` and proceeds. |
| **`isApplicable` not honoured in surfaces** | Each surface filters by `isApplicable(repo)` before rendering. Test asserts disabled item for `sync` on a non-mirror repo. |
| **Selection bar mobile bottom-sheet new UI** | E2E test simulates touch viewport and verifies the sheet opens with the correct list of batch actions. |
| **Test debt — 2782 unit tests may import old IDs** | Snapshot test of registry IDs runs first; if a test depends on the old camelCase ID, it fails immediately and the migration is explicit. |
| **`performAction`/`archiveRepos` extraction** | Extracted into `src/utils/repoMutations.js` in Step 1 with their own unit tests; `App.jsx` imports from the new location. Pure refactor commit, no behaviour change. |

### Out-of-spec follow-ups

1. **Toast-with-Undo** — `toast.success(msg, { undo })` extension; needs its own design (state machine, inverse declaration per action, race handling).
2. **CommandPalette consumes registry** — replace `buildReposCommands` with `buildRepoActionCommands`; deprecate the duplicate.
3. **Mobile long-press → bottom-sheet** — Phase 2 mobile-parity spec.
4. **Per-user pinning of quick-actions** — if usage signals demand it.
5. **Action telemetry** — `ctx.track?.(actionId, durationMs, success)` to inform Top 5 with real usage data.

---

## 5. Testing & acceptance

### Unit tests (Vitest)

- **`tests/actions/repoActions.test.js`**
  - Each action has required fields (`id`, `label`, `icon`, `intent`, `surfaces`, `run`).
  - IDs are unique and snake_case.
  - Each `surface` ∈ `['contextMenu','quickAction','selectionBar','commandPalette']`.
  - Each `intent` ∈ `['navigation','copy','mutation','destructive','read-only']`.
  - Snapshot of full ID list (anti-regression for accidental deletion).
  - Actions with `isBatchSafe: false` cause `runAction` to error when `target` is an array.
  - **Confirmation discipline:** for every action with `intent in ['mutation','destructive']`, either `confirm !== null` OR the action's JSDoc contains `@unconfirmed-by-design <reason>`. Test parses JSDoc; failure on missing both.

- **`tests/actions/runAction.test.js`**
  - Cancel in `confirmGate` → `action.run` never called.
  - Confirm in `confirmGate` → `action.run` called with target.
  - `action.run` throws → `toast.errorFromException` called, no rethrow.
  - `triggersRefresh: true` + success → `ctx.refresh()` called.
  - `triggersRefresh: true` + `run` throws → `ctx.refresh` **not** called.
  - Mock ctx, no UI dependencies.

- **`tests/components/RepoList/SelectionBar.test.jsx`**
  - Desktop pill: 6 visible buttons (Archive, Transfer, Migrate, Visibility, Export, Delete).
  - Overflow contains Dry-Run + AI Batch Index.
  - `useMobileBreakpoint() === true` → renders `<SelectionSheet>` instead of pill.
  - Delete styled distinct (red/amber).

- **`tests/components/ui/ContextMenu.test.jsx`** (extend existing)
  - Item with `description` renders two-line layout.
  - Item without `description` renders single-line (backwards compatibility for other menus).
  - `intent: 'destructive'` applies the destructive classes.

### E2E tests (Playwright)

- **`e2e/action-surface-parity.spec.js`**
  - Open repo list, right-click a card, choose Archive → repo appears archived.
  - Hover the same card, click the Archive quick-action button → identical behaviour.
  - Select 3 repos, open selection bar, click Archive → 3 repos archived.
  - Mobile viewport: tap `More` → menu opens, same action works.

- **`e2e/confirm-gates.spec.js`**
  - Right-click → Make Private → cancel → repo stays public.
  - Right-click → Make Private → confirm → repo is now private.
  - Right-click → Delete → modal asks for repo name; submit disabled while name mismatches; submit enabled when name matches; click → repo deleted.

### Acceptance criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | Adding a new action is a single edit | Code review: a new PR touches only `src/actions/repoActions.js` (+ test). |
| 2 | Mutation/destructive actions are confirmed or explicitly justified | Test parses each action's JSDoc; passes if `confirm` non-null or `@unconfirmed-by-design <reason>` present. |
| 3 | Selection bar has ≥6 visible actions | E2E test. |
| 4 | `App.jsx handleQuickAction` switch is gone | `grep handleQuickAction src/App.jsx` returns empty. |
| 5 | `RepoList/index.jsx` switch is gone | `grep "case 'archive':" src/components/RepoList/index.jsx` returns empty. |
| 6 | Context-menu set equals registry contextMenu set | Test asserts **set equality** (not just length): IDs rendered by `RepoContextMenu` ≡ `Object.values(repoActions).filter(a => a.surfaces.includes('contextMenu')).map(a => a.id)`. |
| 7 | Mobile bottom-sheet appears on viewport `<md` | E2E test. |
| 8 | Zero regression in existing tests | CI `npx vitest && npx playwright test` green. |
| 9 | Bundle delta neutral or smaller | `npm run build` before/after — registry deduplicates imports. |

### Definition of done

After step 6 merges, `git diff main..HEAD --stat` should show ~+800 added lines (registry, tests, new components) and ~−400 deleted lines (switches removed). All 9 acceptance criteria pass. The spec ships when CI is green and a manual smoke test of the four surfaces (right-click, quick-action, selection bar, palette builder availability) confirms identical end-state.

### Documentation

- Update [docs/architecture/overview.md](../architecture/overview.md) with an "Action Registry" section linking to `src/actions/repoActions.js`.
- JSDoc at the top of `repoActions.js` shows a full example of adding a new action.
- No separate README in `src/actions/` — the JSDoc is the documentation.
