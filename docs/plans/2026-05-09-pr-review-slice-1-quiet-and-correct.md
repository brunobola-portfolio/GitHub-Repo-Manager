# PR Review — Slice 1: Quiet & Correct — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the two reproducible console-noise sources on the PR/commit review surface — the unhandled 403 from `GET /branches/:branch/protection` for non-admin collaborators, and the dev-only `[@git-diff-view/core] Mismatch detected` warnings on every commit/PR file render.

**Architecture:**
- **Backend** classifies the 403 into a structured `code: 'INSUFFICIENT_PERMISSIONS'` so the client can branch on intent, not regex-sniff messages.
- **Client** `BranchProtectionPanel` adds a `permissionDenied` state that mirrors the existing `upgradeRequired` UX (card + inline chip variants).
- **Diff renderer** installs a one-time `console.warn` filter, scoped to the `@git-diff-view/core` prefix, executed at module load with a clear comment pointing back to this plan and the spec.

**Tech Stack:** React 19, Vite, Vitest (unit tests), Playwright (e2e smoke); existing `@git-diff-view/react`/`@git-diff-view/core` 0.x.

**Spec reference:** [docs/specs/2026-05-09-pr-review-perf-and-polish-design.md](../specs/2026-05-09-pr-review-perf-and-polish-design.md), Slice 1.

---

## File map

- **Modify** `server/routes/repos/branches-releases.js:101-127` — add a third 403 branch (insufficient-permissions vs Pro-required vs generic).
- **Modify** `src/components/RepoDetail/BranchProtectionPanel.jsx` — add `permissionDenied` state, render card + inline variants, branch on `err.code`.
- **Modify** `src/components/PRReview/DiffPanel/DiffRenderer.jsx` — install the warn-filter at module scope.
- **New** `tests/server/branch-protection-route.test.js` (or extend existing `server/__tests__/branch-protection-route.test.js`) — assert the new structured 403 code.
- **Modify** `tests/components/BranchProtectionPanel.test.jsx` — add `permissionDenied` rendering tests for both variants.
- **Modify** `tests/components/DiffRenderer.test.jsx` — regression test that the lib's mismatch warning is suppressed.

---

## Task 1: Backend — structured INSUFFICIENT_PERMISSIONS code on 403

**Files:**
- Modify: `server/routes/repos/branches-releases.js:101-127`
- Test: `server/__tests__/branch-protection-route.test.js`

- [ ] **Step 1: Read the existing test file to find naming/style conventions**

Run: open `server/__tests__/branch-protection-route.test.js` and skim the existing assertions for the GitHub-Pro-required path. The new test mirrors that style.

- [ ] **Step 2: Write the failing test**

Add this test to `server/__tests__/branch-protection-route.test.js` (place it next to the existing 403→GITHUB_PRO_REQUIRED test):

```js
it('forwards a structured INSUFFICIENT_PERMISSIONS code when GitHub returns 403 without Pro-upgrade hint', async () => {
    githubApi.mockRejectedValueOnce(Object.assign(new Error('Must have admin rights to Repository.'), { status: 403 }));
    const res = await request(app)
        .get('/api/repos/octo/widget/branches/main/protection')
        .set('Cookie', authCookie)
        .expect(403);
    expect(res.body).toEqual({
        error: expect.any(String),
        code: 'INSUFFICIENT_PERMISSIONS',
    });
});
```

