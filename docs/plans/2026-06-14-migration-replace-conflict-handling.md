# Migration Replace Conflict Handling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Migration Wizard's "Replace" conflict action actually delete and recreate the conflicting GitHub repo end-to-end, gated by an honest destructive confirmation, blocked-before-run, and recoverable from the error screen.

**Architecture:** Thread a new `onConflict: 'replace'` intent from the Configure step → task config → engine → importer. The importer gains a delete-and-recreate branch behind a pure decision helper. The frontend gains a type-to-confirm modal, a visible "will replace" state, a Next-button guard, and an error-screen "Resolve conflict" affordance.

**Tech Stack:** React 19, Vite, Tailwind v4, Framer Motion (frontend `.jsx`); Express + better-sqlite3, simple-git, node `fetch` (backend); Vitest + @testing-library/react (tests).

**Spec:** [docs/specs/2026-06-13-migration-replace-conflict-handling.md](../specs/2026-06-13-migration-replace-conflict-handling.md)

**Branch:** create `feat/migration-replace-conflict` off `main` before Task 1.

**Deviation from spec:** The destructive delete is recorded via the existing pino `logger.warn` inside the importer (no new plumbing), not `auditLogDirect` — the importer has no `userId`/`req` in scope and threading it is out of scope. Noted in Task 3.

---

## File Structure

**Backend**
- Modify `server/import-service.js` — add `decideConflictResolution` (pure), `deleteGithubRepo`, `createGithubRepoWithRetry`, a `sleep` helper, `onConflict` param, the replace branch, and `replacedExistingRepo` in the return.
- Modify `server/migration-engine.js` — pass `onConflict: config.onConflict` to both `importRepository` call sites.
- Create `server/__tests__/import-service-conflict.test.js` — pure `decideConflictResolution` tests.
- Create `server/__tests__/import-service-delete.test.js` — `deleteGithubRepo` + replace integration tests (mock `fetch` + `simple-git`).
- Modify `server/__tests__/migration-engine.test.js` — assert `onConflict` is forwarded.

**Frontend**
- Create `src/components/MigrationWizard/steps/buildRepoTaskConfig.js` — pure per-repo task-config builder (carries `onConflict`).
- Modify `src/components/MigrationWizard/steps/ScheduleStep.jsx` — use the helper.
- Create `src/components/MigrationWizard/steps/RepoConfigStep/ReplaceConfirmModal.jsx` — destructive type-to-confirm modal.
- Modify `src/components/MigrationWizard/steps/RepoConfigStep.jsx` — open modal on Replace; sync `hasConflict`.
- Modify `src/components/MigrationWizard/steps/RepoConfigStep/RepoCard.jsx` — "Will replace" badge.
- Modify `src/components/MigrationWizard/MigrationWizard.jsx` — Next guard for `repoConfig`; wire `onResolveConflict`.
- Modify `src/components/MigrationWizard/StepRenderer.jsx` — pass `onResolveConflict` to `SummaryStep`.
- Modify `src/components/MigrationWizard/steps/SummaryStep.jsx` — "Resolve conflict" button + "Replaced" badge.
- Create `tests/components/MigrationWizard/steps/buildRepoTaskConfig.test.js`.
- Create `tests/components/MigrationWizard/steps/RepoConfigStep/ReplaceConfirmModal.test.jsx`.
- Modify `tests/components/MigrationWizard/steps/RepoConfigStep.guard.test.jsx` — Replace opens modal; confirm wiring.

---

## Task 1: Pure conflict-resolution decision (backend)

**Files:**
- Modify: `server/import-service.js`
- Test: `server/__tests__/import-service-conflict.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/import-service-conflict.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

// simple-git is constructed at import time; stub it to keep the import light.
vi.mock('simple-git', () => ({
    simpleGit: () => ({
        version: vi.fn(async () => ({ installed: true })),
        clone: vi.fn(async () => {}),
        push: vi.fn(async () => {}),
    }),
}));

import { decideConflictResolution } from '../import-service.js';

describe('decideConflictResolution', () => {
    it('reuses an empty repo (size 0, no default branch) regardless of onConflict', () => {
        expect(decideConflictResolution({ size: 0, defaultBranch: null, onConflict: 'fail' }))
            .toEqual({ action: 'reuse' });
        expect(decideConflictResolution({ size: 0, defaultBranch: null, onConflict: 'replace' }))
            .toEqual({ action: 'reuse' });
    });

    it('replaces a non-empty repo when onConflict is "replace"', () => {
        expect(decideConflictResolution({ size: 1234, defaultBranch: 'main', onConflict: 'replace' }))
            .toEqual({ action: 'replace' });
    });

    it('fails on a non-empty repo when onConflict is not "replace"', () => {
        expect(decideConflictResolution({ size: 1234, defaultBranch: 'main', onConflict: 'fail' }))
            .toEqual({ action: 'fail' });
        expect(decideConflictResolution({ size: 1234, defaultBranch: 'main', onConflict: undefined }))
            .toEqual({ action: 'fail' });
    });

    it('treats size 0 WITH a default branch as non-empty (stale-read guard)', () => {
        expect(decideConflictResolution({ size: 0, defaultBranch: 'main', onConflict: 'fail' }))
            .toEqual({ action: 'fail' });
        expect(decideConflictResolution({ size: 0, defaultBranch: 'main', onConflict: 'replace' }))
            .toEqual({ action: 'replace' });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/import-service-conflict.test.js`
Expected: FAIL — `decideConflictResolution is not a function` / not exported.

- [ ] **Step 3: Add the pure function**

