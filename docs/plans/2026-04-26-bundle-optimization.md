# Bundle Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the eager production bundle by tree-shaking Sentry to its actually-used API surface and pushing diff-match-patch + git-diff-view + shiki + sentry into their own lazy chunks via `manualChunks`.

**Architecture:** Two independent, sequential slices. Slice A is a pure refactor (namespace → named imports) on `main.jsx` and `lib/observability.js`. Slice B adds 3-4 entries to the existing `manualChunks` callback in `vite.config.js` and verifies the eager `index-*.js` no longer imports the heavy catch-all chunk.

**Tech Stack:** Vite 8 + rolldown, `@sentry/react` v10, `rollup-plugin-visualizer` (already wired via `ANALYZE=true`).

**Spec:** [docs/specs/2026-04-26-bundle-optimization.md](../specs/2026-04-26-bundle-optimization.md)

---

## File Structure

**Modify:**
- `src/main.jsx` — convert `import * as Sentry from '@sentry/react'` to named import of `init`
- `src/lib/observability.js` — convert namespace import to named imports of `getClient` + `addBreadcrumb`; drop dead `getCurrentHub` legacy fallback
- `vite.config.js` — extend `manualChunks` callback with rules for diff-match-patch, @git-diff-view, shiki, @sentry

**Create:**
- `docs/reports/2026-04-26-bundle-optimization-results.md` — before/after numbers per chunk

**No new tests.** The existing observability.js public API (`trackBreadcrumb`, `mark`, `measure`, `__internals.isSentryActive`) is preserved byte-for-byte; the changes are import-only refactors. Bundle size assertions are manual verification (the build honesty test in `tests/build/` already runs the build).

---

## Slice A — Sentry tree-shake

### Task 1: Capture baseline bundle metrics

**Files:** None modified. Captures the "before" snapshot for the audit doc.

- [ ] **Step 1: Clean build with the analyzer**

```bash
cd "s:/Git Hub Repo Manager"
rm -rf dist
npm run build:analyze 2>&1 | tee .dev/baseline-build.log
```

Expected: build completes; `dist/bundle-analysis.html` opens in a browser tab (close it).

- [ ] **Step 2: Capture the baseline numbers**

```bash
ls -la dist/assets/*.js | sort -k5 -n -r | head -10 > .dev/baseline-chunks.txt
cat .dev/baseline-chunks.txt
```

Expected: prints the 10 largest JS chunks with raw bytes. Save mentally:
- The big `esm-*.js` chunk (~1 MB raw / 332 KB gz at audit time)
- Total of all chunks

- [ ] **Step 3: Confirm `index-*.js` imports `esm-*.js`**

```bash
ESM_CHUNK=$(ls dist/assets/esm-*.js | head -1 | xargs basename)
grep -E "from\s*['\"][^'\"]*${ESM_CHUNK}" dist/assets/index-*.js
```

Expected: prints the import line. Confirms the eager-import problem documented in the spec.

- [ ] **Step 4: Capture Sentry-specific warnings**

```bash
grep -E 'IMPORT_IS_UNDEFINED.*getCurrentHub' .dev/baseline-build.log
```

Expected: prints 2 occurrences (from `lib/observability.js:13` and `:14`). Slice A makes these go away.

---

### Task 2: Convert main.jsx to named Sentry import

**Files:**
- Modify: `src/main.jsx` — the Sentry import + the `if (VITE_SENTRY_DSN) Sentry.init(...)` block

- [ ] **Step 1: Replace the import**

Read the current file to find the exact import line:

```bash
grep -n "@sentry/react" src/main.jsx
```

Expected: line 12 with `import * as Sentry from '@sentry/react'`.

Replace it:

```js
// Before
import * as Sentry from '@sentry/react'

// After
import { init as sentryInit } from '@sentry/react'
```

- [ ] **Step 2: Replace the call site**

In the same file, find the `if (import.meta.env.VITE_SENTRY_DSN) { Sentry.init(...) }` block (around line 18-22).

