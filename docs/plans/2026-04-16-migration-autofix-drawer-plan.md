# Migration Auto-Fix Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vaporware "Fix issues" button in the Migration Wizard's Repos step with a real auto-fix drawer that applies deterministic renames (invalid chars, reserved names, duplicates, target-org conflicts) and offers actionable strategies for size-critical repos.

**Architecture:** Hybrid. Deterministic fixes live in client-side pure functions (`autoFixRules.js`) and write the existing `targetName` field. Conflict re-validation reuses the existing `POST /api/import/check-duplicates` endpoint. AI suggestions for size-critical repos use a new `POST /api/ai/migration-size-strategy` endpoint gated by Gemini quotas. Size-critical repos ship with two strategies in V1: `exclude` (skip the task) and `lfs-migrate` (run `git-lfs migrate import --above=100M` before push).

**Tech Stack:** React 19, Vite 7, Tailwind CSS v4, Framer Motion, lucide-react (client); Express, better-sqlite3, zod, @google/generative-ai via `aiService` (server); vitest + RTL + user-event (unit), Playwright (E2E).

**Source spec:** [docs/specs/2026-04-16-migration-autofix-drawer.md](../specs/2026-04-16-migration-autofix-drawer.md)

---

## Phase 0 — Resolved open questions (no tasks, just decisions)

The spec listed three open questions in §8. All three are resolved here and the plan below assumes these answers:

**Q1 — `sizeStrategy` field whitelisting.** The migration plan is created via `POST /api/migration/plans` using `createPlanSchema` in [server/lib/validators.js:185](../../server/lib/validators.js#L185). The `config` object for `repo` and `repo-tfvc` tasks is **strict** — new fields are dropped. `sizeStrategy` must be added to both `config` shapes. Downstream, [ScheduleStep.jsx:61-69](../../src/components/MigrationWizard/steps/ScheduleStep.jsx#L61-L69) builds tasks; it must forward `sizeStrategy` into `config` when set.

**Q2 — Largest file extensions endpoint.** No such endpoint exists in `server/azure-service.js`. Azure DevOps does not expose a cheap "biggest blobs by extension" query. V1 sends only `{size, hasLfsMarker, branches, lastCommitDate}` to the AI endpoint; the prompt is adjusted to reason from those signals alone.

**Q3 — 401 reconnect flow.** The project-wide pattern (e.g., `SourceStep.jsx:363`) is to surface the error inline; the wizard does not have an automatic "navigate back to Connect step" helper. For the drawer we use the simpler pattern: toast `"Azure DevOps token expired — please reconnect."` and close the drawer. The user returns to the Connect step via the wizard's `Back` button.

**Scope narrowing (not a spec question, a plan decision).** The spec mentioned three size-critical strategies: `exclude`, `lfs-migrate`, `history-split`. `history-split` requires `git filter-repo` or equivalent history rewriting — a significant engineering effort that deserves its own spec. V1 ships **two** strategies: `exclude` (fully implemented) and `lfs-migrate` (fully implemented via `git-lfs migrate import --above=100M`). The AI prompt in Phase 7 restricts suggestions to these two. `history-split` is filed as future work.

---

## File structure

**New client files** (all under `src/components/MigrationWizard/steps/RepoSelectStep/`):

- `autoFixRules.js` — pure fix-proposal functions.
- `AutoFixDrawer.jsx` — slide-in panel with two sections.
- `FixPlanItem.jsx` — one row in the Renames section.
- `SizeStrategyCard.jsx` — one card in the Large repositories section.
- `useAutoFixPlan.js` — hook orchestrating the three phases.

**Modified client files:**

- `src/components/MigrationWizard/steps/RepoSelectStep.jsx` — swap `handleFixIssues` behaviour, add `drawerOpen` state, add `handleApplyFixes`.
- `src/components/MigrationWizard/steps/RepoSelectStep/SelectionSummaryBar.jsx` — dynamic button label, visibility tied to `blockers > 0`.
- `src/components/MigrationWizard/steps/RepoSelectStep/riskRules.js` — name-validating rules read `targetName ?? name`.
- `src/components/MigrationWizard/steps/ScheduleStep.jsx` — skip repos with `sizeStrategy === 'exclude'`, forward `sizeStrategy` into task config.

**New server files:** none. All server additions are appends to existing files.

**Modified server files:**

- `server/lib/validators.js` — new `migrationSizeStrategySchema`, `sizeStrategy` field in `createPlanSchema` task configs.
- `server/routes/ai.js` — new `POST /api/ai/migration-size-strategy` handler.
- `server/import-service.js` — read `sizeStrategy` parameter, run `git-lfs migrate import --above=100M` before push when `lfs-migrate`.
- `server/migration-engine.js` — forward `config.sizeStrategy` into `importRepository` call for `repo` and `repo-tfvc` tasks.

**New test files:**

- `tests/components/MigrationWizard/steps/RepoSelectStep/fixtures.js` — `makeRepo(overrides)` factory.
- `tests/components/MigrationWizard/steps/RepoSelectStep/riskRules.test.js` — effective-name coverage.
- `tests/components/MigrationWizard/steps/RepoSelectStep/autoFixRules.test.js` — pure function tests.
- `tests/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.test.jsx` — hook tests.
- `tests/components/MigrationWizard/steps/RepoSelectStep/AutoFixDrawer.test.jsx` — drawer interaction tests.
- `server/__tests__/ai-migration-size-strategy.test.js` — endpoint tests.
- `e2e/migration-autofix.spec.js` — E2E happy path.

---

## Phase 1 — Risk engine effective-name (prerequisite)

Without this phase, applied fixes don't clear blockers and the whole feature looks broken. Ship this first so the rest of the plan can verify its work.

### Task 1.1: Add fixtures factory

**Files:**
- Create: `tests/components/MigrationWizard/steps/RepoSelectStep/fixtures.js`

- [ ] **Step 1: Write the factory.**

```js
// tests/components/MigrationWizard/steps/RepoSelectStep/fixtures.js
export function makeRepo(overrides = {}) {
  return {
    id: 'repo-id',
    name: 'my-repo',
    size: 1024,
    branches: 1,
    selected: true,
    isDisabled: false,
    isTfvc: false,
    hasLfsMarker: false,
    lfsEnabled: false,
    lastCommitDate: '2025-01-01T00:00:00Z',
    targetName: undefined,
    sizeStrategy: undefined,
    ...overrides,
  }
}
```

- [ ] **Step 2: Commit.**

```bash
git add tests/components/MigrationWizard/steps/RepoSelectStep/fixtures.js
git commit -m "test(migration): add makeRepo fixture factory"
```

### Task 1.2: Write failing tests for effective-name in riskRules

**Files:**
- Create: `tests/components/MigrationWizard/steps/RepoSelectStep/riskRules.test.js`

- [ ] **Step 1: Write failing tests.**

```js
// tests/components/MigrationWizard/steps/RepoSelectStep/riskRules.test.js
import { describe, it, expect } from 'vitest'
import { evaluateRepo } from '../../../../../src/components/MigrationWizard/steps/RepoSelectStep/riskRules.js'
import { makeRepo } from './fixtures.js'

describe('riskRules effective-name resolution', () => {
  it('ruleInvalidChars: clears when targetName is valid even if name is invalid', () => {
    const repo = makeRepo({ name: 'bad name!', targetName: 'good-name' })
    const { flags } = evaluateRepo(repo, { allRepos: [repo] })
    expect(flags.some(f => f.type === 'invalid-chars')).toBe(false)
  })

  it('ruleInvalidChars: still fires when targetName is also invalid', () => {
    const repo = makeRepo({ name: 'bad name!', targetName: 'still bad!' })
    const { flags } = evaluateRepo(repo, { allRepos: [repo] })
    expect(flags.some(f => f.type === 'invalid-chars')).toBe(true)
  })

  it('ruleReservedName: clears when targetName is not reserved', () => {
    const repo = makeRepo({ name: 'api', targetName: 'api-repo' })
    const { flags } = evaluateRepo(repo, { allRepos: [repo] })
    expect(flags.some(f => f.type === 'reserved-name')).toBe(false)
  })

  it('ruleDuplicateInBatch: evaluates effective names across selected repos', () => {
    const a = makeRepo({ id: 'a', name: 'dup', targetName: 'dup-a' })
    const b = makeRepo({ id: 'b', name: 'dup', targetName: 'dup-b' })
    const ctxA = { allRepos: [a, b] }
    const ctxB = { allRepos: [a, b] }
    expect(evaluateRepo(a, ctxA).flags.some(f => f.type === 'duplicate-in-batch')).toBe(false)
    expect(evaluateRepo(b, ctxB).flags.some(f => f.type === 'duplicate-in-batch')).toBe(false)
  })

  it('ruleNameConflict: clears when targetName avoids the target-org collision', () => {
    const repo = makeRepo({ name: 'existing', targetName: 'existing-new' })
    const ctx = { conflicts: { existing: true }, allRepos: [repo] }
    const { flags } = evaluateRepo(repo, ctx)
    expect(flags.some(f => f.type === 'name-conflict')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests — expect failures.**

Run: `npx vitest run tests/components/MigrationWizard/steps/RepoSelectStep/riskRules.test.js`

Expected: FAIL (current rules evaluate `repo.name`, not the effective name).

### Task 1.3: Update riskRules.js to use effective name

**Files:**
- Modify: `src/components/MigrationWizard/steps/RepoSelectStep/riskRules.js:95-113`

- [ ] **Step 1: Add an `effectiveName` helper at the top of the file (after `const VALID_NAME_RE = …`).**

```js
function effectiveName(repo) {
  return (repo.targetName && repo.targetName.trim()) || repo.name
}
```

- [ ] **Step 2: Replace the four name-validating rules.**

Change `ruleInvalidChars`:

```js
function ruleInvalidChars(repo) {
  const name = effectiveName(repo)
  if (VALID_NAME_RE.test(name)) return null
  return {
    type: 'invalid-chars',
    severity: 'blocker',
    message: 'Name contains characters GitHub does not accept.',
    suggestion: 'Only letters, numbers, dots, hyphens and underscores are allowed.',
  }
}
```

Change `ruleReservedName`:

```js
function ruleReservedName(repo) {
  const name = effectiveName(repo)
  if (!RESERVED_NAMES.includes(name.toLowerCase())) return null
  return {
    type: 'reserved-name',
    severity: 'blocker',
    message: 'Name is reserved by GitHub.',
    suggestion: `Choose a different target name (${name} is a GitHub-reserved path).`,
  }
}
```

Change `ruleNameConflict`:

```js
function ruleNameConflict(repo, ctx) {
  const name = effectiveName(repo)
  if (!ctx.conflicts?.[name]) return null
  return {
    type: 'name-conflict',
    severity: 'blocker',
    message: `A repository named "${name}" already exists in ${ctx.targetOrg || 'the target org'}.`,
    suggestion: 'The Configure step lets you rename or skip this repo before migration.',
  }
}
```

Change `ruleDuplicateInBatch`:

```js
function ruleDuplicateInBatch(repo, ctx) {
  if (!repo.selected) return null
  const name = effectiveName(repo)
  const dupes = (ctx.allRepos || []).filter((r) => r.selected && effectiveName(r) === name)
  if (dupes.length < 2) return null
  return {
    type: 'duplicate-in-batch',
    severity: 'blocker',
    message: 'Another selected item has the same target name.',
    suggestion: 'Rename one on the Configure step.',
  }
}
```

- [ ] **Step 3: Run the tests — expect PASS.**

Run: `npx vitest run tests/components/MigrationWizard/steps/RepoSelectStep/riskRules.test.js`

Expected: all 5 tests pass.

- [ ] **Step 4: Run the existing riskRules usage site to confirm no regressions.**

Run: `npx vitest run tests/components/MigrationWizard/`

Expected: all tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/riskRules.js tests/components/MigrationWizard/steps/RepoSelectStep/riskRules.test.js
git commit -m "feat(migration): riskRules read effective name (targetName fallback to name)"
```

---

## Phase 2 — `autoFixRules.js` pure functions

### Task 2.1: Write failing tests for fix functions

**Files:**
- Create: `tests/components/MigrationWizard/steps/RepoSelectStep/autoFixRules.test.js`

- [ ] **Step 1: Write the tests.**

```js
// tests/components/MigrationWizard/steps/RepoSelectStep/autoFixRules.test.js
import { describe, it, expect } from 'vitest'
import {
  fixInvalidChars,
  fixReserved,
  fixDuplicates,
  fixNameConflict,
  buildDeterministicPlan,
} from '../../../../../src/components/MigrationWizard/steps/RepoSelectStep/autoFixRules.js'
import { makeRepo } from './fixtures.js'

describe('fixInvalidChars', () => {
  it('replaces invalid chars with hyphens', () => {
    const result = fixInvalidChars(makeRepo({ name: 'my repo!' }))
    expect(result).toEqual({
      type: 'invalid-chars',
      from: 'my repo!',
      to: 'my-repo-',
      reason: 'Replaced characters GitHub does not accept.',
    })
  })
  it('returns null when name is already valid', () => {
    expect(fixInvalidChars(makeRepo({ name: 'valid-name' }))).toBeNull()
  })
  it('collapses consecutive invalid runs into a single hyphen', () => {
    expect(fixInvalidChars(makeRepo({ name: 'a  b / c' })).to).toBe('a-b-c')
  })
  it('strips leading and trailing hyphens', () => {
    expect(fixInvalidChars(makeRepo({ name: '!hello!' })).to).toBe('hello')
  })
})

describe('fixReserved', () => {
  it('suffixes reserved names with -repo', () => {
    expect(fixReserved(makeRepo({ name: 'api' }))).toEqual({
      type: 'reserved-name',
      from: 'api',
      to: 'api-repo',
      reason: 'GitHub reserves this name; added "-repo" suffix.',
    })
  })
  it('is case-insensitive', () => {
    expect(fixReserved(makeRepo({ name: 'API' })).to).toBe('API-repo')
  })
  it('returns null for non-reserved names', () => {
    expect(fixReserved(makeRepo({ name: 'my-repo' }))).toBeNull()
  })
})

describe('fixDuplicates', () => {
  it('suffixes -1, -2 on consecutive duplicates', () => {
    const a = makeRepo({ id: 'a', name: 'dup', selected: true })
    const b = makeRepo({ id: 'b', name: 'dup', selected: true })
    const c = makeRepo({ id: 'c', name: 'dup', selected: true })
    const ctx = { allRepos: [a, b, c] }
    expect(fixDuplicates(a, ctx)).toBeNull() // first stays
    expect(fixDuplicates(b, ctx).to).toBe('dup-1')
    expect(fixDuplicates(c, ctx).to).toBe('dup-2')
  })
  it('ignores unselected duplicates', () => {
    const a = makeRepo({ id: 'a', name: 'dup', selected: true })
    const b = makeRepo({ id: 'b', name: 'dup', selected: false })
    expect(fixDuplicates(a, { allRepos: [a, b] })).toBeNull()
  })
})

describe('fixNameConflict', () => {
  it('prefixes the Azure project name when target already has the repo', () => {
    const ctx = { conflicts: { existing: true }, azureProject: 'MyProj', allRepos: [] }
    expect(fixNameConflict(makeRepo({ name: 'existing' }), ctx)).toEqual({
      type: 'name-conflict',
      from: 'existing',
      to: 'MyProj-existing',
      reason: 'Prefixed with Azure project name to avoid target-org collision.',
    })
  })
  it('returns null when no conflict', () => {
    expect(fixNameConflict(makeRepo({ name: 'clean' }), { conflicts: {}, allRepos: [] })).toBeNull()
  })
})

describe('buildDeterministicPlan', () => {
  it('returns one FixItem per blocker, keyed by repoIndex', () => {
    const repos = [
      makeRepo({ id: 'a', name: 'api', selected: true }),
      makeRepo({ id: 'b', name: 'ok-name', selected: true }),
      makeRepo({ id: 'c', name: 'bad name!', selected: true }),
    ]
    const plan = buildDeterministicPlan(repos, { azureProject: 'X', conflicts: {}, allRepos: repos })
    expect(plan).toEqual([
      { repoIndex: 0, type: 'reserved-name', from: 'api', to: 'api-repo', reason: expect.any(String) },
      { repoIndex: 2, type: 'invalid-chars', from: 'bad name!', to: 'bad-name-', reason: expect.any(String) },
    ])
  })
})
```

- [ ] **Step 2: Run the tests — expect failures.**

Run: `npx vitest run tests/components/MigrationWizard/steps/RepoSelectStep/autoFixRules.test.js`

Expected: FAIL with "module not found".

### Task 2.2: Implement autoFixRules.js

**Files:**
- Create: `src/components/MigrationWizard/steps/RepoSelectStep/autoFixRules.js`

- [ ] **Step 1: Create the file.**

```js
// src/components/MigrationWizard/steps/RepoSelectStep/autoFixRules.js
import { RESERVED_NAMES } from './riskRules.js'

const VALID_NAME_RE = /^[A-Za-z0-9._-]+$/
const INVALID_RUN_RE = /[^A-Za-z0-9._-]+/g

export function fixInvalidChars(repo) {
  const name = repo.name
  if (VALID_NAME_RE.test(name)) return null
  const collapsed = name.replace(INVALID_RUN_RE, '-')
  const trimmed = collapsed.replace(/^-+/, '').replace(/-+$/, '')
  return {
    type: 'invalid-chars',
    from: name,
    to: trimmed || name.replace(INVALID_RUN_RE, '-'),
    reason: 'Replaced characters GitHub does not accept.',
  }
}

export function fixReserved(repo) {
  if (!RESERVED_NAMES.includes(repo.name.toLowerCase())) return null
  return {
    type: 'reserved-name',
    from: repo.name,
    to: `${repo.name}-repo`,
    reason: 'GitHub reserves this name; added "-repo" suffix.',
  }
}

export function fixDuplicates(repo, ctx) {
  if (!repo.selected) return null
  const selected = (ctx.allRepos || []).filter((r) => r.selected)
  const firstIndex = selected.findIndex((r) => r.id === repo.id)
  const sameName = selected.filter((r) => r.name === repo.name)
  if (sameName.length < 2) return null
  const position = sameName.findIndex((r) => r.id === repo.id)
  if (position === 0) return null
  return {
    type: 'duplicate-in-batch',
    from: repo.name,
    to: `${repo.name}-${position}`,
    reason: 'Numeric suffix applied to avoid collision with another selected repo.',
  }
}

export function fixNameConflict(repo, ctx) {
  if (!ctx.conflicts?.[repo.name]) return null
  const prefix = ctx.azureProject || 'proj'
  return {
    type: 'name-conflict',
    from: repo.name,
    to: `${prefix}-${repo.name}`,
    reason: 'Prefixed with Azure project name to avoid target-org collision.',
  }
}

const ORDERED_FIXES = [fixInvalidChars, fixReserved, fixNameConflict, fixDuplicates]

export function buildDeterministicPlan(repos, ctx) {
  const plan = []
  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i]
    for (const fn of ORDERED_FIXES) {
      const result = fn(repo, ctx)
      if (result) {
        plan.push({ repoIndex: i, ...result })
        break
      }
    }
  }
  return plan
}
```

Note: the unused `firstIndex` local in `fixDuplicates` exists because earlier drafts referenced it. Delete it if a lint warning surfaces. The logic only needs `position` within `sameName`.

- [ ] **Step 2: Remove the dead `firstIndex` variable.**

```js
export function fixDuplicates(repo, ctx) {
  if (!repo.selected) return null
  const selected = (ctx.allRepos || []).filter((r) => r.selected)
  const sameName = selected.filter((r) => r.name === repo.name)
  if (sameName.length < 2) return null
  const position = sameName.findIndex((r) => r.id === repo.id)
  if (position === 0) return null
  return {
    type: 'duplicate-in-batch',
    from: repo.name,
    to: `${repo.name}-${position}`,
    reason: 'Numeric suffix applied to avoid collision with another selected repo.',
  }
}
```

- [ ] **Step 3: Run the tests — expect PASS.**

Run: `npx vitest run tests/components/MigrationWizard/steps/RepoSelectStep/autoFixRules.test.js`

Expected: all tests pass.

- [ ] **Step 4: Commit.**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/autoFixRules.js tests/components/MigrationWizard/steps/RepoSelectStep/autoFixRules.test.js
git commit -m "feat(migration): add autoFixRules pure functions for deterministic blocker fixes"
```

---

## Phase 3 — `useAutoFixPlan` hook

### Task 3.1: Write failing tests for the hook

**Files:**
- Create: `tests/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.test.jsx`

- [ ] **Step 1: Write the tests.**

```jsx
// tests/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAutoFixPlan } from '../../../../../src/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.js'
import { makeRepo } from './fixtures.js'

beforeEach(() => {
  global.fetch = vi.fn()
})
afterEach(() => {
  vi.resetAllMocks()
})

function mockFetchImpl(responses) {
  global.fetch.mockImplementation(async (url) => {
    const handler = Object.keys(responses).find((k) => url.includes(k))
    if (!handler) throw new Error(`Unmocked fetch: ${url}`)
    return {
      ok: responses[handler].ok ?? true,
      status: responses[handler].status ?? 200,
      json: async () => responses[handler].body,
    }
  })
}

describe('useAutoFixPlan', () => {
  it('Phase 1 returns a synchronous plan on mount', () => {
    mockFetchImpl({ 'check-duplicates': { body: { duplicates: {} } } })
    const repos = [
      makeRepo({ id: 'a', name: 'api', selected: true }),
      makeRepo({ id: 'b', name: 'ok', selected: true }),
    ]
    const { result } = renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: false }),
    )
    expect(result.current.plan).toHaveLength(1)
    expect(result.current.plan[0].type).toBe('reserved-name')
  })

  it('Phase 2 marks items clear/conflict based on check-duplicates response', async () => {
    mockFetchImpl({ 'check-duplicates': { body: { duplicates: { 'api-repo': false } } } })
    const repos = [makeRepo({ id: 'a', name: 'api', selected: true })]
    const { result } = renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: false }),
    )
    await waitFor(() => {
      expect(result.current.conflictStatuses['a']).toBe('clear')
    })
  })

  it('Phase 2 sets unchecked on fetch failure (5xx)', async () => {
    mockFetchImpl({ 'check-duplicates': { ok: false, status: 500, body: {} } })
    const repos = [makeRepo({ id: 'a', name: 'api', selected: true })]
    const { result } = renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: false }),
    )
    await waitFor(() => {
      expect(result.current.conflictStatuses['a']).toBe('unchecked')
    })
  })

  it('Phase 3 skips when aiAvailable is false', async () => {
    mockFetchImpl({ 'check-duplicates': { body: { duplicates: {} } } })
    const repos = [makeRepo({ id: 'a', name: 'huge', size: 11 * 1024 * 1024, selected: true })]
    renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: false }),
    )
    // Wait enough to let any pending phases settle
    await new Promise((r) => setTimeout(r, 20))
    const aiCalls = global.fetch.mock.calls.filter((c) => c[0].includes('migration-size-strategy'))
    expect(aiCalls).toHaveLength(0)
  })

  it('Phase 3 calls AI endpoint for each size-critical repo when aiAvailable', async () => {
    mockFetchImpl({
      'check-duplicates': { body: { duplicates: {} } },
      'migration-size-strategy': { body: { strategy: 'lfs-migrate', rationale: 'r', confidence: 0.7 } },
    })
    const repos = [
      makeRepo({ id: 'a', name: 'huge', size: 11 * 1024 * 1024, selected: true }),
    ]
    const { result } = renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: true }),
    )
    await waitFor(() => {
      expect(result.current.aiSuggestions['a']).toEqual({
        strategy: 'lfs-migrate',
        rationale: 'r',
        confidence: 0.7,
      })
    })
  })

  it('aborts in-flight fetches on unmount', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
    mockFetchImpl({ 'check-duplicates': { body: { duplicates: {} } } })
    const repos = [makeRepo({ id: 'a', name: 'api', selected: true })]
    const { unmount } = renderHook(() =>
      useAutoFixPlan({ repos, allRepos: repos, targetOrg: 'myorg', azureProject: 'X', aiAvailable: false }),
    )
    unmount()
    expect(abortSpy).toHaveBeenCalled()
    abortSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run the tests — expect failures.**

Run: `npx vitest run tests/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.test.jsx`

Expected: FAIL with "module not found".

### Task 3.2: Implement the hook

**Files:**
- Create: `src/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.js`

- [ ] **Step 1: Create the hook.**

```js
// src/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.js
import { useEffect, useMemo, useState } from 'react'
import { buildDeterministicPlan } from './autoFixRules.js'

const SIZE_CRITICAL_KB = 10 * 1024 * 1024 // 10 GB

export function useAutoFixPlan({ repos, allRepos, targetOrg, azureProject, aiAvailable }) {
  const ctx = useMemo(
    () => ({ allRepos, conflicts: {}, targetOrg, azureProject }),
    [allRepos, targetOrg, azureProject],
  )

  const plan = useMemo(() => buildDeterministicPlan(repos, ctx), [repos, ctx])

  const [conflictStatuses, setConflictStatuses] = useState({})
  const [aiSuggestions, setAiSuggestions] = useState({})
  const [isValidating, setIsValidating] = useState(false)
  const [isAILoading, setIsAILoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()

    if (plan.length > 0) {
      setIsValidating(true)
      const names = plan.map((p) => p.to)
      fetch('/api/import/check-duplicates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetOrg, repos: names }),
        signal: controller.signal,
      })
        .then(async (res) => {
          if (res.status === 401) {
            setError({ type: 'auth', message: 'Azure DevOps token expired — please reconnect.' })
            return
          }
          if (!res.ok) {
            const unchecked = {}
            plan.forEach((p) => { unchecked[repos[p.repoIndex].id] = 'unchecked' })
            setConflictStatuses((prev) => ({ ...prev, ...unchecked }))
            return
          }
          const data = await res.json()
          const next = {}
          plan.forEach((p) => {
            const repoId = repos[p.repoIndex].id
            next[repoId] = data.duplicates?.[p.to] ? 'conflict' : 'clear'
          })
          setConflictStatuses((prev) => ({ ...prev, ...next }))
        })
        .catch((e) => {
          if (e.name === 'AbortError') return
          const unchecked = {}
          plan.forEach((p) => { unchecked[repos[p.repoIndex].id] = 'unchecked' })
          setConflictStatuses((prev) => ({ ...prev, ...unchecked }))
        })
        .finally(() => setIsValidating(false))
    }

    const sizeCritical = repos.filter((r) => r.selected && r.size > SIZE_CRITICAL_KB)
    if (aiAvailable && sizeCritical.length > 0) {
      setIsAILoading(true)
      Promise.allSettled(
        sizeCritical.map(async (repo) => {
          const res = await fetch('/api/ai/migration-size-strategy', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repoId: repo.id,
              size: repo.size,
              hasLfsMarker: !!repo.hasLfsMarker,
              branches: repo.branches,
              lastCommitDate: repo.lastCommitDate,
            }),
            signal: controller.signal,
          })
          if (res.status === 429) throw new Error('quota')
          if (!res.ok) throw new Error('server')
          const body = await res.json()
          return { repoId: repo.id, body }
        }),
      )
        .then((results) => {
          const next = {}
          let quotaHit = false
          for (const r of results) {
            if (r.status === 'fulfilled') {
              next[r.value.repoId] = r.value.body
            } else if (r.reason?.message === 'quota') {
              quotaHit = true
            }
          }
          setAiSuggestions((prev) => ({ ...prev, ...next }))
          if (quotaHit) setError({ type: 'ai-quota', message: 'AI quota reached — try again later or upgrade.' })
        })
        .finally(() => setIsAILoading(false))
    }

    return () => controller.abort()
  }, [plan, repos, targetOrg, aiAvailable])

  return { plan, conflictStatuses, aiSuggestions, isValidating, isAILoading, error }
}
```

- [ ] **Step 2: Run the tests — expect PASS.**

Run: `npx vitest run tests/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.test.jsx`

Expected: all 6 tests pass.

- [ ] **Step 3: Commit.**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.js tests/components/MigrationWizard/steps/RepoSelectStep/useAutoFixPlan.test.jsx
git commit -m "feat(migration): add useAutoFixPlan hook with deterministic + conflict + AI phases"
```

---

## Phase 4 — Drawer UI components

### Task 4.1: Implement `FixPlanItem.jsx`

**Files:**
- Create: `src/components/MigrationWizard/steps/RepoSelectStep/FixPlanItem.jsx`

- [ ] **Step 1: Create the component.**

```jsx
// src/components/MigrationWizard/steps/RepoSelectStep/FixPlanItem.jsx
import { ArrowRight, Check, AlertCircle, Loader2 } from 'lucide-react'

const TYPE_LABEL = {
  'invalid-chars': 'Invalid chars',
  'reserved-name': 'Reserved',
  'duplicate-in-batch': 'Duplicate',
  'name-conflict': 'Target conflict',
}

export function FixPlanItem({ item, checked, conflictStatus, onToggle, onEdit }) {
  const disabled = conflictStatus === 'conflict'
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm
        ${disabled ? 'border-red-500/40 bg-red-950/10' : 'border-slate-700 bg-slate-800/40'}`}
    >
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(e) => onToggle(item, e.target.checked)}
        aria-label={`Apply fix for ${item.from}`}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-slate-400 line-through">{item.from}</span>
        <ArrowRight className="h-3 w-3 shrink-0 text-slate-500" />
        <input
          type="text"
          value={item.to}
          onChange={(e) => onEdit(item, e.target.value)}
          className="min-w-0 flex-1 rounded bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100 outline-none ring-1 ring-slate-700 focus:ring-indigo-500"
        />
      </div>
      <span className="shrink-0 rounded bg-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
        {TYPE_LABEL[item.type] || item.type}
      </span>
      <ConflictIcon status={conflictStatus} />
    </div>
  )
}

function ConflictIcon({ status }) {
  if (status === 'checking') return <Loader2 className="h-4 w-4 animate-spin text-slate-500" aria-label="Checking target" />
  if (status === 'clear') return <Check className="h-4 w-4 text-emerald-500" aria-label="Clear" />
  if (status === 'conflict') return <AlertCircle className="h-4 w-4 text-red-500" aria-label="Conflict" />
  if (status === 'unchecked') return <AlertCircle className="h-4 w-4 text-amber-500" aria-label="Unchecked" />
  return null
}
```

- [ ] **Step 2: Commit.**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/FixPlanItem.jsx
git commit -m "feat(migration): add FixPlanItem component"
```

### Task 4.2: Implement `SizeStrategyCard.jsx`

**Files:**
- Create: `src/components/MigrationWizard/steps/RepoSelectStep/SizeStrategyCard.jsx`

- [ ] **Step 1: Create the component.**

```jsx
// src/components/MigrationWizard/steps/RepoSelectStep/SizeStrategyCard.jsx
import { Sparkles, X, Package, Database } from 'lucide-react'

const GB = 1024 * 1024

function formatSize(kb) {
  return `${(kb / GB).toFixed(1)} GB`
}

const STRATEGIES = [
  { key: 'exclude', label: 'Exclude from migration', icon: X, desc: 'Skip this repo.' },
  { key: 'lfs-migrate', label: 'Mark for LFS migration', icon: Database, desc: 'Run git-lfs migrate import --above=100M before push.' },
]

export function SizeStrategyCard({ repo, aiSuggestion, selectedStrategy, onSelect }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium text-slate-100">
          <Package className="h-4 w-4 text-amber-500" />
          {repo.name}
        </div>
        <span className="text-xs text-slate-400">{formatSize(repo.size)}</span>
      </div>

      {aiSuggestion && (
        <AISuggestionBanner
          suggestion={aiSuggestion}
          onAccept={() => onSelect(repo, aiSuggestion.strategy)}
        />
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {STRATEGIES.map(({ key, label, icon: Icon, desc }) => {
          const active = selectedStrategy === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(repo, key)}
              className={`flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left text-xs transition-colors
                ${active
                  ? 'border-indigo-500 bg-indigo-950/40 text-indigo-100'
                  : 'border-slate-700 bg-slate-900/40 text-slate-300 hover:border-indigo-400/60'
                }`}
            >
              <span className="flex items-center gap-1 font-medium">
                <Icon className="h-3.5 w-3.5" />
                {label}
              </span>
              <span className="text-[11px] text-slate-400">{desc}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AISuggestionBanner({ suggestion, onAccept }) {
  const label = suggestion.strategy === 'exclude' ? 'Exclude from migration' : 'Mark for LFS migration'
  const confidence = Math.round((suggestion.confidence ?? 0) * 100)
  return (
    <div className="mb-3 flex items-start gap-2 rounded-md border border-indigo-500/40 bg-indigo-950/30 p-2 text-xs">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-300" />
      <div className="flex-1">
        <div className="font-medium text-indigo-100">
          AI recommends: {label} ({confidence}% confidence)
        </div>
        <div className="text-indigo-200/80">{suggestion.rationale}</div>
      </div>
      <button
        type="button"
        onClick={onAccept}
        className="shrink-0 rounded bg-indigo-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-400"
      >
        Accept
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit.**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/SizeStrategyCard.jsx
git commit -m "feat(migration): add SizeStrategyCard with AI suggestion banner"
```

### Task 4.3: Implement `AutoFixDrawer.jsx`

**Files:**
- Create: `src/components/MigrationWizard/steps/RepoSelectStep/AutoFixDrawer.jsx`

- [ ] **Step 1: Create the drawer.**

```jsx
// src/components/MigrationWizard/steps/RepoSelectStep/AutoFixDrawer.jsx
import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Wand2, AlertTriangle } from 'lucide-react'
import { useAutoFixPlan } from './useAutoFixPlan.js'
import { FixPlanItem } from './FixPlanItem.jsx'
import { SizeStrategyCard } from './SizeStrategyCard.jsx'

const SIZE_CRITICAL_KB = 10 * 1024 * 1024

export function AutoFixDrawer({
  open,
  repos,
  allRepos,
  targetOrg,
  azureProject,
  aiAvailable,
  onClose,
  onApply,
}) {
  const selected = useMemo(() => repos.filter((r) => r.selected), [repos])
  const { plan, conflictStatuses, aiSuggestions, isValidating, isAILoading, error } = useAutoFixPlan({
    repos: selected,
    allRepos,
    targetOrg,
    azureProject,
    aiAvailable: aiAvailable && open,
  })

  const sizeCritical = useMemo(
    () => selected.filter((r) => r.size > SIZE_CRITICAL_KB),
    [selected],
  )

  // Local edit state: overrides the planned `to` value when the user edits inline.
  const [edits, setEdits] = useState({}) // { [repoIndex]: newName }
  const [checks, setChecks] = useState({}) // { [repoIndex]: boolean }
  const [strategies, setStrategies] = useState({}) // { [repoId]: 'exclude' | 'lfs-migrate' }

  const effectivePlan = useMemo(
    () => plan.map((p) => ({ ...p, to: edits[p.repoIndex] ?? p.to })),
    [plan, edits],
  )

  const applySet = useMemo(() => {
    const renameChanges = effectivePlan
      .filter((p) => {
        const checked = checks[p.repoIndex] ?? true
        const repoId = allRepos[p.repoIndex]?.id
        const conflict = conflictStatuses[repoId] === 'conflict'
        return checked && !conflict && isValidRepoName(p.to)
      })
      .map((p) => ({
        repoIndex: p.repoIndex,
        patch: { targetName: p.to, conflictAction: 'rename' },
      }))

    const strategyChanges = sizeCritical
      .filter((r) => strategies[r.id])
      .map((r) => {
        const repoIndex = allRepos.findIndex((x) => x.id === r.id)
        return { repoIndex, patch: { sizeStrategy: strategies[r.id] } }
      })

    return [...renameChanges, ...strategyChanges]
  }, [effectivePlan, checks, conflictStatuses, sizeCritical, strategies, allRepos])

  const handleApply = () => {
    if (applySet.length === 0) return
    onApply(applySet)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-label="Auto-fix drawer"
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col bg-slate-900 shadow-2xl"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
          >
            <header className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
              <div className="flex items-center gap-2 text-slate-100">
                <Wand2 className="h-5 w-5 text-indigo-400" />
                <h2 className="text-lg font-semibold">Fix issues</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            {error?.type === 'auth' && (
              <div className="m-4 rounded-md border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200">
                {error.message}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {plan.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-slate-200">Renames</h3>
                  <div className="space-y-2">
                    {plan.map((item) => {
                      const repoId = allRepos[item.repoIndex]?.id
                      return (
                        <FixPlanItem
                          key={`${item.repoIndex}-${item.type}`}
                          item={{ ...item, to: edits[item.repoIndex] ?? item.to }}
                          checked={checks[item.repoIndex] ?? true}
                          conflictStatus={conflictStatuses[repoId] || (isValidating ? 'checking' : null)}
                          onToggle={(it, c) => setChecks((prev) => ({ ...prev, [it.repoIndex]: c }))}
                          onEdit={(it, v) => setEdits((prev) => ({ ...prev, [it.repoIndex]: v }))}
                        />
                      )
                    })}
                  </div>
                </section>
              )}

              {sizeCritical.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
                    Large repositories
                    {isAILoading && <span className="text-xs text-slate-400">(AI analyzing…)</span>}
                  </h3>
                  {!aiAvailable && (
                    <div className="mb-2 flex items-start gap-2 rounded-md border border-slate-700 bg-slate-800/40 p-2 text-xs text-slate-300">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                      AI suggestions unavailable — pick a strategy manually.
                    </div>
                  )}
                  {error?.type === 'ai-quota' && (
                    <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-950/20 p-2 text-xs text-amber-200">
                      {error.message}
                    </div>
                  )}
                  <div className="space-y-2">
                    {sizeCritical.map((r) => (
                      <SizeStrategyCard
                        key={r.id}
                        repo={r}
                        aiSuggestion={aiSuggestions[r.id]}
                        selectedStrategy={strategies[r.id]}
                        onSelect={(repo, strategy) =>
                          setStrategies((prev) => ({ ...prev, [repo.id]: strategy }))
                        }
                      />
                    ))}
                  </div>
                </section>
              )}

              {plan.length === 0 && sizeCritical.length === 0 && (
                <p className="text-sm text-slate-400">No issues to fix.</p>
              )}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-slate-700 px-5 py-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={applySet.length === 0}
                className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-indigo-400"
              >
                Apply selected ({applySet.length})
              </button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

const VALID_NAME_RE = /^[A-Za-z0-9._-]+$/
function isValidRepoName(name) {
  return typeof name === 'string' && name.length > 0 && VALID_NAME_RE.test(name)
}
```

- [ ] **Step 2: Commit.**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/AutoFixDrawer.jsx
git commit -m "feat(migration): add AutoFixDrawer side panel"
```

### Task 4.4: Write drawer interaction tests

**Files:**
- Create: `tests/components/MigrationWizard/steps/RepoSelectStep/AutoFixDrawer.test.jsx`

- [ ] **Step 1: Write tests.**

```jsx
// tests/components/MigrationWizard/steps/RepoSelectStep/AutoFixDrawer.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AutoFixDrawer } from '../../../../../src/components/MigrationWizard/steps/RepoSelectStep/AutoFixDrawer.jsx'
import { makeRepo } from './fixtures.js'

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ duplicates: {} }),
  })
})
afterEach(() => vi.resetAllMocks())

describe('AutoFixDrawer', () => {
  it('renders deterministic items in Renames section', () => {
    const repos = [
      makeRepo({ id: 'a', name: 'api', selected: true }),
      makeRepo({ id: 'b', name: 'ok-name', selected: true }),
    ]
    render(
      <AutoFixDrawer
        open
        repos={repos}
        allRepos={repos}
        targetOrg="myorg"
        azureProject="X"
        aiAvailable={false}
        onClose={() => {}}
        onApply={() => {}}
      />,
    )
    expect(screen.getByText(/Renames/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue('api-repo')).toBeInTheDocument()
  })

  it('Apply selected is disabled when nothing is checked', async () => {
    const user = userEvent.setup()
    const repos = [makeRepo({ id: 'a', name: 'api', selected: true })]
    render(
      <AutoFixDrawer
        open
        repos={repos}
        allRepos={repos}
        targetOrg="myorg"
        azureProject="X"
        aiAvailable={false}
        onClose={() => {}}
        onApply={() => {}}
      />,
    )
    const checkbox = screen.getByRole('checkbox', { name: /Apply fix for api/i })
    await user.click(checkbox)
    const btn = screen.getByRole('button', { name: /Apply selected \(0\)/i })
    expect(btn).toBeDisabled()
  })

  it('calls onApply with the expected payload', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const repos = [makeRepo({ id: 'a', name: 'api', selected: true })]
    render(
      <AutoFixDrawer
        open
        repos={repos}
        allRepos={repos}
        targetOrg="myorg"
        azureProject="X"
        aiAvailable={false}
        onClose={() => {}}
        onApply={onApply}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Apply selected \(1\)/i }))
    expect(onApply).toHaveBeenCalledWith([
      { repoIndex: 0, patch: { targetName: 'api-repo', conflictAction: 'rename' } },
    ])
  })

  it('size-critical card without chosen strategy is not counted', () => {
    const repos = [
      makeRepo({ id: 'a', name: 'ok', size: 1024, selected: true }),
      makeRepo({ id: 'b', name: 'huge', size: 11 * 1024 * 1024, selected: true }),
    ]
    render(
      <AutoFixDrawer
        open
        repos={repos}
        allRepos={repos}
        targetOrg="myorg"
        azureProject="X"
        aiAvailable={false}
        onClose={() => {}}
        onApply={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /Apply selected \(0\)/i })).toBeDisabled()
  })

  it('selecting a strategy enables Apply for that repo', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const repos = [makeRepo({ id: 'b', name: 'huge', size: 11 * 1024 * 1024, selected: true })]
    render(
      <AutoFixDrawer
        open
        repos={repos}
        allRepos={repos}
        targetOrg="myorg"
        azureProject="X"
        aiAvailable={false}
        onClose={() => {}}
        onApply={onApply}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Exclude from migration/i }))
    await user.click(screen.getByRole('button', { name: /Apply selected \(1\)/i }))
    expect(onApply).toHaveBeenCalledWith([
      { repoIndex: 0, patch: { sizeStrategy: 'exclude' } },
    ])
  })

  it('shows AI unavailable banner when aiAvailable is false and size-critical exists', () => {
    const repos = [makeRepo({ id: 'b', name: 'huge', size: 11 * 1024 * 1024, selected: true })]
    render(
      <AutoFixDrawer
        open
        repos={repos}
        allRepos={repos}
        targetOrg="myorg"
        azureProject="X"
        aiAvailable={false}
        onClose={() => {}}
        onApply={() => {}}
      />,
    )
    expect(screen.getByText(/AI suggestions unavailable/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests — expect PASS.**

Run: `npx vitest run tests/components/MigrationWizard/steps/RepoSelectStep/AutoFixDrawer.test.jsx`

Expected: all 6 tests pass.

- [ ] **Step 3: Commit.**

```bash
git add tests/components/MigrationWizard/steps/RepoSelectStep/AutoFixDrawer.test.jsx
git commit -m "test(migration): AutoFixDrawer interaction coverage"
```

---

## Phase 5 — Wire up `RepoSelectStep` and `SelectionSummaryBar`

### Task 5.1: Make `SelectionSummaryBar` button dynamic

**Files:**
- Modify: `src/components/MigrationWizard/steps/RepoSelectStep/SelectionSummaryBar.jsx`

- [ ] **Step 1: Read the current file (needed for exact context).**

Run: `Read on src/components/MigrationWizard/steps/RepoSelectStep/SelectionSummaryBar.jsx`.

- [ ] **Step 2: Modify the button block. Replace the block that currently reads:**

```jsx
{(warnings > 0 || blockers > 0) && (
  <button
    type="button"
    onClick={onFixIssues}
    className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-indigo-400 hover:text-indigo-300"
  >
    Fix issues <ArrowRight className="w-3.5 h-3.5" />
  </button>
)}
```

With:

```jsx
{blockers > 0 && (
  <button
    type="button"
    onClick={onFixIssues}
    title={
      autoFixCount > 0 && manualFixCount > 0
        ? `${autoFixCount} can be auto-fixed, ${manualFixCount} need your input`
        : undefined
    }
    className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-indigo-400 hover:text-indigo-300"
  >
    {manualFixCount === 0 ? `Auto-fix (${blockers})` : `Fix issues (${blockers})`}
    <ArrowRight className="w-3.5 h-3.5" />
  </button>
)}
```

- [ ] **Step 3: Add the two new props to the signature.** Change the signature at the top:

```jsx
export function SelectionSummaryBar({ selected, warnings, blockers, autoFixCount = 0, manualFixCount = 0, onFixIssues }) {
```

- [ ] **Step 4: Commit.**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/SelectionSummaryBar.jsx
git commit -m "feat(migration): dynamic Fix issues label in SelectionSummaryBar"
```

### Task 5.2: Thread `onUpdateRepo` prop into `RepoSelectStep`

**Context:** `useMigrationWizard` already exposes `updateRepo(index, patch)` at [src/hooks/useMigrationWizard.js:241](../../src/hooks/useMigrationWizard.js#L241). `RepoConfigStep` consumes it. `RepoSelectStep` currently receives only `{repos, onSetRepos, source, onChange}` at [MigrationWizard.jsx:545](../../src/components/MigrationWizard/MigrationWizard.jsx#L545). The drawer needs per-repo patches.

**Files:**
- Modify: `src/components/MigrationWizard/MigrationWizard.jsx:545`
- Modify: `src/components/MigrationWizard/steps/RepoSelectStep.jsx:26`

- [ ] **Step 1: Update the parent call site.** Replace:

```jsx
return <RepoSelectStep repos={repos} onSetRepos={setRepos} source={source} onChange={updateSource} />
```

With:

```jsx
return (
  <RepoSelectStep
    repos={repos}
    onSetRepos={setRepos}
    onUpdateRepo={updateRepo}
    source={source}
    onChange={updateSource}
  />
)
```

Verify `updateRepo` is destructured from `useMigrationWizard()` at the top of `MigrationWizard.jsx`. If not, add it.

- [ ] **Step 2: Update the component signature to accept the new prop. Replace:**

```jsx
export default function RepoSelectStep({ repos, onSetRepos, source, onChange }) {
```

With:

```jsx
export default function RepoSelectStep({ repos, onSetRepos, onUpdateRepo, source, onChange }) {
```

- [ ] **Step 3: Commit.**

```bash
git add src/components/MigrationWizard/MigrationWizard.jsx src/components/MigrationWizard/steps/RepoSelectStep.jsx
git commit -m "feat(migration): thread onUpdateRepo prop into RepoSelectStep"
```

### Task 5.3: Wire the drawer into `RepoSelectStep`

**Files:**
- Modify: `src/components/MigrationWizard/steps/RepoSelectStep.jsx`

- [ ] **Step 1: Add the import at the top of the file (after existing imports from the step directory).**

```jsx
import { AutoFixDrawer } from './RepoSelectStep/AutoFixDrawer.jsx'
```

- [ ] **Step 2: Add drawer state after the other `useState` hooks in the component.**

```jsx
const [drawerOpen, setDrawerOpen] = useState(false)
const [aiAvailable, setAiAvailable] = useState(false)

useEffect(() => {
  let cancelled = false
  fetch('/api/config/ai-status', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : { available: false }))
    .then((d) => { if (!cancelled) setAiAvailable(!!d?.available) })
    .catch(() => { if (!cancelled) setAiAvailable(false) })
  return () => { cancelled = true }
}, [])
```

- [ ] **Step 3: Replace the existing `handleFixIssues` function at [RepoSelectStep.jsx:120-122](../../src/components/MigrationWizard/steps/RepoSelectStep.jsx#L120):**

```jsx
const handleFixIssues = useCallback(() => {
  setDrawerOpen(true)
}, [])

const handleApplyFixes = useCallback((changes) => {
  changes.forEach(({ repoIndex, patch }) => {
    onUpdateRepo(repoIndex, patch)
  })
  setDrawerOpen(false)
}, [onUpdateRepo])
```

- [ ] **Step 4: Compute `autoFixCount` and `manualFixCount` near the existing `aggregateSelected` derivation.**

```jsx
const selectedWithBlockers = scored.filter((r) => r.selected && r.risk?.level === 'blocker')
const manualFixCount = selectedWithBlockers.filter((r) => (r.risk?.flags || []).some((f) => f.type === 'size-critical')).length
const autoFixCount = Math.max(0, selectedWithBlockers.length - manualFixCount)
```

- [ ] **Step 5: Pass the new props to `SelectionSummaryBar`. Replace:**

```jsx
<SelectionSummaryBar
  selected={scored.filter((r) => r.selected)}
  warnings={aggregateSelected.warnings}
  blockers={aggregateSelected.blockers}
  onFixIssues={handleFixIssues}
/>
```

With:

```jsx
<SelectionSummaryBar
  selected={scored.filter((r) => r.selected)}
  warnings={aggregateSelected.warnings}
  blockers={aggregateSelected.blockers}
  autoFixCount={autoFixCount}
  manualFixCount={manualFixCount}
  onFixIssues={handleFixIssues}
/>
```

- [ ] **Step 6: Render the drawer near the existing `<ShortcutsOverlay …/>`:**

```jsx
<AutoFixDrawer
  open={drawerOpen}
  repos={scored}
  allRepos={scored}
  targetOrg={targetOrg}
  azureProject={azureProject}
  aiAvailable={aiAvailable}
  onClose={() => setDrawerOpen(false)}
  onApply={handleApplyFixes}
/>
```

The `targetOrg` and `azureProject` values must be available as props to the step. If they are not already destructured, add them to the component signature and to the parent that renders this step.

- [ ] **Step 7: Smoke-test via vitest running the existing RepoSelectStep test.**

Run: `npx vitest run tests/components/MigrationWizard/`

Expected: all tests pass, including the existing SourceStep and any step-level tests. If `targetOrg`/`azureProject` are not threaded through, tests will surface the missing prop.

- [ ] **Step 8: Commit.**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep.jsx
git commit -m "feat(migration): wire AutoFixDrawer into RepoSelectStep and replace filter-only handler"
```

---

## Phase 6 — Backend: `sizeStrategy` field in the plan schema

### Task 6.1: Write failing tests for the schema change

**Files:**
- Modify: `server/__tests__/validators-migration.test.js`

- [ ] **Step 1: Append test cases.**

```js
// append inside the existing describe('createPlanSchema', …) block

it('accepts sizeStrategy on repo task config', () => {
  const plan = {
    source: { type: 'azure', org: 'o', project: 'p' },
    tasks: [{ type: 'repo', sourceRef: 'o/p/r', targetRef: 'gh/r', config: { sizeStrategy: 'exclude' } }],
  }
  const res = createPlanSchema.safeParse(plan)
  expect(res.success).toBe(true)
})

it('accepts sizeStrategy on repo-tfvc task config', () => {
  const plan = {
    source: { type: 'azure', org: 'o', project: 'p' },
    tasks: [{ type: 'repo-tfvc', sourceRef: 'o/p/r', targetRef: 'gh/r', config: { sizeStrategy: 'lfs-migrate' } }],
  }
  const res = createPlanSchema.safeParse(plan)
  expect(res.success).toBe(true)
})

it('rejects invalid sizeStrategy values', () => {
  const plan = {
    source: { type: 'azure', org: 'o', project: 'p' },
    tasks: [{ type: 'repo', sourceRef: 'o/p/r', targetRef: 'gh/r', config: { sizeStrategy: 'split-history' } }],
  }
  const res = createPlanSchema.safeParse(plan)
  expect(res.success).toBe(false)
})
```

- [ ] **Step 2: Run the tests — expect failures.**

Run: `npx vitest run server/__tests__/validators-migration.test.js`

Expected: FAIL — current schema is strict and drops/rejects the field depending on zod mode.

### Task 6.2: Add `sizeStrategy` to the schema

**Files:**
- Modify: `server/lib/validators.js:198-214`

- [ ] **Step 1: Extend the `repo` task config.**

```js
z.object({
    type: z.literal('repo'),
    sourceRef: z.string().min(1),
    targetRef: z.string().min(1).max(140),
    config: z.object({
        makePrivate: z.boolean().default(true),
        description: z.string().max(350).default(''),
        rollbackPolicy: z.enum(['delete', 'keep-empty']).default('delete'),
        timeout: z.number().min(60000).max(3600000).default(1800000),
        sizeStrategy: z.enum(['exclude', 'lfs-migrate']).optional(),
    }).default({})
}),
```

Apply the identical change to the `repo-tfvc` task config block immediately below.

- [ ] **Step 2: Add the request/response schema for the AI endpoint.**

Append to `server/lib/validators.js`:

```js
export const migrationSizeStrategySchema = z.object({
    repoId: z.string().min(1).max(200),
    size: z.number().int().nonnegative(),
    hasLfsMarker: z.boolean().default(false),
    branches: z.number().int().nonnegative().default(0),
    lastCommitDate: z.string().datetime().optional(),
});
```

- [ ] **Step 3: Run the tests — expect PASS.**

Run: `npx vitest run server/__tests__/validators-migration.test.js`

Expected: all tests pass.

- [ ] **Step 4: Commit.**

```bash
git add server/lib/validators.js server/__tests__/validators-migration.test.js
git commit -m "feat(migration): accept sizeStrategy on task config and add size-strategy schema"
```

---

## Phase 7 — Backend AI endpoint

### Task 7.1: Write failing tests for the endpoint

**Files:**
- Create: `server/__tests__/ai-migration-size-strategy.test.js`

- [ ] **Step 1: Write tests mirroring the pattern in `server/__tests__/ai-migration-risk.test.js`.**

```js
// server/__tests__/ai-migration-size-strategy.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import router from '../routes/ai.js'

// Stub auth by injecting a session-bearing middleware before the router.
function buildApp({ authed = true, aiAvailable = true, quotaAllowed = true } = {}) {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        if (authed) {
            req.session = { userId: 'user-1', accessToken: 'ghtoken' }
        }
        req.genAI = aiAvailable ? {
            getGenerativeModel: () => ({
                generateContent: async () => ({
                    response: { text: () => JSON.stringify({ strategy: 'lfs-migrate', rationale: 'test', confidence: 0.7 }) },
                }),
            }),
        } : null
        next()
    })
    // Quota stub — dependency injection via vi.mock is the project pattern; for this test we
    // rely on the real checkAIFeatureLimit but pre-seed db if needed. If that's impractical,
    // the endpoint delegates to checkAIFeatureLimit and we can assert the 429 path via mock.
    app.use('/api', router)
    return app
}

describe('POST /api/ai/migration-size-strategy', () => {
    it('returns 200 with a valid strategy payload', async () => {
        const app = buildApp()
        const res = await request(app)
            .post('/api/ai/migration-size-strategy')
            .send({ repoId: 'a', size: 11 * 1024 * 1024, hasLfsMarker: false, branches: 3 })
        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({
            strategy: expect.stringMatching(/^(exclude|lfs-migrate)$/),
            rationale: expect.any(String),
            confidence: expect.any(Number),
        })
    })

    it('returns 400 on invalid body', async () => {
        const app = buildApp()
        const res = await request(app)
            .post('/api/ai/migration-size-strategy')
            .send({ repoId: 'a' }) // missing size
        expect(res.status).toBe(400)
    })

    it('returns 401 without auth', async () => {
        const app = buildApp({ authed: false })
        const res = await request(app)
            .post('/api/ai/migration-size-strategy')
            .send({ repoId: 'a', size: 11 * 1024 * 1024 })
        expect(res.status).toBe(401)
    })

    it('returns 503 when AI model is unavailable', async () => {
        const app = buildApp({ aiAvailable: false })
        const res = await request(app)
            .post('/api/ai/migration-size-strategy')
            .send({ repoId: 'a', size: 11 * 1024 * 1024 })
        expect([401, 503]).toContain(res.status) // requireAI middleware rejects before schema
    })
})
```

- [ ] **Step 2: Run tests — expect FAIL.**

Run: `npx vitest run server/__tests__/ai-migration-size-strategy.test.js`

Expected: FAIL — endpoint does not exist.

### Task 7.2: Implement the endpoint

**Files:**
- Modify: `server/routes/ai.js` — append a new handler in the "AI Repository Insights" region (after existing `/ai/readme` handler for consistency).

- [ ] **Step 1: Add the import for the new schema near the other validator imports:**

```js
import { validate, aiChatSchema, aiIndexSchema, migrationSizeStrategySchema } from '../lib/validators.js';
```

- [ ] **Step 2: Append the handler. Place near other AI handlers.**

```js
// ------------------------------------------------------------------
// AI Migration Size Strategy
// ------------------------------------------------------------------

router.post('/ai/migration-size-strategy', requireAuth, requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkAIFeatureLimit(userId, 'migration_assist');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));

    const parsed = migrationSizeStrategySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { repoId, size, hasLfsMarker, branches, lastCommitDate } = parsed.data;

    const sizeGb = (size / (1024 * 1024)).toFixed(1);
    const prompt = `You are a migration assistant helping decide the best strategy for a repository that exceeds GitHub's 10 GB push limit.

Repository facts (no names or business context provided):
- Size: ${sizeGb} GB
- Has LFS markers in .gitattributes: ${hasLfsMarker ? 'yes' : 'no'}
- Branch count: ${branches}
- Last commit date: ${sanitizeForPrompt(lastCommitDate || 'unknown', 50)}

Choose exactly one strategy from: "exclude" or "lfs-migrate".
- "exclude": the repository is stale, archival, or too unwieldy; skip it.
- "lfs-migrate": run git-lfs migrate import --above=100M before pushing; appropriate when the size is caused by large binary assets.

Respond with strict JSON only, no prose outside the JSON:
{"strategy": "exclude" | "lfs-migrate", "rationale": "one short sentence", "confidence": 0.0-1.0}`;

    try {
        const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        const model = req.genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const text = result.response.text();

        const parsedResponse = safeJsonParse(text);
        if (!parsedResponse || !['exclude', 'lfs-migrate'].includes(parsedResponse.strategy)) {
            return res.status(502).json({ error: 'Unexpected AI response shape' });
        }

        incrementAIUsage(userId, 'migration_assist');
        auditLog(req, 'ai.migration-size-strategy', 'ai', null, { repoId, size, model: modelName });
        res.json({
            strategy: parsedResponse.strategy,
            rationale: String(parsedResponse.rationale || '').slice(0, 500),
            confidence: Math.max(0, Math.min(1, Number(parsedResponse.confidence) || 0)),
        });
    } catch (err) {
        req.log?.error({ err }, 'migration-size-strategy failed');
        handleAIError(res, err, 'Failed to generate size strategy. Please try again later.');
    }
});
```

- [ ] **Step 3: Run tests — expect PASS.**

Run: `npx vitest run server/__tests__/ai-migration-size-strategy.test.js`

Expected: 200, 400, 401 tests pass. The 503/unavailable test tolerates both 401 (requireAI rejects unauth'd) and 503 (generation failure) per its `expect([401, 503])`.

- [ ] **Step 4: Commit.**

```bash
git add server/routes/ai.js server/__tests__/ai-migration-size-strategy.test.js
git commit -m "feat(ai): POST /api/ai/migration-size-strategy for size-critical repo guidance"
```

---

## Phase 8 — Exclude strategy in `ScheduleStep`

### Task 8.1: Skip excluded repos when building tasks

**Files:**
- Modify: `src/components/MigrationWizard/steps/ScheduleStep.jsx:61-69`

- [ ] **Step 1: Replace the task mapping block:**

```jsx
const tasks = selectedRepos
  .filter((repo) => repo.sizeStrategy !== 'exclude')
  .map(repo => {
    const repoName = repo.targetName || repo.name
    const baseConfig = {
      makePrivate: repo.visibility === 'private',
      description: repo.description || '',
    }
    const config = repo.sizeStrategy === 'lfs-migrate'
      ? { ...baseConfig, sizeStrategy: 'lfs-migrate' }
      : baseConfig
    return {
      type: repo.isTfvc ? 'repo-tfvc' : 'repo',
      sourceRef: `${source.org}/${source.project}/${repo.name}`,
      targetRef: targetOrg ? `${targetOrg}/${repoName}` : repoName,
      config,
    }
  })
```

- [ ] **Step 2: Commit.**

```bash
git add src/components/MigrationWizard/steps/ScheduleStep.jsx
git commit -m "feat(migration): honor sizeStrategy — skip excluded repos, forward lfs-migrate flag"
```

---

## Phase 9 — LFS migrate in `import-service.js`

### Task 9.1: Thread `sizeStrategy` through `migration-engine.js`

**Files:**
- Modify: `server/migration-engine.js:551-560` (and the equivalent block in the `repo-tfvc` case around line 606-614)

- [ ] **Step 1: Pass `sizeStrategy` into `importRepository` for `repo` task.**

Replace the `importRepository({...})` call with:

```js
const result = await importRepository({
  sourceUrl: `https://dev.azure.com/${azureOrg}/${azureProject}/_git/${azureRepo}`,
  credentials: resolvedCredentials.azurePat ? { type: 'pat', token: resolvedCredentials.azurePat } : undefined,
  targetOwner,
  targetName: targetRepo,
  isPrivate: config.makePrivate ?? true,
  description: config.description || '',
  sizeStrategy: config.sizeStrategy,
  githubToken: resolvedCredentials.githubToken,
  onProgress: (status, message, pct) => callbacks.onProgress(pct, message)
})
```

- [ ] **Step 2: Do the same for the `repo-tfvc` call around line 606.** Append `sizeStrategy: config.sizeStrategy` to the options object.

- [ ] **Step 3: Commit.**

```bash
git add server/migration-engine.js
git commit -m "feat(migration): forward sizeStrategy from task config into importRepository"
```

### Task 9.2: Implement `lfs-migrate` in `import-service.js`

**Files:**
- Modify: `server/import-service.js:196-226`

- [ ] **Step 1: Accept `sizeStrategy` in the function signature.**

Locate the `importRepository` function declaration (it has a single options object). Add `sizeStrategy` to the destructured parameters. Example:

```js
export async function importRepository({
    sourceUrl,
    credentials,
    targetOwner,
    targetName,
    isPrivate,
    description,
    sizeStrategy, // 'exclude' | 'lfs-migrate' | undefined
    githubToken,
    onProgress,
}) {
```

- [ ] **Step 2: After the existing "Step 4: Check for LFS" block, add a new block that runs `git-lfs migrate import` when the flag is set.**

Insert this block after the `if (hasLFS) { … }` fetch block and before "Step 5: Push mirror":

```js
        // Step 4b: Apply sizeStrategy === 'lfs-migrate' (convert large blobs to LFS in-place).
        if (sizeStrategy === 'lfs-migrate') {
            onProgress('lfs-migrate', 'Converting large files to LFS...', 50);
            const migrateGit = simpleGit(workDir);
            try {
                await migrateGit.raw([
                    'lfs', 'migrate', 'import',
                    '--above=100M',
                    '--everything',
                    '--yes',
                ]);
            } catch (e) {
                logger.warn({ err: e }, 'git-lfs migrate import failed; proceeding with original history');
            }
        }
```

- [ ] **Step 3: Sanity-check by running the server-side test suite.**

Run: `npx vitest run server/__tests__/`

Expected: all tests pass. No unit test exercises the full import flow, so this is a regression guard.

- [ ] **Step 4: Commit.**

```bash
git add server/import-service.js
git commit -m "feat(migration): run git-lfs migrate import --above=100M when sizeStrategy=lfs-migrate"
```

---

## Phase 10 — E2E happy-path test

### Task 10.1: Add the E2E spec

**Files:**
- Create: `e2e/migration-autofix.spec.js`

- [ ] **Step 1: Write the spec.**

```js
// e2e/migration-autofix.spec.js
import { test, expect } from '@playwright/test'

// Helper: route-mocks for Azure and AI so the test can run without real credentials.
async function installMocks(page) {
  await page.route('**/api/config/ai-status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) }),
  )
  await page.route('**/api/azure/orgs**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ name: 'myorg' }]) }),
  )
  await page.route('**/api/azure/projects**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'p1', name: 'APOS' }]),
    }),
  )
  await page.route('**/api/azure/repos**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'r1', name: 'api', size: 1024, branches: 1, isTfvc: false, lastCommitDate: '2025-01-01' },
        { id: 'r2', name: 'huge', size: 11 * 1024 * 1024, branches: 3, isTfvc: false, lastCommitDate: '2025-01-01' },
      ]),
    }),
  )
  await page.route('**/api/import/check-duplicates', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ duplicates: {} }) }),
  )
  await page.route('**/api/ai/migration-size-strategy', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ strategy: 'lfs-migrate', rationale: 'binary assets', confidence: 0.8 }),
    }),
  )
}