In `server/import-service.js`, add near the other top-level helpers (e.g. just above `function safeUrl`):

```js
/**
 * Decide what to do when the target repo name already exists on GitHub.
 * Pure (no I/O). An existing *empty* repo is always reused (nothing to lose);
 * a non-empty repo is replaced only when the user chose `onConflict: 'replace'`,
 * otherwise the import fails with the "already exists" error.
 *
 * @param {{ size:number, defaultBranch:(string|null|undefined), onConflict?:string }} args
 * @returns {{ action: 'reuse'|'replace'|'fail' }}
 */
export function decideConflictResolution({ size, defaultBranch, onConflict }) {
    const isEmpty = size === 0 && !defaultBranch;
    if (isEmpty) return { action: 'reuse' };
    if (onConflict === 'replace') return { action: 'replace' };
    return { action: 'fail' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/import-service-conflict.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/import-service.js server/__tests__/import-service-conflict.test.js
git commit -m "feat(import): add pure conflict-resolution decision helper"
```

---

## Task 2: `deleteGithubRepo` helper (backend)

**Files:**
- Modify: `server/import-service.js`
- Test: `server/__tests__/import-service-delete.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/import-service-delete.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('simple-git', () => ({
    simpleGit: () => ({
        version: vi.fn(async () => ({ installed: true })),
        clone: vi.fn(async () => {}),
        push: vi.fn(async () => {}),
    }),
}));

import { deleteGithubRepo } from '../import-service.js';

const HEADERS = { Authorization: 'Bearer t', Accept: 'application/vnd.github+json' };

describe('deleteGithubRepo', () => {
    beforeEach(() => { global.fetch = vi.fn(); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('resolves on 204 (deleted) and calls DELETE on the right URL', async () => {
        global.fetch.mockResolvedValueOnce({ status: 204 });
        await expect(deleteGithubRepo('acme', 'widget', HEADERS)).resolves.toBeUndefined();
        const [url, opts] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.github.com/repos/acme/widget');
        expect(opts.method).toBe('DELETE');
    });

    it('resolves on 404 (already gone)', async () => {
        global.fetch.mockResolvedValueOnce({ status: 404 });
        await expect(deleteGithubRepo('acme', 'widget', HEADERS)).resolves.toBeUndefined();
    });

    it('throws an actionable message on 403 (org blocks deletion)', async () => {
        global.fetch.mockResolvedValueOnce({ status: 403 });
        await expect(deleteGithubRepo('acme', 'widget', HEADERS))
            .rejects.toThrow(/block members from deleting|delete it manually/i);
    });

    it('throws with the API message on other failures', async () => {
        global.fetch.mockResolvedValueOnce({ status: 500, json: async () => ({ message: 'boom' }) });
        await expect(deleteGithubRepo('acme', 'widget', HEADERS)).rejects.toThrow(/boom/);
    });

    it('url-encodes owner and repo segments', async () => {
        global.fetch.mockResolvedValueOnce({ status: 204 });
        await deleteGithubRepo('a b', 'c/d', HEADERS);
        expect(global.fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/a%20b/c%2Fd');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/import-service-delete.test.js`
Expected: FAIL — `deleteGithubRepo is not a function`.

- [ ] **Step 3: Add the helper**

In `server/import-service.js`, add near the new `decideConflictResolution`:

```js
/**
 * Delete a repository on GitHub. Treats 404 as success (already gone) and
 * maps 403 to an actionable message (orgs can forbid member deletions).
 * @param {string} owner
 * @param {string} repo
 * @param {object} headers - GitHub auth headers
 */
export async function deleteGithubRepo(owner, repo, headers) {
    const res = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        { method: 'DELETE', headers },
    );
    if (res.status === 204 || res.status === 404) return;
    if (res.status === 403) {
        throw new Error(
            `Could not delete the existing repository "${owner}/${repo}" — the organization may block members from deleting repositories, or your token lacks delete permission on it. Enable "Allow members to delete repositories" in the org settings or delete it manually, then retry.`,
        );
    }
    const body = await res.json().catch(() => null);
    throw new Error(`Failed to delete existing repository "${owner}/${repo}": ${body?.message || res.status}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/import-service-delete.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/import-service.js server/__tests__/import-service-delete.test.js
git commit -m "feat(import): add deleteGithubRepo helper with 403/404 handling"
```

---

## Task 3: Wire replace into `importRepository` (backend)

**Files:**
- Modify: `server/import-service.js:146-157` (params), `:231-262` (create/reuse block), `:162` (flag decl), `:439-448` (return)
- Test: `server/__tests__/import-service-delete.test.js` (add the integration test below)

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/import-service-delete.test.js` (inside a new `describe`):

