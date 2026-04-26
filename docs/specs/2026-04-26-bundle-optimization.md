# Bundle Optimization — esm Chunk Split + Sentry Tree-Shake

**Date:** 2026-04-26
**Status:** Draft
**Slice:** Follow-up #1 from [slice 4.1 bundle audit](../reports/2026-04-26-bundle-audit.md). Optional polish on top of the closed 4-slice "tudo lindo" roadmap.

---

## Problem

The 2026-04-26 bundle audit identified `esm-BIqlBYah.js` as the dominant chunk at **332 KB gzipped (1.04 MB raw)** — by itself larger than every other chunk on first load. Confirmed in this spec's investigation:

1. **It's eager.** `dist/assets/index-BiA-ly1g.js` imports `esm-BIqlBYah.js`. The 332 KB gz lands on the first paint, regardless of which route the user visits.

2. **Its contents are heavy.** A peek at the chunk preview shows `diff-match-patch` (the diff algorithm used by `@git-diff-view`), code from `vendor-charts`, and code from `vendor-markdown`. These are libraries used by **lazy** routes (RepoInsightsModal, PRReviewView, DiffPanel, ReadmeEnhanceDiffPanel) — they should not be in the eager bundle.

3. **Sentry contributes too.** `main.jsx` and `lib/observability.js` both use `import * as Sentry from '@sentry/react'` (namespace imports). Vite/Rollup can't tree-shake the unused exports out of `@sentry/react ^10.49.0`. The build emits `IMPORT_IS_UNDEFINED` warnings for `getCurrentHub` (Sentry v10 dropped that API) — the legacy fallback in `observability.js` is dead code that ships anyway because of namespace imports.

Real-world impact: on slow 4G (1.5 Mbps), the eager bundle download is dominated by these 332 KB. Two seconds of the cold-cache load. On WiFi the user notices less — but the cold-cache cost compounds across all the surfaces the user might never visit.

## Goals

1. **Eager bundle ≤ 200 KB gzipped JS.** Currently approximately 750 KB gzipped JS across all chunks; the eager subset is ~480 KB (index + vendor-react + esm-* + critical CSS). Target: drop to ≤ 200 KB JS by moving diff-match-patch + chart/markdown deps to lazy chunks.
2. **`esm-BIqlBYah.js` no longer imported by `index-*.js`.** Verified by post-build `grep` against `dist/assets/index-*.js` — no reference to the heavy esm chunk in the eager entry.
3. **Sentry tree-shaking working.** The `IMPORT_IS_UNDEFINED` warnings for `getCurrentHub` disappear. The Sentry contribution to the eager bundle drops from "whatever the namespace pulls" to only the API surface actually used (`init`, `getClient`, `addBreadcrumb`, optional event handlers).
4. **No regressions.** All 2728 unit tests pass. Build honesty test passes. Manual smoke shows Sentry breadcrumbs still fire when configured (`VITE_SENTRY_DSN` set in `.env.local`).
5. **Treemap delta documented.** Append-only addendum to `docs/reports/2026-04-26-bundle-audit.md` (or fresh `docs/reports/2026-04-26-bundle-optimization-results.md`) showing **before / after** numbers per chunk.

## Non-goals

- **No dependency swaps.** Recharts stays. `@git-diff-view` stays. `react-markdown` stays. The optimization is purely chunking + tree-shaking.
- **No code-splitting refactor of routes.** The lazy routes are already lazy via `React.lazy()`. We don't break them apart further.
- **No Sentry version downgrade or replacement.** v10 stays; we just import correctly.
- **No CSS reduction.** That was slice 4.3.
- **No changes to `vendor-react`, `vendor-motion`, `vendor-ui`, `vendor-icons`** chunks. Those are well-sized and intentional.
- **No new dependencies.** Configuration-only.

---

## Solution overview

Two parallel slices, ~1.5h total. Each independently shippable.

| Slice | Theme | Effort |
|---|---|---|
| **Sentry tree-shake** | Convert namespace imports to named, drop dead `getCurrentHub` fallback | ~30min |
| **esm chunk split** | Add `manualChunks` rules to split diff-match-patch + lazy-only deps into their own chunks; verify they're not eager | ~1h |

---

## Slice A — Sentry tree-shake

### Current state

`src/main.jsx`:
```js
import * as Sentry from '@sentry/react'
// ...
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({ dsn: ..., environment: ..., tracesSampleRate: ... })
}
```

`src/lib/observability.js`:
```js
import * as SentryReact from '@sentry/react'

function isSentryActive() {
  if (typeof SentryReact.getClient === 'function') return Boolean(SentryReact.getClient())
  if (typeof SentryReact.getCurrentHub === 'function') return Boolean(SentryReact.getCurrentHub()?.getClient())
  // ...
}
// (Plus addBreadcrumb wrapper + mark/measure wrappers)
```