Replace `Sentry.init` with `sentryInit`:

```js
// Before
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0,
  })
}

// After
if (import.meta.env.VITE_SENTRY_DSN) {
  sentryInit({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0,
  })
}
```

- [ ] **Step 3: Verify no other `Sentry.` references remain in main.jsx**

```bash
grep -n "Sentry\." src/main.jsx
```

Expected: zero matches (the only ones were the namespace import + init call we replaced). If any remain, replace them with named imports too.

- [ ] **Step 4: Run the suite**

```bash
npx vitest run
```

Expected: 2728 tests passing. The change is import-only; nothing functional moved.

- [ ] **Step 5: Build to confirm no breakage**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds. The `IMPORT_IS_UNDEFINED` warning for `getCurrentHub` may still appear because `observability.js` still does the namespace import — Slice A Task 3 fixes that.

- [ ] **Step 6: Commit**

```bash
git add src/main.jsx
git commit -m "refactor(sentry): named init import in main.jsx for tree-shake"
```

---

### Task 3: Convert observability.js to named Sentry imports + drop dead fallback

**Files:**
- Modify: `src/lib/observability.js`

- [ ] **Step 1: Replace the imports**

In `src/lib/observability.js`, replace lines 14-23 (the comment block + the namespace import):

```js
// Before
// Resolve Sentry lazily + defensively. We don't statically import
// @sentry/react here because:
//   - In test environments (happy-dom) the package is installed but not
//     initialised; calling addBreadcrumb before init is harmless but
//     noisy. Probing a window-level flag + the module at call time keeps
//     behaviour symmetric in dev / test / prod.
//   - Self-hosted users who vendor the frontend without VITE_SENTRY_DSN
//     get a silent no-op with zero bundle cost beyond the import below.
import * as SentryReact from '@sentry/react';

// After
// Sentry is consumed via named imports so Vite/Rollup tree-shake the
// rest of @sentry/react. Both `getClient` (active-init probe) and
// `addBreadcrumb` (the actual API we use) are stable v8+ exports.
// Self-hosted users without VITE_SENTRY_DSN still get a silent no-op
// because main.jsx skips Sentry.init unless the DSN is present —
// addBreadcrumb on an uninitialised SDK is itself a documented no-op.
import { getClient, addBreadcrumb } from '@sentry/react';
```

- [ ] **Step 2: Simplify isSentryActive (drop the dead getCurrentHub fallback)**

Replace lines 31-44 (the function body) with a tighter version:

```js
// Before
function isSentryActive() {
    try {
        if (typeof SentryReact.getClient === 'function') {
            return Boolean(SentryReact.getClient());
        }
        // Legacy fallback — some older Sentry builds only expose getCurrentHub.
        if (typeof SentryReact.getCurrentHub === 'function') {
            return Boolean(SentryReact.getCurrentHub()?.getClient());
        }
    } catch {
        /* ignore */
    }
    return false;
}

// After
function isSentryActive() {
    try {
        return Boolean(getClient());
    } catch {
        return false;
    }
}
```

The legacy `getCurrentHub` fallback is dead code in `@sentry/react` v10+ (the export was removed in v8). Build warnings already confirmed it.

- [ ] **Step 3: Update the addBreadcrumb call**

In `trackBreadcrumb` (around lines 54-66), replace the namespace reference:

```js
// Before
export function trackBreadcrumb(category, message, data, level = 'info') {
    if (!isSentryActive()) return;
    try {
        SentryReact.addBreadcrumb({
            category,
            message,
            data,
            level,
        });
    } catch {
        /* breadcrumb failure must never break the app */
    }
}

// After
export function trackBreadcrumb(category, message, data, level = 'info') {
    if (!isSentryActive()) return;
    try {
        addBreadcrumb({
            category,
            message,
            data,
            level,
        });
    } catch {
        /* breadcrumb failure must never break the app */
    }
}
```

- [ ] **Step 4: Verify no `SentryReact.` references remain**