```js
import { importRepository } from '../import-service.js';

// Source-URL validation and oversized-blob scanning do real I/O; stub them so
// the test exercises only the create → reuse/replace branch.
vi.mock('../import-service.js', async (orig) => orig());

describe('importRepository replace branch', () => {
    beforeEach(() => { global.fetch = vi.fn(); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('deletes a non-empty existing repo then recreates when onConflict=replace', async () => {
        // 1) create POST → 422 already exists
        global.fetch.mockResolvedValueOnce({
            ok: false, status: 422,
            json: async () => ({ errors: [{ message: 'name already exists on this account' }] }),
        });
        // 2) GET existing → non-empty
        global.fetch.mockResolvedValueOnce({
            ok: true, json: async () => ({ size: 4096, default_branch: 'main', full_name: 'acme/widget' }),
        });
        // 3) DELETE → 204
        global.fetch.mockResolvedValueOnce({ status: 204 });
        // 4) recreate POST → ok
        global.fetch.mockResolvedValueOnce({
            ok: true, json: async () => ({ full_name: 'acme/widget', html_url: 'https://github.com/acme/widget', default_branch: null }),
        });
        // any later fetches (e.g. default-branch PATCH) → ok
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });

        const result = await importRepository({
            sourceUrl: 'https://github.com/src/widget.git',
            credentials: { type: 'token', token: 'src' },
            targetOwner: 'acme',
            targetName: 'widget',
            githubToken: 'gh',
            onConflict: 'replace',
        });

        expect(result.success).toBe(true);
        expect(result.replacedExistingRepo).toBe(true);
        const deleteCall = global.fetch.mock.calls.find((c) => c[1]?.method === 'DELETE');
        expect(deleteCall?.[0]).toBe('https://api.github.com/repos/acme/widget');
    });

    it('does NOT delete and throws when non-empty and onConflict is not replace', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false, status: 422,
            json: async () => ({ errors: [{ message: 'name already exists on this account' }] }),
        });
        global.fetch.mockResolvedValueOnce({
            ok: true, json: async () => ({ size: 4096, default_branch: 'main', full_name: 'acme/widget' }),
        });

        const result = await importRepository({
            sourceUrl: 'https://github.com/src/widget.git',
            credentials: { type: 'token', token: 'src' },
            targetOwner: 'acme',
            targetName: 'widget',
            githubToken: 'gh',
        });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/already exists on GitHub and is not empty/);
        expect(global.fetch.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(false);
    });
});
```

> Note: `importRepository` clones via the stubbed `simple-git`, so the clone/push are no-ops. `validateSourceUrl` runs against a `github.com` URL (allowed). If the test environment blocks the validation network call, stub `validateSourceUrl` by adding it to the `simple-git`-style mock at the top, or assert on the thrown validation error instead — but the GitHub `github.com` host should validate without a network hit.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/import-service-delete.test.js`
Expected: FAIL — replace test sees the old "already exists and is not empty" throw (no delete), `replacedExistingRepo` undefined.

- [ ] **Step 3: Add `onConflict` param + `replacedExistingRepo` flag**

In `server/import-service.js`, the params destructure (`:147-157`) — add `onConflict`:

```js
    const {
        sourceUrl,
        credentials,
        targetOwner,
        targetName,
        isPrivate = true,
        description = '',
        sizeStrategy,
        onConflict = 'fail',
        githubToken,
        onProgress = () => {}
    } = params;
```

Just below `let reusedExistingRepo = false;` (`:162`) add:

```js
    let replacedExistingRepo = false;
```

- [ ] **Step 4: Add the `sleep` + recreate-with-retry helpers**

Near the other top-level helpers in `server/import-service.js`:

```js
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create a GitHub repo, retrying while the name is still "already exists"
 * (GitHub frees a just-deleted name a beat after DELETE returns).
 * @returns {object} the created repo JSON
 */
async function createGithubRepoWithRetry(endpoint, headers, payload, { tries = 5, delayMs = 1000 } = {}) {
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (res.ok) return res.json();
        const err = await res.json().catch(() => null);
        const stillExists = res.status === 422
            && err?.errors?.[0]?.message?.includes('already exists');
        if (!stillExists) {
            throw new Error(err?.message || `Failed to create GitHub repository: ${res.status}`);
        }
        lastErr = err;
        await sleep(delayMs);
    }
    throw new Error(lastErr?.message || 'Repository name did not free up after deletion — try again.');
}
```

- [ ] **Step 5: Replace the empty-check block with the decision branch**

In `server/import-service.js`, replace the existing block (`:253-262`, from `const existing = await existingRes.json();` through the `onProgress('creating', \`Reusing empty repository ...`)` line) with:

```js
                const existing = await existingRes.json();
                const decision = decideConflictResolution({
                    size: existing.size,
                    defaultBranch: existing.default_branch,
                    onConflict,
                });
                if (decision.action === 'fail') {
                    throw new Error(
                        `Repository "${ownerSegment}${targetName}" already exists on GitHub and is not empty. Choose a different target name or delete it first.`,
                    );
                }
                if (decision.action === 'replace') {
                    // Destructive: delete the existing repo, then recreate it
                    // empty so the normal --mirror push path applies. Logged so
                    // the deletion is traceable in server logs.
                    logger.warn({ owner: ownerSlug, repo: targetName }, 'Replacing existing non-empty repo (delete + recreate)');
                    onProgress('creating', `Replacing existing repository "${existing.full_name}"...`, 16);
                    await deleteGithubRepo(ownerSlug, targetName, githubHeaders);
                    createdRepo = await createGithubRepoWithRetry(endpoint, githubHeaders, {
                        name: targetName,
                        description: safeDescription,
                        private: isPrivate,
                        auto_init: false,
                    });
                    replacedExistingRepo = true;
                } else {
                    createdRepo = existing;
                    reusedExistingRepo = true;
                    onProgress('creating', `Reusing empty repository "${existing.full_name}"...`, 18);
                }