### Changes

**`src/main.jsx`** — convert to named imports:

```js
import { init as sentryInit } from '@sentry/react'
// ...
if (import.meta.env.VITE_SENTRY_DSN) {
  sentryInit({ dsn: ..., environment: ..., tracesSampleRate: ... })
}
```

**`src/lib/observability.js`** — convert + drop dead fallback:

```js
import { getClient, addBreadcrumb as sentryAddBreadcrumb } from '@sentry/react'

function isSentryActive() {
  try {
    return Boolean(getClient())
  } catch {
    return false
  }
}

// trackBreadcrumb implementation calls sentryAddBreadcrumb directly when active.
```

Removing the `getCurrentHub` fallback eliminates the `IMPORT_IS_UNDEFINED` warning.

If observability.js uses any other Sentry exports (e.g. `captureException`, `setUser`), import each by name. The set is small and well-defined.

### Verification

- `npm run build` shows no `IMPORT_IS_UNDEFINED` warning re Sentry.
- `dist/assets/index-*.js` contains the small set of Sentry symbols actually used; the bundle visualizer treemap shows `@sentry/react` shrunk vs the previous run.
- Manual smoke: with `VITE_SENTRY_DSN` set, trigger an error → check Sentry dashboard for the captured event + breadcrumb trail.

### Tests

Existing unit tests (none specifically test Sentry in browser code). The implementation keeps the public API of `observability.js` (`trackBreadcrumb`, `mark`, `measure`) byte-identical — internal refactor only.

---

## Slice B — `esm-*.js` chunk split

### Current state

`vite.config.js` already has `manualChunks` rules for: vendor-react, vendor-charts, vendor-motion, vendor-icons, vendor-ui, vendor-markdown. Everything else lands in the catch-all `esm-*.js` chunk. The issue: `index-*.js` imports `esm-*.js`, meaning some module on the eager path transitively pulls from the catch-all.

### Investigation step (Task 0 of the plan)

Before changing config, identify what *specifically* is in the eager catch-all:

```bash
# Run the analyzer; inspect dist/bundle-analysis.html.
npm run build:analyze
```

The treemap drill-down on `esm-*.js` reveals every module path inside. Engineer notes the top 5-10 contributors by gzipped size. Likely suspects:
- `diff-match-patch` (used by @git-diff-view; pulled by RepoInsightsModal/DiffPanel)
- `octokit` / `@octokit/*` (if frontend uses it directly; otherwise server-only)
- `swr` (if used)
- `jose` / `zod` (if used in eager paths)

### Changes

**`vite.config.js`** — extend `manualChunks` to push the heavy lazy-only deps into their own chunks:

```js
manualChunks(id) {
  if (!id.includes('node_modules')) return
  if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react'
  if (/[\\/]node_modules[\\/]recharts[\\/]/.test(id)) return 'vendor-charts'
  if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'vendor-motion'
  if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'vendor-icons'
  if (/[\\/]node_modules[\\/]@radix-ui[\\/]/.test(id)) return 'vendor-ui'
  if (/[\\/]node_modules[\\/]react-markdown[\\/]/.test(id)) return 'vendor-markdown'

  // ↓ NEW chunks (slice-B additions)
  // diff-match-patch is large (~80 KB raw) and used only by lazy diff routes.
  // Pulling it into its own chunk lets it stay lazy regardless of how
  // surrounding deps are split.
  if (/[\\/]node_modules[\\/]diff-match-patch[\\/]/.test(id)) return 'vendor-diff'

  // @git-diff-view / shiki (the diff renderer + syntax highlighter) are
  // also lazy-only.
  if (/[\\/]node_modules[\\/]@git-diff-view[\\/]/.test(id)) return 'vendor-diff'
  if (/[\\/]node_modules[\\/]shiki[\\/]/.test(id)) return 'vendor-shiki'

  // Sentry — even after named imports, the bundle still includes the
  // tracer + transport. Splitting the chunk lets the eager loader
  // skip it when VITE_SENTRY_DSN isn't configured (lazy init in
  // main.jsx already short-circuits, but the chunk still ships;
  // splitting at least prevents it from polluting the catch-all).
  if (/[\\/]node_modules[\\/]@sentry[\\/]/.test(id)) return 'vendor-sentry'
}
```

The exact list of NEW chunk rules depends on what the treemap reveals. The plan's Task 1 measures *before*; Task 2 adds rules; Task 3 measures *after* and verifies `index-*.js` no longer imports any heavy chunk.