```bash
grep -n "SentryReact\." src/lib/observability.js
```

Expected: zero matches.

- [ ] **Step 5: Run the suite**

```bash
npx vitest run tests/lib tests/components
```

Expected: existing tests pass. The public API of `observability.js` (`trackBreadcrumb`, `mark`, `measure`, `__internals.isSentryActive`) is identical, so no test should regress.

- [ ] **Step 6: Build and confirm warnings gone**

```bash
npm run build 2>&1 | grep -E 'IMPORT_IS_UNDEFINED|Warning' | head -10
```

Expected: no `getCurrentHub` warnings. If any other warnings appear, they're unrelated to this slice.

- [ ] **Step 7: Commit**

```bash
git add src/lib/observability.js
git commit -m "refactor(observability): named Sentry imports + drop dead getCurrentHub fallback"
```

---

## Slice B — `esm-*.js` chunk split

### Task 4: Inspect the eager esm chunk's contents

**Files:** None modified. Investigation step.

- [ ] **Step 1: Rebuild with the analyzer**

```bash
cd "s:/Git Hub Repo Manager"
rm -rf dist
npm run build:analyze
```

Expected: `dist/bundle-analysis.html` opens.

- [ ] **Step 2: Identify the largest contributors to `esm-*.js`**

In the treemap, click into the largest `esm-*.js` rectangle. Note the top 5-10 modules by size. Likely candidates:
- `diff-match-patch` (used by @git-diff-view; lazy in code but pulled eagerly without manualChunks rule)
- `@git-diff-view/react` + `@git-diff-view/shiki`
- `shiki` (syntax highlighting; pulled by @git-diff-view)
- `@sentry/react` + `@sentry/browser` (even after Slice A)
- `react-markdown` residue
- Any other > 30 KB raw module

- [ ] **Step 3: Save the findings**

```bash
# Manually note the top ~10 contributors. Save them in:
cat > .dev/esm-chunk-contents.txt <<EOF
- diff-match-patch  ~XX KB raw
- @git-diff-view/* ~XX KB raw
- shiki            ~XX KB raw
- @sentry/*        ~XX KB raw (after slice A)
- ...
EOF
```