```

- [ ] **Step 6: Return the new flag**

In the success return (`:439-448`), add `replacedExistingRepo`:

```js
        return {
            success: true,
            targetFullName,
            branchCount,
            hasLFS,
            lfsFetchFailed,
            reusedExistingRepo,
            replacedExistingRepo,
            emptySource,
            repoUrl: createdRepo.html_url
        };
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/import-service-delete.test.js server/__tests__/import-service-conflict.test.js server/__tests__/import-service-core.test.js`
Expected: PASS (all). If the replace integration test trips on `validateSourceUrl`, apply the fallback in the Task 3 Step 1 note.

- [ ] **Step 8: Commit**

```bash
git add server/import-service.js server/__tests__/import-service-delete.test.js
git commit -m "feat(import): delete-and-recreate on onConflict=replace"
```

---

## Task 4: Engine forwards `onConflict` (backend)

**Files:**
- Modify: `server/migration-engine.js:763-776` (repo) and `:881-895` (repo-tfvc)
- Test: `server/__tests__/migration-engine.test.js`

- [ ] **Step 1: Write the failing test**

Add to `server/__tests__/migration-engine.test.js` (follow the existing import/mocking style in that file; this asserts the importer receives `onConflict`). If the suite already mocks `./import-service.js`, extend that mock; otherwise add:

```js
import * as importService from '../import-service.js';

it('forwards config.onConflict to importRepository for a git repo task', async () => {
    const spy = vi.spyOn(importService, 'importRepository')
        .mockResolvedValue({ success: true, targetFullName: 'acme/widget', branchCount: 1 });

    const engine = makeEngine(); // however the existing tests construct it
    const task = {
        type: 'repo',
        sourceRef: 'org/proj/widget',
        targetRef: 'acme/widget',
        config: { onConflict: 'replace', makePrivate: true },
    };

    await engine._executeTask(task, { githubToken: 'gh' });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ onConflict: 'replace' }));
    spy.mockRestore();
});
```

> Match `makeEngine()` / credential shape to the existing tests in this file (see the `surfaces "Target already exists"` test around `:1084`). Reuse their setup helpers verbatim.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/migration-engine.test.js -t "forwards config.onConflict"`
Expected: FAIL — `onConflict` not present in the importRepository args.

- [ ] **Step 3: Forward the field (git repo case)**

In `server/migration-engine.js`, the `repo` case `importRepository({...})` (`:763-776`), add after `sizeStrategy: config.sizeStrategy,`:

```js
          onConflict: config.onConflict,
```

- [ ] **Step 4: Forward the field (tfvc case)**

In the `repo-tfvc` case `importRepository({...})` (`:881-895`), add the same line after `sizeStrategy: config.sizeStrategy,`:

```js
            onConflict: config.onConflict,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/__tests__/migration-engine.test.js`
Expected: PASS (new test + existing suite green).

- [ ] **Step 6: Commit**

```bash
git add server/migration-engine.js server/__tests__/migration-engine.test.js
git commit -m "feat(migration): forward onConflict from task config to importer"
```

---

## Task 5: Carry `onConflict` from wizard state into task config (frontend)

**Files:**
- Create: `src/components/MigrationWizard/steps/buildRepoTaskConfig.js`
- Modify: `src/components/MigrationWizard/steps/ScheduleStep.jsx:78-110`
- Test: `tests/components/MigrationWizard/steps/buildRepoTaskConfig.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/components/MigrationWizard/steps/buildRepoTaskConfig.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { buildRepoTaskConfig } from '../../../../src/components/MigrationWizard/steps/buildRepoTaskConfig'

describe('buildRepoTaskConfig', () => {
  it('builds base config (visibility + description)', () => {
    const cfg = buildRepoTaskConfig(
      { visibility: 'private', description: 'hi' },
      { isInPlace: false, targetProject: '' },
    )
    expect(cfg).toEqual({ makePrivate: true, description: 'hi' })
  })

  it('adds onConflict only when conflictAction is replace', () => {
    expect(buildRepoTaskConfig({ visibility: 'public', conflictAction: 'replace' }, { isInPlace: false }))
      .toMatchObject({ onConflict: 'replace' })
    expect(buildRepoTaskConfig({ visibility: 'public', conflictAction: 'rename' }, { isInPlace: false }))
      .not.toHaveProperty('onConflict')
    expect(buildRepoTaskConfig({ visibility: 'public' }, { isInPlace: false }))
      .not.toHaveProperty('onConflict')
  })

  it('keeps lfs-migrate sizeStrategy', () => {
    expect(buildRepoTaskConfig({ visibility: 'private', sizeStrategy: 'lfs-migrate' }, { isInPlace: false }))
      .toMatchObject({ sizeStrategy: 'lfs-migrate' })
  })

  it('adds in-place fields for TFVC existing-empty', () => {
    const cfg = buildRepoTaskConfig(
      { visibility: 'private', isTfvc: true, targetType: 'existing-empty', existingRepoId: 'abc' },
      { isInPlace: true, targetProject: 'Proj' },
    )
    expect(cfg).toMatchObject({ inPlace: true, targetProject: 'Proj', existingRepoId: 'abc' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/MigrationWizard/steps/buildRepoTaskConfig.test.js`
Expected: FAIL — module not found / export missing.

- [ ] **Step 3: Create the helper**

Create `src/components/MigrationWizard/steps/buildRepoTaskConfig.js`:

```js
/**
 * Build the per-repo task `config` object for the migration engine from a
 * configured wizard repo. Pure — extracted from ScheduleStep so the
 * conflict/visibility/in-place wiring is unit-testable.
 *
 * @param {object} repo - a selected, configured wizard repo
 * @param {{ isInPlace: boolean, targetProject?: string }} ctx
 * @returns {object} task config
 */
export function buildRepoTaskConfig(repo, { isInPlace, targetProject }) {
  const baseConfig = {
    makePrivate: repo.visibility === 'private',
    description: repo.description || '',
  }
  let config = repo.sizeStrategy === 'lfs-migrate'
    ? { ...baseConfig, sizeStrategy: 'lfs-migrate' }
    : baseConfig

  // Destructive replace: carry the user's confirmed intent to the backend.
  if (repo.conflictAction === 'replace') {
    config = { ...config, onConflict: 'replace' }
  }

  if (isInPlace && repo.isTfvc) {
    config = {
      ...config,
      inPlace: true,
      targetProject,
      ...(repo.targetType === 'existing-empty' && repo.existingRepoId
        ? { existingRepoId: repo.existingRepoId }
        : {}),
    }
  }
  return config
}
```