(Adjust `githubApi` mock name and `authCookie` setup to match the file's existing fixtures.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/__tests__/branch-protection-route.test.js -t "INSUFFICIENT_PERMISSIONS"`
Expected: FAIL — assertion mismatch on `code` (the route currently routes to the generic `safeError` branch, returning `{ error: ... }` without a `code`).

- [ ] **Step 4: Edit the route handler**

In `server/routes/repos/branches-releases.js`, replace the `else` arm at lines 122-126 with a two-arm split:

```js
} else if (error.status === 403) {
    // No Pro-upgrade hint, just plain 403 from GitHub. Most common cause:
    // the authenticated user is a collaborator without admin on the repo,
    // and branch protection requires admin. Surface a structured code so
    // the client can render a quiet "admin required" affordance instead
    // of an alarming toast.
    res.status(403).json({
        error: 'Admin access on this repository is required to view branch protection.',
        code: 'INSUFFICIENT_PERMISSIONS',
    });
} else {
    req.log.error({ err: error }, 'Get branch protection failed');
    res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
}
```

The existing `else if (error.status === 403 && /upgrade.*github pro|make this repository public/i.test(...))` arm at line 110 stays first so the Pro-required path is matched before the generic 403 catch-all.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/__tests__/branch-protection-route.test.js`
Expected: PASS — both the existing GITHUB_PRO_REQUIRED test and the new INSUFFICIENT_PERMISSIONS test green.

- [ ] **Step 6: Commit**

```bash
git add server/routes/repos/branches-releases.js server/__tests__/branch-protection-route.test.js
git commit -m "feat(branches): forward structured INSUFFICIENT_PERMISSIONS code on 403

Non-admin collaborators hit the protection endpoint and currently get
a generic 403 with no structured code, which the client surfaces as a
toast. Classify the case so the client can render a quiet inline
affordance instead."
```

---

## Task 2: Client — `permissionDenied` state in BranchProtectionPanel

**Files:**
- Modify: `src/components/RepoDetail/BranchProtectionPanel.jsx`
- Test: `tests/components/BranchProtectionPanel.test.jsx`

- [ ] **Step 1: Read the existing test file**

Run: open `tests/components/BranchProtectionPanel.test.jsx` and find the test that covers `upgradeRequired`. The new tests mirror its setup (mock `api.fetchBranchProtection` to throw with a structured `code`).

- [ ] **Step 2: Write the failing test for the card variant**

Append to `tests/components/BranchProtectionPanel.test.jsx`:

```jsx
it('renders the admin-only inline card when API returns INSUFFICIENT_PERMISSIONS', async () => {
    const api = {
        fetchBranchProtection: vi.fn().mockRejectedValueOnce(Object.assign(new Error('admin required'), { status: 403, code: 'INSUFFICIENT_PERMISSIONS' })),
    };
    render(<BranchProtectionPanel api={api} branch="main" />);
    await waitFor(() => {
        expect(screen.getByText(/admin access required/i)).toBeInTheDocument();
    });
    // It must NOT raise a toast for an expected, structured permission case.
    expect(toast.errorFromException).not.toHaveBeenCalled();
});

it('renders an "admin only" chip when API returns INSUFFICIENT_PERMISSIONS in inline variant', async () => {
    const api = {
        fetchBranchProtection: vi.fn().mockRejectedValueOnce(Object.assign(new Error('admin required'), { status: 403, code: 'INSUFFICIENT_PERMISSIONS' })),
    };
    render(<BranchProtectionPanel api={api} branch="main" variant="inline" />);
    await waitFor(() => {
        expect(screen.getByText(/admin only/i)).toBeInTheDocument();
    });
});
```

(If `toast.errorFromException` isn't already mocked in the test file, follow the existing mock pattern from the upgrade-required test.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/components/BranchProtectionPanel.test.jsx`
Expected: FAIL — both new tests; the component falls through to `toast.errorFromException` and never renders the new affordances.

- [ ] **Step 4: Add `permissionDenied` state and branch logic**

In `src/components/RepoDetail/BranchProtectionPanel.jsx`:

1. Add a new state hook next to `upgradeRequired` (around line 72):

```jsx
const [permissionDenied, setPermissionDenied] = useState(false)
```

2. Reset it at the top of `load()` (line 77 area):

```jsx
setUpgradeRequired(false)
setPermissionDenied(false)
```

3. Add a branch in the `catch` block (between the existing `GITHUB_PRO_REQUIRED` check and the toast fallback, around line 84-87):

```jsx
if (err?.code === 'INSUFFICIENT_PERMISSIONS' || (err?.status === 403 && !err?.code)) {
    // Quiet failure: the user just doesn't have admin on this repo.
    // The status === 403 && !code heuristic protects us if a backend
    // version without the structured code is ever in front of this
    // client (graceful rollout / cached SW).
    setPermissionDenied(true)
    return
}
```

4. Add the `inline` variant rendering branch (right after the `upgradeRequired` inline branch, around line 144-150):

```jsx
if (permissionDenied) {
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/40" title="You need admin access to this repository to view or change branch protection rules.">
            🔒 admin only
        </span>
    )
}
```

5. Add the card variant rendering branch (in the main `Card` body, parallel to the `upgradeRequired` block at lines 184-203):

```jsx
) : permissionDenied ? (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700/60 bg-slate-50/60 dark:bg-slate-800/30 p-5 text-center">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 mb-3">
            <Shield className="w-5 h-5 text-slate-500 dark:text-slate-400" />
        </div>
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Admin access required
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-md mx-auto">
            You're a collaborator on this repository but don't have admin access. Branch protection rules can only be viewed and edited by admins.
        </p>
    </div>
) : !rules ? (
```

(Insert this branch *between* the `upgradeRequired ? ( ... ) :` close and the `!rules ? ( ... )` open. Both `Shield` and the rest of the imports stay unchanged.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/components/BranchProtectionPanel.test.jsx`
Expected: PASS — both new tests plus all existing tests still green.

- [ ] **Step 6: Commit**

```bash
git add src/components/RepoDetail/BranchProtectionPanel.jsx tests/components/BranchProtectionPanel.test.jsx
git commit -m "feat(branches): handle non-admin 403 with quiet inline affordance

Non-admin collaborators previously triggered a generic error toast on
the branch-protection endpoint. Branch on the new
INSUFFICIENT_PERMISSIONS code (with a status===403 && !code fallback
for staggered backend rollouts) and render a neutral 'admin access
required' card and chip instead."
```

---

## Task 3: Client — silence `@git-diff-view/core` mismatch warnings

**Files:**
- Modify: `src/components/PRReview/DiffPanel/DiffRenderer.jsx:1-7`
- Test: `tests/components/DiffRenderer.test.jsx`

**Background context for the implementer:** The library's `_DiffFile_checkFile` runs only when `process.env.NODE_ENV === "development"` (verified at `node_modules/@git-diff-view/core/dist/esm/index.mjs:2727`). It validates that the reconstructed `oldFileContent`/`newFileContent` round-trip against the parsed diff lines. We feed it GitHub patch fragments without full file content, so the reconstruction is inherently lossy and the warning is unactionable. We silence it explicitly at module load.

- [ ] **Step 1: Write the failing test**

Append to `tests/components/DiffRenderer.test.jsx`:

```jsx
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
// ...existing imports

describe('DiffRenderer console hygiene', () => {
    let warnSpy
    beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
        warnSpy.mockRestore()
    })

    it('does not surface @git-diff-view/core mismatch warnings', async () => {
        // A patch that empirically triggered the dev warning before the
        // filter — a multi-hunk patch with no full file content.
        const patch = `@@ -1,3 +1,4 @@
 line one
-old two
+new two
+brand new three
 line four
@@ -10,2 +11,3 @@
 unchanged
+inserted at the end`
        render(<DiffRenderer filename="example.js" patch={patch} viewMode="unified" />)
        await waitFor(() => {
            expect(screen.getByText(/line one/)).toBeInTheDocument()
        })
        const muted = warnSpy.mock.calls.find((args) =>
            String(args[0]).includes('[@git-diff-view/core] Mismatch detected'),
        )
        expect(muted).toBeUndefined()
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/DiffRenderer.test.jsx -t "console hygiene"`
Expected: FAIL — the spy captures one or more `[@git-diff-view/core] Mismatch detected ...` calls (the dev-only check fires).

- [ ] **Step 3: Install the warn filter at module scope**

In `src/components/PRReview/DiffPanel/DiffRenderer.jsx`, add this block immediately after the imports (after line 6):

```jsx
// Silence a dev-only sanity warning from @git-diff-view/core that fires
// because we feed it GitHub patch fragments (no full file content). The
// library tries to reconstruct old/new file content from the diff and
// validates round-trip — for partial patches the validation is structurally
// unactionable. The warning lives at @git-diff-view/core/index.mjs:2736 and
// is gated on NODE_ENV === 'development', so this filter is a no-op in prod.
// See docs/specs/2026-05-09-pr-review-perf-and-polish-design.md, Slice 1.2.
if (typeof window !== 'undefined' && import.meta.env.DEV) {
    const PREFIX = "[@git-diff-view/core] Mismatch detected"
    const originalWarn = console.warn
    if (!originalWarn.__diffViewMismatchFiltered) {
        const filtered = (...args) => {
            if (typeof args[0] === 'string' && args[0].startsWith(PREFIX)) return
            return originalWarn.apply(console, args)
        }
        filtered.__diffViewMismatchFiltered = true
        console.warn = filtered
    }
}
```

The `__diffViewMismatchFiltered` sentinel guards against double-install during HMR / repeated module evaluation.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/DiffRenderer.test.jsx`
Expected: PASS — the new console-hygiene test green; existing DiffRenderer tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/components/PRReview/DiffPanel/DiffRenderer.jsx tests/components/DiffRenderer.test.jsx
git commit -m "fix(diff): silence dev-only @git-diff-view/core mismatch warnings

The library validates round-trip reconstruction of file content from
the diff, which is unactionable when we feed it GitHub patch fragments
without full file context. Filter the warning at module load (dev-only)
with a sentinel to survive HMR. No-op in production."
```

---

## Task 4: Manual smoke verification

**Goal:** confirm with a real browser session that the console is clean for both fix paths.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server up on the default Vite port (usually 5173) with `/api/*` proxied to the Express backend on 3001.

- [ ] **Step 2: Open the affected repo in a browser**

In a browser tab, log in (if not already) and navigate to a repo where the user is a collaborator without admin — `BolaLabs/VOA-SUPPORT-SYSTEM` is the known reproducer. Open DevTools → Console. Filter level to "All".

- [ ] **Step 3: Observe the Branches tab**

Click the Branches tab. Look for:
- ✅ The per-branch row chip should now read `🔒 admin only` (or similar — text from Task 2 step 4) instead of any console error or toast.
- ✅ No red error toast appears.
- ✅ No "useRepoDetail.js:24 GET ... 403 (Forbidden)" pile-up beyond the single network entry that the browser always logs for any 4xx (the JS error stack should be gone).

- [ ] **Step 4: Open a commit detail**

Click the Commits tab → click any recent commit. Look for:
- ✅ The diff renders normally.
- ✅ No `[@git-diff-view/core] Mismatch detected ...` warning in the console.

- [ ] **Step 5: Open a PR with multiple files**

Open the PRs tab → click any PR with at least 3 changed files → Files tab. Look for:
- ✅ Same — no `Mismatch detected` warnings as you click between files.

- [ ] **Step 6: Stop the dev server**

Ctrl-C the `npm run dev` process.

- [ ] **Step 7: Final sanity run**

Run: `npx vitest run` (full unit suite) — confirm zero regressions across the touched test files.
Expected: all green.

---

## Out of scope for this slice

Explicitly NOT done here (covered by slices 2 and 3 of the parent spec):
- Hunk virtualisation, fold-by-default, sticky composer.
- Mobile bottom-sheet file tree, drawer AI panel, action bar polish.
- Replacing `@git-diff-view/react` with a different renderer.
- IndexedDB migration for draft persistence.

---

## Self-review checklist (already run during planning)

- ✅ Spec coverage: every concrete change in spec §Slice 1 has a task here (1.1 → Tasks 1+2; 1.2 → Task 3; 1.3 → Task 4 + the unit tests in Tasks 1-3).
- ✅ No placeholders or TBDs.
- ✅ Type / property consistency: `code: 'INSUFFICIENT_PERMISSIONS'` is the same string in backend handler, route test, client branch, and component tests.
- ✅ Each task includes failing test → implementation → passing test → commit.
- ✅ Manual smoke step is concrete (specific repo, specific tabs, specific console filter).