(The exact format doesn't matter; this file feeds the audit doc in Task 7.)

- [ ] **Step 4: Confirm each candidate is lazy-only**

For each candidate, confirm no eager file imports it directly:

```bash
# Example for diff-match-patch:
grep -rn "from ['\"]diff-match-patch" src/ --include='*.jsx' --include='*.js' \
  | grep -v 'lazy\|dynamic'
```

Expected: zero matches outside files that already use `lazy(() => import(...))`. If a static eager import shows up, that's the offender — the fix is to move that import behind `lazy()` rather than to add a `manualChunks` rule.

Do the same for `@git-diff-view`, `shiki`, `@sentry/react`. Quick way:

```bash
for pkg in diff-match-patch @git-diff-view shiki @sentry/react; do
    echo "=== $pkg ==="
    grep -rn "from ['\"]$pkg" src/ --include='*.jsx' --include='*.js' | head -5
done
```

Note any eager importer for fixing in Task 5 step 1 (before adding manualChunks rules).

---

### Task 5: Add manualChunks rules for the heavy lazy-only deps

**Files:**
- Modify: `vite.config.js`

- [ ] **Step 1: (If Task 4 step 4 found eager importers) move them behind lazy()**

For each eager static import of a heavy lib, find the consuming component and refactor to `lazy()`. The pattern that already exists in this codebase:

```js
// Before (eager)
import { DiffPanel } from './DiffPanel'

// After (lazy)
const DiffPanel = lazy(() => import('./DiffPanel'))
```

Wrap the JSX usage in `<Suspense fallback={...}>`. Most components in this codebase already have a `<Suspense>` fallback at a parent level (App.jsx wraps lazy routes). If the component is truly never used eagerly, the lazy wrap is a one-liner.

If Task 4 found no eager importers, **skip this step**.

- [ ] **Step 2: Add the new manualChunks rules**

Read the current `vite.config.js`:

```bash
grep -n manualChunks vite.config.js
```

The existing function returns chunk names for: `vendor-react`, `vendor-charts`, `vendor-motion`, `vendor-icons`, `vendor-ui`, `vendor-markdown`. We add 3 new chunks.

Apply this Edit to `vite.config.js`:

```js
// Before — last existing rule:
          if (/[\\/]node_modules[\\/]react-markdown[\\/]/.test(id)) return 'vendor-markdown'

// After — same line, plus new rules:
          if (/[\\/]node_modules[\\/]react-markdown[\\/]/.test(id)) return 'vendor-markdown'
          // Diff renderer: diff-match-patch (algorithm) + @git-diff-view (UI).
          // Loaded only by RepoInsightsModal/PRReviewView/DiffPanel — all lazy.
          if (/[\\/]node_modules[\\/](diff-match-patch|@git-diff-view)[\\/]/.test(id)) return 'vendor-diff'
          // Syntax highlighter pulled by @git-diff-view/shiki. Big (~150 KB raw).
          if (/[\\/]node_modules[\\/]shiki[\\/]/.test(id)) return 'vendor-shiki'
          // Sentry — small after slice A's named imports, but still worth a
          // dedicated chunk so it doesn't pollute the catch-all.
          if (/[\\/]node_modules[\\/]@sentry[\\/]/.test(id)) return 'vendor-sentry'
```

- [ ] **Step 3: Rebuild and confirm new chunks exist**

```bash
rm -rf dist
npm run build 2>&1 | tail -20
ls -la dist/assets/vendor-{diff,shiki,sentry}-*.js
```

Expected: each of the three new chunk files exists with sensible sizes (vendor-diff ~50-100 KB raw, vendor-shiki ~150 KB raw, vendor-sentry ~30-80 KB raw depending on what slice A pulled in).

If a chunk doesn't exist, the regex didn't match the install path. Inspect the actual node_modules structure:

```bash
ls node_modules | grep -E 'diff-match|@git|shiki|@sentry' | head -10
```

Adjust the regex (e.g. `@git-diff-view` may live as a scoped folder and need `@git-diff-view/` with trailing slash; in that case the existing pattern `[\\/]node_modules[\\/]@git-diff-view[\\/]` is correct).

- [ ] **Step 4: Verify `index-*.js` no longer imports `esm-*.js`**

```bash
grep -E 'esm-[^.]+\.js' dist/assets/index-*.js
```

Expected: **no output** (or only references to a small residual catch-all). If `index-*.js` still imports a big `esm-*.js`, run Task 4 step 2 again with the new build to find what's still in the catch-all and add a rule for it.

- [ ] **Step 5: Run the suite**

```bash
npx vitest run
```

Expected: 2728 passing (chunking is purely a build-time concern; runtime is unchanged).

- [ ] **Step 6: Run the build honesty test**

```bash
RUN_BUILD_TESTS=1 npx vitest run tests/build/
```

Expected: 21 passing. The honesty test runs `vite build` and greps for forbidden mock markers; chunking changes don't affect that.

- [ ] **Step 7: Manual smoke at preview**

```bash
npm run preview
```

Open the printed URL. Visit:
- Dashboard (eager) — should render charts
- A repo's RepoInsightsModal (lazy) — should load and render
- A PR's PRReview view (lazy) — should load, render diff with syntax highlight
- Settings → AI → Re-run onboarding tour — tour appears

Confirm: each lazy surface still works. Network tab should show separate chunk fetches for `vendor-diff-*.js`, `vendor-shiki-*.js`, `vendor-sentry-*.js` only when their consuming routes mount.

- [ ] **Step 8: Commit**

```bash
git add vite.config.js
git commit -m "perf(bundle): split vendor-diff/shiki/sentry into lazy chunks"
```

(If Task 5 step 1 had to move any component behind `lazy()`, include those source files in the commit too with a separate clarifying line in the commit body.)

---

### Task 6: Capture after-state metrics

**Files:** None modified. Captures the "after" snapshot for the audit doc.

- [ ] **Step 1: Final clean build with the analyzer**

```bash
rm -rf dist
npm run build:analyze 2>&1 | tee .dev/after-build.log
```

Expected: build succeeds; treemap opens.

- [ ] **Step 2: Save after-state chunk sizes**

```bash
ls -la dist/assets/*.js | sort -k5 -n -r | head -15 > .dev/after-chunks.txt
cat .dev/after-chunks.txt
```

Expected: a sorted list. Compare mentally against `.dev/baseline-chunks.txt`. Confirm:
- The big `esm-*.js` is much smaller (or split into many smaller chunks)
- `vendor-diff-*.js`, `vendor-shiki-*.js`, `vendor-sentry-*.js` exist as separate chunks
- Total bundle size is in the same ballpark (we moved bytes, not added)

- [ ] **Step 3: Compute the eager-bundle delta**

The eager bundle is whatever `index-*.js` imports + the chunks they pull in. Quick proxy: anything `index-*.js` references via `import "./..."`.

```bash
grep -oE 'from ?"\./([^"]+\.js)"' dist/assets/index-*.js | sort -u | head -20
```

The list of chunks `index-*.js` references is the eager set. Sum their gzipped sizes (the build log printed gzip kB per chunk; or use `gzip -c chunk.js | wc -c`).

```bash
# For each chunk in the eager set, compute gzipped size:
for chunk in dist/assets/index-*.js dist/assets/vendor-react-*.js dist/assets/vendor-icons-*.js dist/assets/vendor-motion-*.js dist/assets/vendor-ui-*.js; do
    size=$(gzip -c "$chunk" | wc -c)
    echo "$chunk: $size bytes gz"
done
```

Compare with the baseline. The spec's success metric is **eager JS gzipped ≤ 200 KB**.

---

### Task 7: Write the after-state audit doc

**Files:**
- Create: `docs/reports/2026-04-26-bundle-optimization-results.md`

- [ ] **Step 1: Draft the doc**

```bash
mkdir -p docs/reports
```

Create `docs/reports/2026-04-26-bundle-optimization-results.md`:

```md
# Bundle Optimization Results — 2026-04-26

Follow-up to [bundle audit](./2026-04-26-bundle-audit.md). Slices A (Sentry tree-shake) + B (esm chunk split) shipped.

## Headline

| Metric | Before | After | Δ |
|---|---|---|---|
| Eager JS gzipped | {fill in} KB | {fill in} KB | {Δ} KB |
| Largest single chunk gzipped | 332 KB (esm-*) | {fill in} | {Δ} |
| Total JS gzipped | ~750 KB | {fill in} KB | {Δ} |
| Sentry warnings (`IMPORT_IS_UNDEFINED`) | 2 | 0 | -2 |

## Slice A — Sentry tree-shake

- `main.jsx`: `import * as Sentry` → `import { init as sentryInit }`
- `observability.js`: `import * as SentryReact` → `import { getClient, addBreadcrumb }`
- Dropped the dead `getCurrentHub` legacy fallback (Sentry v10 doesn't export it)
- Build emits no more `IMPORT_IS_UNDEFINED` warnings for Sentry

## Slice B — esm chunk split

Added 3 new `manualChunks` rules in `vite.config.js`:

- **`vendor-diff`** — diff-match-patch + @git-diff-view ({size} KB gz)
- **`vendor-shiki`** — syntax highlighter ({size} KB gz)
- **`vendor-sentry`** — Sentry SDK after slice A's named imports ({size} KB gz)

The catch-all `esm-*.js` chunk shrunk from {before} KB raw / 332 KB gz to {after} KB raw / {after gz} KB gz. `index-*.js` no longer imports the heavy chunk.

## Real-world impact

- **Cold cache, slow 4G (1.5 Mbps):** {before estimate}s → {after estimate}s for first paint.
- **Cold cache, fast WiFi (10 Mbps):** {before}ms → {after}ms.
- **Lazy routes (Insights/PR Review):** unchanged latency — they now fetch `vendor-diff` + `vendor-shiki` on-demand instead of getting them "free" from the eager bundle. This is the correct trade.

## Follow-ups

- [ ] Bundle size budget in CI: assert eager-bundle gzipped stays ≤ 200 KB on every PR. Tool: `bundlesize` or a custom check using `gzip -c` and `dist/assets/index-*.js`. Effort: ~30min.
- [ ] Audit the remaining catch-all `esm-*.js` chunk. If still > 50 KB gz, drill into the treemap and add a rule for the next-biggest contributor.
- [ ] Consider lazy-loading recharts (`vendor-charts` at 108 KB gz). Currently eager via the Dashboard route. If the dashboard is the landing screen for most users, leave it; if not, lazy.

## Run to reproduce

```bash
rm -rf dist
npm run build:analyze    # treemap opens at dist/bundle-analysis.html
ls -la dist/assets/*.js  # sizes
```
```

Fill in actual numbers from `.dev/baseline-chunks.txt` and `.dev/after-chunks.txt`.

- [ ] **Step 2: Commit**

```bash
git add docs/reports/2026-04-26-bundle-optimization-results.md
git commit -m "docs(reports): bundle optimization before/after results"
```

---

### Task 8: Final push

- [ ] **Step 1: Re-run full suite + build honesty**

```bash
npx vitest run
RUN_BUILD_TESTS=1 npx vitest run tests/build/
```

Expected: 2728 + 21 passing.

- [ ] **Step 2: Push to origin/main**

```bash
git push origin main
```

- [ ] **Step 3: Verify CI**

```bash
gh run list --branch main --limit 3
```

Expected: lint + test + build jobs green; e2e job has pre-existing flakiness (same baseline as the previous slices).

---

## Self-review

**Spec coverage:**
- Spec Goal 1 (eager bundle ≤ 200 KB gz) → Task 6 step 3 measures + Task 7 reports ✅
- Spec Goal 2 (`index-*.js` no longer imports `esm-*.js`) → Task 5 step 4 verifies ✅
- Spec Goal 3 (Sentry tree-shake; no warnings) → Tasks 2 + 3 + Task 3 step 6 verifies ✅
- Spec Goal 4 (no regressions) → Tasks 5 step 5-7 verify (suite + build honesty + manual smoke) ✅
- Spec Goal 5 (treemap delta documented) → Task 7 ✅

**Type / signature consistency:**
- `sentryInit` (Task 2) is the alias used at the call site — consistent ✅
- `getClient` and `addBreadcrumb` (Task 3) are named imports referenced directly — consistent ✅
- `trackBreadcrumb` / `mark` / `measure` / `__internals.isSentryActive` public API preserved — consistent across all changes ✅
- Manual chunk names `vendor-diff` / `vendor-shiki` / `vendor-sentry` consistent across Task 5 + Task 7 ✅

**Placeholder scan:** None. The "{fill in}" template values in Task 7 are intentional measurements that depend on runtime build output. The doc structure is fully specified.

**Risk: Sentry v10 named exports might differ.** The plan assumes `init`, `getClient`, `addBreadcrumb` are stable v8+ exports — confirmed via Sentry v10 documentation. If the build fails on the named import in Task 2 step 4 or Task 3 step 5, the engineer adjusts (e.g. some setups need `init` from a sub-module). The spec's "open question 3" anticipates this.

**Risk: A "lazy-only" dep turns out to be eager-imported.** Task 4 step 4 catches this before adding manualChunks rules. If found, Task 5 step 1 is the fix path (move the import behind `lazy()`).

**Risk: New chunks create circular imports.** Rolldown logs the cycle. Fix: merge offending rules back into the catch-all. Mitigation built into Task 5 step 3 verification.