- [ ] **Step 4: Use the helper in ScheduleStep**

In `src/components/MigrationWizard/steps/ScheduleStep.jsx`, add the import near the top (after line 14):

```js
import { buildRepoTaskConfig } from './buildRepoTaskConfig'
```

Replace the inline config construction in the `.map(repo => { ... })` (`:78-96`, the block that builds `baseConfig`/`config` including the `if (isInPlace && repo.isTfvc)` branch) with:

```js
        .map(repo => {
          const repoName = repo.targetName || repo.name
          const config = buildRepoTaskConfig(repo, { isInPlace, targetProject })
```

Leave the `targetRef` computation and the returned task object (`:97-109`) unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/components/MigrationWizard/steps/buildRepoTaskConfig.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/MigrationWizard/steps/buildRepoTaskConfig.js src/components/MigrationWizard/steps/ScheduleStep.jsx tests/components/MigrationWizard/steps/buildRepoTaskConfig.test.js
git commit -m "refactor(wizard): extract task-config builder, carry onConflict"
```

---

## Task 6: Destructive confirm modal (frontend)

**Files:**
- Create: `src/components/MigrationWizard/steps/RepoConfigStep/ReplaceConfirmModal.jsx`
- Test: `tests/components/MigrationWizard/steps/RepoConfigStep/ReplaceConfirmModal.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/MigrationWizard/steps/RepoConfigStep/ReplaceConfirmModal.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReplaceConfirmModal } from '../../../../../src/components/MigrationWizard/steps/RepoConfigStep/ReplaceConfirmModal'