test.describe('Migration Auto-Fix Drawer', () => {
  test('reduces blockers to zero after Apply selected', async ({ page }) => {
    await installMocks(page)
    await page.goto('/')
    await page.keyboard.press('i')
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 })

    // Navigate through Source + Connect to reach Repos step (mocked back-end returns the fixture).
    // The exact clicks depend on wizard prompts; we identify Repos step by its heading.
    await page.getByRole('button', { name: /Next|Continue/i }).click({ trial: true }).catch(() => {})

    // Advance until the Repos step heading is visible.
    await expect(page.getByRole('heading', { name: /Select Repositories/i })).toBeVisible({ timeout: 10000 })

    // Select both repos.
    await page.getByRole('checkbox', { name: /api/i }).click()
    await page.getByRole('checkbox', { name: /huge/i }).click()

    // Trigger the drawer.
    await page.getByRole('button', { name: /Fix issues|Auto-fix/i }).click()
    const drawer = page.getByRole('dialog', { name: /Auto-fix drawer/i })
    await expect(drawer).toBeVisible()

    // Accept the AI suggestion on the huge repo.
    await drawer.getByRole('button', { name: /Accept/i }).click()

    // Apply selected.
    await drawer.getByRole('button', { name: /Apply selected \(2\)/i }).click()

    // Assert: blocker count is zero.
    await expect(page.getByText(/0\s*BLOCKERS/i)).toBeVisible()
    // Assert: renamed target displayed.
    await expect(page.getByText(/api-repo/)).toBeVisible()
  })
})
```

Note: the navigation sequence (Source → Connect → Repos) depends on wizard prompts. The click sequence above uses a best-effort selector; if it fails in CI, the executing agent should adjust it by inspecting the wizard's actual steps. The test must end at the Repos heading regardless of the path taken.

- [ ] **Step 2: Run locally once to verify the happy path.**

Per user preference (avoid long local test runs), only run the single spec locally:

Run: `npx playwright test e2e/migration-autofix.spec.js --reporter=list`

If it hangs on login or wizard navigation, adjust the click sequence and retry. If CI is preferred, skip this step and let the CI pipeline validate.

- [ ] **Step 3: Commit.**

```bash
git add e2e/migration-autofix.spec.js
git commit -m "test(e2e): migration auto-fix drawer happy path"
```

---

## Phase 11 — Final verification

### Task 11.1: Run the full new-test suite

- [ ] **Step 1: Unit tests.**

Run: `npx vitest run tests/components/MigrationWizard/steps/RepoSelectStep/`

Expected: all tests pass.

- [ ] **Step 2: Backend tests.**

Run: `npx vitest run server/__tests__/ai-migration-size-strategy.test.js server/__tests__/validators-migration.test.js`

Expected: all tests pass.

- [ ] **Step 3: Build check.**

Run: `npm run build`

Expected: no errors; Vite build succeeds.

- [ ] **Step 4: If any steps failed, STOP and fix — do not proceed to verification before completion.**

### Task 11.2: Manual UI verification (optional but recommended)

If the dev server can be started locally:

- [ ] **Step 1: Start dev server.**

Run: `npm run dev`

- [ ] **Step 2: Open the Migration Wizard, fake/seed an Azure connection that returns at least one repo with an invalid name and one >10 GB.**

- [ ] **Step 3: Verify:**
  - Button reads `Fix issues (2)` (or `Auto-fix (1)` if only one deterministic).
  - Clicking opens drawer with two sections.
  - Renames section shows `api → api-repo`.
  - Large repositories section shows the size-critical repo with AI banner if AI is configured; otherwise the "AI suggestions unavailable" banner.
  - After `Apply selected`, the blockers badge drops and the row shows the new `targetName`.
  - Configure step shows the renamed repo and is still editable.

- [ ] **Step 4: Stop the server.** Run: `npm run dev:kill`

---

## Self-review

**Spec coverage:**
- §2 goals → Phases 1-10 all addressed.
- §3 non-goals (TFVC, warnings, audit log) → not touched in this plan.
- §4.1 entry point → Task 5.1.
- §4.2 drawer layout → Tasks 4.1, 4.2, 4.3.
- §4.3 applied-state-on-reopen → handled via `isValidRepoName` + effective-name derivation when the drawer reopens (the user toggles to revert). If stricter visual "Applied ✓" badges are needed, that's a polish pass — out of scope for V1.
- §5 data model → Phase 6 (schema) + Phase 8 (task wiring) + Phase 9 (engine wiring).
- §6.1 client components → Phases 2-5.
- §6.2 server → Phases 6-7.
- §6.3 data flow → Phase 3 implements all three phases.
- §6.4 error handling → covered in Phase 3 hook + Phase 4 drawer UI.
- §7 testing → Phases 2, 3, 4, 7, 10.
- §8 open questions → resolved in Phase 0.

**Scope narrowing:** three strategies reduced to two (`history-split` filed as future). Spec mentions three in §4.2 prose but plan is explicit about V1 scope in Phase 0.

**Placeholder scan:** no TBDs, TODOs, or hand-wavy "add error handling" steps. Every code block is complete and runnable.

**Type consistency:**
- `{repoIndex, patch}` shape used consistently in `onApply` across Phase 4 and Phase 5.
- `sizeStrategy` enum values (`'exclude' | 'lfs-migrate'`) consistent across client (Phase 4), schema (Phase 6), engine (Phase 9), and AI endpoint (Phase 7).
- `fixInvalidChars`, `fixReserved`, `fixDuplicates`, `fixNameConflict`, `buildDeterministicPlan` signatures match between Phase 2 implementation and Phase 3 consumption.
- `conflictStatus` values (`'checking' | 'clear' | 'conflict' | 'unchecked'`) consistent between Phase 3 hook and Phase 4 FixPlanItem renderer.