If a NEW chunk turns out to be eager-imported anyway (because something on the App.jsx tree imports it directly), the fix is at the import site — make the consumer route lazy. Default assumption: all four candidates above (diff-match-patch, @git-diff-view, shiki, @sentry) are lazy-only.

### Verification

```bash
# After build, the catch-all esm chunk should be much smaller.
ls -la dist/assets/esm-*.js

# index-*.js should NOT import esm-* (or only the small esm-CbUOaL0T-style residue).
grep -E 'esm-[^.]+\.js' dist/assets/index-*.js
```

Expected: `index-*.js` references vendor-react, vendor-icons, vendor-motion, vendor-ui, and possibly the small residual catch-all. It does NOT reference vendor-diff, vendor-shiki, vendor-sentry — those are lazy.

### Tests

- `npx vitest run` — 2728 still pass
- `RUN_BUILD_TESTS=1 npx vitest run tests/build/` — 21 pass; the build honesty test continues to verify no mock data leaks
- Manual smoke at `npm run preview`: open Dashboard, RepoList, Settings, RepoDetail Overview, RepoInsightsModal (lazy), PRReviewView (lazy). Verify each loads and renders. Pay special attention to the lazy diff/markdown surfaces — those load their dedicated vendor chunks on-demand.

---

## Architecture — shared concerns

### Reproducible measurements

Every change is followed by `npm run build:analyze`. The treemap is the source of truth, not eyeballed numbers. Before / after comparison happens in the audit doc addendum.

### Failure modes

| Scenario | Handling |
|---|---|
| Sentry named import breaks runtime | The `@sentry/react` v10 SDK exports `init`, `getClient`, `addBreadcrumb` as named exports — verified in their docs. If wrong, the build fails fast. |
| New `manualChunks` rule causes circular chunk imports | Rollup logs the cycle. Fix: merge the two chunks back into one (the catch-all). |
| A "lazy-only" dep turns out to be eager-imported by something | Bundle visualizer treemap shows it lives in the eager bundle. Fix: trace the import chain (rollup `--logLevel info`) and either lazy-load the offender or accept the chunk in the eager set. |
| `esm-*.js` shrinks but `index-*.js` grows by similar amount | The deps moved INTO the eager bundle instead of staying lazy. Fix: investigate which import pulls them; usually a static import that should be `import()`. |

### Non-architecture: kept identical

- The component lazy boundaries (every `lazy(() => import(...))` site) are unchanged.
- `vite.config.js` `build.rollupOptions.output.manualChunks` keeps its function-form signature.
- `package.json` is unchanged.

---

## Testing strategy

- **Unit:** `npx vitest run` after each commit.
- **Build:** `npm run build` and `RUN_BUILD_TESTS=1 npx vitest run tests/build/` after each commit.
- **Manual:** Open `npm run preview`, navigate to:
  - Dashboard (eager) — verify charts render
  - RepoList → RepoCard click → RepoDetail (lazy) — verify
  - PR Review (lazy) — verify diff renders, syntax highlight applied
  - RepoInsightsModal (lazy) — verify
  - Settings → AI Configuration → click "Re-run onboarding tour" — verify
  - In all of the above with VITE_SENTRY_DSN set, check breadcrumbs fire (browser network tab → sentry.io request)

## Shipping order

1. **Slice A (Sentry tree-shake)** first — minimal, low-risk, eliminates a build warning, gives a small measurable bundle delta.
2. **Slice B (esm chunk split)** — bigger payload of the slice. Investigate first (Task 0), then add config rules (Task 1), then measure (Task 2).

Each slice: commit + push + suite green.

## Success metrics

- **Sentry warnings gone.** `npm run build` output contains no `IMPORT_IS_UNDEFINED` for any `@sentry/*`.
- **Eager `index-*.js` no longer imports `esm-*.js`** (the 332 KB gz catch-all). Verifiable by `grep`.
- **`vendor-diff` (or whatever name we use) chunk created**, sized 60-100 KB gz, lazy-loaded only when DiffPanel / ReadmeEnhanceDiffPanel mount.
- **Eager bundle JS gzipped ≤ 200 KB** (currently ~480 KB).
- **No regressions** — all suites green; manual smoke confirms each surface.

---

## Open questions

1. **Does `react-markdown` actually live in `vendor-markdown` or in the catch-all?** The existing `manualChunks` rule routes it but the treemap may show a residue. Resolved at plan-time by inspecting the visualizer.
2. **Is `@git-diff-view` already lazy?** It's imported by 4 components, all lazy routes. Static analysis of the importers confirms; if any eager file imports it, fix that first.
3. **Should Sentry get its own chunk even if used eagerly?** With named imports the size drops to ~10-15 KB gz; arguably not worth a chunk. Resolved at plan-time after measurement.