describe('ReplaceConfirmModal', () => {
  const base = { isOpen: true, repoFullName: 'BolaLabs/AITOOL', onCancel: vi.fn(), onConfirm: vi.fn() }

  it('shows the destructive warning with the repo name', () => {
    render(<ReplaceConfirmModal {...base} />)
    expect(screen.getByText(/permanently delete/i)).toBeInTheDocument()
    expect(screen.getAllByText(/BolaLabs\/AITOOL/).length).toBeGreaterThan(0)
  })

  it('keeps confirm disabled until the exact name is typed', () => {
    const onConfirm = vi.fn()
    render(<ReplaceConfirmModal {...base} onConfirm={onConfirm} />)
    const confirm = screen.getByRole('button', { name: /delete & replace/i })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/type the repository name/i), { target: { value: 'wrong' } })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/type the repository name/i), { target: { value: 'BolaLabs/AITOOL' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel from the cancel button', () => {
    const onCancel = vi.fn()
    render(<ReplaceConfirmModal {...base} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/MigrationWizard/steps/RepoConfigStep/ReplaceConfirmModal.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the modal**

Create `src/components/MigrationWizard/steps/RepoConfigStep/ReplaceConfirmModal.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal, ModalFooter } from '../../../ui/Modal'
import { Input } from '../../../ui/form'

/**
 * Destructive confirmation for the "Replace" conflict action. Replacing a
 * non-empty target deletes the repo on GitHub (issues, PRs, stars, settings),
 * so the confirm button stays disabled until the user types the exact repo
 * full name — the standard guard for irreversible actions.
 *
 * @param {{ isOpen:boolean, repoFullName:string, onCancel:Function, onConfirm:Function }} props
 */
export function ReplaceConfirmModal({ isOpen, repoFullName, onCancel, onConfirm }) {
  const [typed, setTyped] = useState('')
  useEffect(() => { if (!isOpen) setTyped('') }, [isOpen])

  const matches = typed.trim() === repoFullName

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="Replace existing repository?"
      variant="danger"
      icon={AlertTriangle}
      size="md"
      footer={
        <ModalFooter align="between">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
              text-slate-600 dark:text-slate-300 bg-white/80 dark:bg-white/5
              border border-slate-200/60 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!matches}
            onClick={onConfirm}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg text-white transition-colors
              ${matches ? 'bg-red-600 hover:bg-red-700' : 'bg-red-600/40 cursor-not-allowed'}`}
          >
            Delete &amp; Replace
          </button>
        </ModalFooter>
      }
    >
      <div className="p-5 space-y-4">
        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          This will <strong>permanently delete</strong>{' '}
          <span className="font-semibold text-red-600 dark:text-red-400">{repoFullName}</span>{' '}
          on GitHub — including its issues, pull requests, stars and settings — and recreate it
          from the source. <strong>This cannot be undone.</strong>
        </p>
        <div>
          <label htmlFor="replace-confirm-name" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
            Type the repository name <span className="font-mono text-slate-700 dark:text-slate-300">{repoFullName}</span> to confirm
          </label>
          <Input
            id="replace-confirm-name"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="Type the repository name to confirm"
            placeholder={repoFullName}
            status={typed && !matches ? 'error' : 'idle'}
          />
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/MigrationWizard/steps/RepoConfigStep/ReplaceConfirmModal.test.jsx`
Expected: PASS (3 tests). If `Input` doesn't forward `id`, use `aria-label` only and change the test's `getByLabelText` target accordingly (the test already queries by the accessible name).

- [ ] **Step 5: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoConfigStep/ReplaceConfirmModal.jsx tests/components/MigrationWizard/steps/RepoConfigStep/ReplaceConfirmModal.test.jsx
git commit -m "feat(wizard): destructive type-to-confirm modal for Replace"
```

---

## Task 7: Wire confirm modal + "will replace" state (frontend)

**Files:**
- Modify: `src/components/MigrationWizard/steps/RepoConfigStep.jsx:107-110` (handleReplace), import + state + render
- Modify: `src/components/MigrationWizard/steps/RepoConfigStep/RepoCard.jsx` (badge + status)
- Test: `tests/components/MigrationWizard/steps/RepoConfigStep.guard.test.jsx`

- [ ] **Step 1: Update the failing test**

In `tests/components/MigrationWizard/steps/RepoConfigStep.guard.test.jsx`, find the test asserting `onUpdateRepo` was called with `{ conflictAction: 'replace' }` directly on Replace click (around `:161-163`). Replace it with a test that Replace now opens the modal and only confirming wires the action:

```jsx
it('Replace opens a confirm modal; confirming sets conflictAction and a will-replace badge', async () => {
  const props = makeProps({ conflictName: 'AITOOL' }) // helper that renders a conflicting repo
  render(<RepoConfigStep {...props} />)

  // Expand/locate the conflict row and click Replace
  fireEvent.click(screen.getByRole('button', { name: /^replace$/i }))

  // Modal appears; nothing wired yet
  expect(screen.getByText(/permanently delete/i)).toBeInTheDocument()
  expect(props.onUpdateRepo).not.toHaveBeenCalledWith(expect.anything(), { conflictAction: 'replace' })

  // Type-to-confirm and confirm
  fireEvent.change(screen.getByLabelText(/type the repository name/i), { target: { value: 'AITOOL' } })
  fireEvent.click(screen.getByRole('button', { name: /delete & replace/i }))

  expect(props.onUpdateRepo).toHaveBeenCalledWith(0, expect.objectContaining({ conflictAction: 'replace' }))
})
```

> Reuse the file's existing `makeProps`/render helpers and the way it seeds a conflicting repo (the current test already produces a `conflict` status). The confirm modal uses the repo's display name; for a personal target the full name may be just `AITOOL` — match whatever `repoFullName` the component passes (see Step 3).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/MigrationWizard/steps/RepoConfigStep.guard.test.jsx`
Expected: FAIL — no modal; Replace still wires the action immediately.

- [ ] **Step 3: Open the modal from `handleReplace`**

In `src/components/MigrationWizard/steps/RepoConfigStep.jsx`:

Add the import (after line 13):

```jsx
import { ReplaceConfirmModal } from './RepoConfigStep/ReplaceConfirmModal'
```

Add state near the other `useState`s (after line 34):

```jsx
  // Repo pending destructive Replace confirmation: { repo, index } | null
  const [replaceTarget, setReplaceTarget] = useState(null)
```

Compute the destination owner for the confirm copy (after `targetProject`, ~line 39):

```jsx
  const targetOwner = source?.targetOrg || source?.org || ''
```

Replace `handleReplace` (`:107-110`) with:

```jsx
  const handleReplace = (repo, index) => {
    setReplaceTarget({ repo, index })
  }

  const confirmReplace = () => {
    if (!replaceTarget) return
    const { repo, index } = replaceTarget
    // Resolved-by-replace: a distinct status (not 'clear') so the row shows a
    // visible "will replace" badge instead of silently hiding the warning.
    setConflicts((prev) => ({ ...prev, [repo.name]: 'will-replace' }))
    onUpdateRepo(index, { conflictAction: 'replace', hasConflict: false })
    setReplaceTarget(null)
  }
```

Render the modal before the closing `</div>` of the component's returned tree (just after the `quotaNotice` AnimatePresence block, before `)` of the main return):

```jsx
      <ReplaceConfirmModal
        isOpen={!!replaceTarget}
        repoFullName={replaceTarget
          ? `${targetOwner ? `${targetOwner}/` : ''}${replaceTarget.repo.targetName || replaceTarget.repo.name}`
          : ''}
        onCancel={() => setReplaceTarget(null)}
        onConfirm={confirmReplace}
      />
```

- [ ] **Step 4: Add the "will replace" badge + status in RepoCard**

In `src/components/MigrationWizard/steps/RepoConfigStep/RepoCard.jsx`, in the status cluster (the `min-w-[70px]` block, `:189-206`), show a replace state. Replace the status `<span>` label block (`:196-205`) with:

```jsx
            <span className={`ds-text-meta ${
              repo.conflictAction === 'replace' ? 'text-red-600 dark:text-red-400' :
              conflictStatus === 'clear' ? 'text-emerald-600 dark:text-emerald-400' :
              conflictStatus === 'checking' ? 'text-amber-600 dark:text-amber-400' :
              conflictStatus === 'conflict' ? 'text-red-600 dark:text-red-400' :
              'text-slate-400 dark:text-slate-500'
            }`}>
              {repo.conflictAction === 'replace' ? 'Will replace' :
               conflictStatus === 'clear' ? 'Ready' :
               conflictStatus === 'checking' ? 'Checking...' :
               conflictStatus === 'conflict' ? 'Conflict' : ''}
            </span>
```

And add `Recycle`-style emphasis: add a badge under the source→target row. After the `<RepoMetadataBadges .../>` (`:160-165`), add:

```jsx
          {repo.conflictAction === 'replace' && (
            <span className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded ds-text-micro font-semibold uppercase tracking-wide bg-red-500/10 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-2.5 h-2.5" />
              Will replace (delete) existing repo
            </span>
          )}
```

Add `AlertTriangle` to the lucide import at the top of RepoCard.jsx (line 2-5 import list).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/components/MigrationWizard/steps/RepoConfigStep.guard.test.jsx tests/components/MigrationWizard/steps/RepoConfigStep/ReplaceConfirmModal.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoConfigStep.jsx src/components/MigrationWizard/steps/RepoConfigStep/RepoCard.jsx tests/components/MigrationWizard/steps/RepoConfigStep.guard.test.jsx
git commit -m "feat(wizard): confirm Replace destructively and show pending state"
```

---

## Task 8: Block-before-run guard (frontend)

**Files:**
- Modify: `src/components/MigrationWizard/steps/RepoConfigStep.jsx` (sync `hasConflict` to repo state)
- Modify: `src/components/MigrationWizard/MigrationWizard.jsx:91-93,205-211` (Next guard)
- Test: `tests/components/MigrationWizard/steps/RepoConfigStep.guard.test.jsx`

- [ ] **Step 1: Write the failing test**

Add to `tests/components/MigrationWizard/steps/RepoConfigStep.guard.test.jsx`:

```jsx
it('syncs hasConflict onto repo state when a conflict is present', async () => {
  const props = makeProps({ conflictName: 'AITOOL' })
  render(<RepoConfigStep {...props} />)
  // The sync effect marks the conflicting repo so the wizard footer can gate Next.
  await waitFor(() => {
    expect(props.onUpdateRepo).toHaveBeenCalledWith(0, { hasConflict: true })
  })
})
```

(Import `waitFor` from `@testing-library/react` if not already imported.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/MigrationWizard/steps/RepoConfigStep.guard.test.jsx -t "syncs hasConflict"`
Expected: FAIL — no such `onUpdateRepo` call.

- [ ] **Step 3: Sync conflict status to repo state**

In `src/components/MigrationWizard/steps/RepoConfigStep.jsx`, add an effect after the existing conflict effects (after the LFS-seeding effect, ~line 172):

```jsx
  // Mirror live conflict detection onto repo state so the wizard shell can
  // block "Next" while any selected repo has an unresolved conflict. Guarded
  // so it only writes on a real change (no render loop).
  useEffect(() => {
    repos.forEach((repo, index) => {
      const isConflict = conflicts[repo.name] === 'conflict'
      if (!!repo.hasConflict !== isConflict) {
        onUpdateRepo(index, { hasConflict: isConflict })
      }
    })
  }, [conflicts, repos, onUpdateRepo])
```

- [ ] **Step 4: Gate Next in the wizard shell**

In `src/components/MigrationWizard/MigrationWizard.jsx`, after `blockerCount` (`:91-93`) add:

```jsx
  const conflictCount = currentStep === 'repoConfig'
    ? selectedRepos.filter((r) => r.hasConflict).length
    : 0
  const advanceBlocked = blockerCount > 0 || conflictCount > 0
```

Update the footer Next button (`:205-211`) to use `advanceBlocked` and a conflict-aware tooltip:

```jsx
          disabled={advanceBlocked}
          title={
            blockerCount > 0
              ? `${blockerCount} blocker(s) must be resolved — open a row to see options`
              : conflictCount > 0
                ? `Resolve ${conflictCount} naming conflict(s) to continue — choose Replace, Rename or Skip`
                : undefined
          }
          className={`inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-semibold rounded-lg text-white
            ${advanceBlocked
              ? 'bg-slate-600 cursor-not-allowed opacity-60'
              : 'bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] hover:bg-[color:var(--ds-accent-brand-hover)] dark:hover:bg-[color:var(--ds-accent-brand)]'}
            shadow-md transition-all duration-200`}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/components/MigrationWizard/steps/RepoConfigStep.guard.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoConfigStep.jsx src/components/MigrationWizard/MigrationWizard.jsx tests/components/MigrationWizard/steps/RepoConfigStep.guard.test.jsx
git commit -m "feat(wizard): block Next while a naming conflict is unresolved"
```

---

## Task 9: Error-screen recovery + "Replaced" badge (frontend)

**Files:**
- Modify: `src/components/MigrationWizard/steps/SummaryStep.jsx` (ErrorCard button + Replaced badge + props)
- Modify: `src/components/MigrationWizard/StepRenderer.jsx:148-156` (pass `onResolveConflict`)
- Modify: `src/components/MigrationWizard/MigrationWizard.jsx` (wire `onResolveConflict`)
- Test: `tests/components/MigrationWizard/steps/SummaryStep.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/components/MigrationWizard/steps/SummaryStep.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SummaryStep from '../../../../src/components/MigrationWizard/steps/SummaryStep'
import { migrationApi } from '../../../../src/api/migration'

vi.mock('../../../../src/api/migration', () => ({
  migrationApi: { getReport: vi.fn() },
}))

const report = {
  plan: { status: 'completed', durationSeconds: 10 },
  summary: { total: 1, success: 0, failed: 1, skipped: 0 },
  tasks: [{ id: 1, type: 'repo', status: 'failed', sourceRef: 'a/b/AITOOL', targetRef: 'BolaLabs/AITOOL', durationSeconds: 10 }],
  errors: [{ taskId: 1, type: 'repo', error: 'Repository "BolaLabs/AITOOL" already exists on GitHub and is not empty.', suggestion: 'Rename or delete it.' }],
}

describe('SummaryStep conflict recovery', () => {
  beforeEach(() => { migrationApi.getReport.mockResolvedValue(report) })

  it('shows a Resolve conflict button on an "already exists" error and fires onResolveConflict', async () => {
    const onResolveConflict = vi.fn()
    render(<SummaryStep planId="p1" onResolveConflict={onResolveConflict} />)
    const btn = await screen.findByRole('button', { name: /resolve conflict/i })
    fireEvent.click(btn)
    expect(onResolveConflict).toHaveBeenCalledWith(expect.objectContaining({ taskId: 1 }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/MigrationWizard/steps/SummaryStep.test.jsx`
Expected: FAIL — no "Resolve conflict" button.

- [ ] **Step 3: Add the recovery button to ErrorCard**

In `src/components/MigrationWizard/steps/SummaryStep.jsx`:

Change the `ErrorCard` signature (`:271`) to accept the callback:

```jsx
function ErrorCard({ error, index, onResolveConflict }) {
```

Just inside `ErrorCard`, after `const oversized = decodeOversizedError(error.error)` (~`:276`), add:

```jsx
  const isConflict = /already exists/i.test(error.error || '')
```

In the expandable detail, after the `error.suggestion` block (`:351-358`), add:

```jsx
                  {isConflict && onResolveConflict && (
                    <button
                      type="button"
                      onClick={() => onResolveConflict(error)}
                      className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg
                        text-white bg-red-600 hover:bg-red-700 transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Resolve conflict
                    </button>
                  )}
```

Add `RefreshCw` to the lucide import block (`:4-9`).

Thread the prop where `ErrorCard` is rendered (`:623-625`):

```jsx
            {taskErrors.map((err, i) => (
              <ErrorCard key={err.taskId} error={err} index={i} onResolveConflict={onResolveConflict} />
            ))}
```

Add `onResolveConflict` to the `SummaryStep` props (`:434`):

```jsx
export default function SummaryStep({ planId, onNewMigration, onViewHistory, onResolveConflict, preflightFlags = [] }) {
```

- [ ] **Step 4: Add the "Replaced" badge to TaskResultRow**

In `TaskResultRow`, after the `task.metadata?.reusedExistingRepo` badge block (`:215-222`), add:

```jsx
          {task.metadata?.replacedExistingRepo && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded ds-text-micro font-medium bg-red-500/10 text-red-600 dark:text-red-400"
              title="Deleted the pre-existing repo and recreated it from source"
            >
              Replaced
            </span>
          )}
```

- [ ] **Step 5: Wire the callback through StepRenderer + MigrationWizard**

In `src/components/MigrationWizard/StepRenderer.jsx`, the `summary` case (`:148-156`), add the prop:

```jsx
      case 'summary':
        return (
          <SummaryStep
            planId={planId}
            onNewMigration={resetWizard}
            onViewHistory={onClose}
            onResolveConflict={ctx.onResolveConflict}
            preflightFlags={selectedRepos.flatMap((r) => r.risk?.flags || [])}
          />
        )
```

In `src/components/MigrationWizard/MigrationWizard.jsx`, add a handler before `stepCtx` (~`:140`):

```jsx
  // From the Summary error screen: jump back to Configure so the user can
  // choose Replace/Rename/Skip and re-run. The conflict re-surfaces there.
  const handleResolveConflict = useCallback(() => {
    setDirection(-1)
    goToStep('repoConfig')
  }, [setDirection, goToStep])
```

Add it to the `stepCtx` object (`:144-174`):

```jsx
    onResolveConflict: handleResolveConflict,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/components/MigrationWizard/steps/SummaryStep.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/MigrationWizard/steps/SummaryStep.jsx src/components/MigrationWizard/StepRenderer.jsx src/components/MigrationWizard/MigrationWizard.jsx tests/components/MigrationWizard/steps/SummaryStep.test.jsx
git commit -m "feat(wizard): resolve-conflict recovery + replaced badge on summary"
```

---

## Final verification

- [ ] **Run the full unit suite**

Run: `npx vitest run`
Expected: all green (no regressions in migration-engine, import-service, wizard suites).

- [ ] **Run lint / Portuguese-UI guard**

Run: `npx vitest run tests/build/no-portuguese-ui.test.js`
Expected: PASS (all new UI strings are English).

- [ ] **Manual smoke (optional, via `/run`)**

1. Configure a migration where the target repo already exists and is non-empty → row shows "Conflict", Next is disabled.
2. Click Replace → confirm modal → type-to-confirm → row shows "Will replace"; Next enabled.
3. Run → engine deletes + recreates → Summary shows success with a "Replaced" badge.
4. Force a residual conflict (e.g. skip the Replace) → Summary error shows "Resolve conflict" → returns to Configure.

---

## Self-Review (completed during authoring)

- **Spec coverage:** Pillar 1 → Tasks 1–5; Pillar 2 → Tasks 6–7; Pillar 3 → Task 8; Pillar 4 → Task 9. Security (scoped delete + logging) → Task 3. Testing section → tests in every task.
- **Placeholder scan:** none — every code/test step shows real code.
- **Type consistency:** `onConflict` ('fail'|'replace') consistent across import-service, engine, buildRepoTaskConfig, ScheduleStep; `replacedExistingRepo` consistent between importer return → engine metadata → SummaryStep; `conflictAction: 'replace'` and the `'will-replace'` conflict status consistent between RepoConfigStep and RepoCard; `hasConflict` consistent between RepoConfigStep sync and MigrationWizard guard.
- **Deviation:** audit recorded via `logger.warn` (Task 3), not `auditLogDirect` — documented in the header.
