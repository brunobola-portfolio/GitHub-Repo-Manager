# Bundle Optimization Results — 2026-04-26

Follow-up to [bundle audit](./2026-04-26-bundle-audit.md). **Partial delivery:** Slice A (Sentry tree-shake) shipped; Slice B (esm chunk split) re-scoped after investigation revealed the original premise was incorrect.

## Slice A — Sentry tree-shake ✅ shipped

### Changes

- **`src/main.jsx`** — `import * as Sentry` → `import { init as sentryInit, captureException as sentryCaptureException }`
- **`src/lib/observability.js`** — `import * as SentryReact` → `import { getClient, addBreadcrumb }`. Dropped the dead `getCurrentHub` legacy fallback (Sentry v10+ doesn't export it).
- Commit: `9883bc7`

### Measured impact

| | Before | After | Δ |
|---|---|---|---|
| `IMPORT_IS_UNDEFINED` build warnings | 2 (re `getCurrentHub`) | 0 | -2 |
| `index-*.js` raw size | 236.45 KB | 236.45 KB | 0 |
| `index-*.js` gzipped (computed) | ~59 KB | ~59 KB | 0 |
| `esm-fy0i7DMo.js` (lazy) | 1044 KB / 332 KB gz | 1044 KB / 332 KB gz | 0 |

The byte-for-byte size is unchanged because `@sentry/react` v10's ES module structure already supports tree-shaking even through `import * as` when consumed properties are statically known. The real wins are: **build is now clean** (no false-positive warnings to drown out real ones), and **observability.js is simpler** (one branch instead of two; one early-return instead of two type-of guards).

### Tests

- `npx vitest run` → 2728 passing
- `npm run build` → exit 0, no Sentry warnings

## Slice B — `esm-*.js` chunk split ⚠️ pivoted (not shipped)

### What the slice 4.1 audit said

> `esm-BIqlBYah.js` at 332 KB gzipped (1.04 MB raw) — exceeds Vite's 500 KB raw warning threshold. Eager: imported by `index-*.js`.

### What this slice's investigation found

A fresh build (`rm -rf dist && npm run build`) shows the big `esm-fy0i7DMo.js` (the slice 4.1 chunk renamed across rebuilds) is **lazy**, imported by:

- `dist/assets/DiffRenderer-*.js`
- `dist/assets/PRReviewView-*.js`
- `dist/assets/ReadmeEnhanceDiffPanel-*.js`
- `dist/assets/RepoInsightsModal-*.js`

**`index-*.js` does NOT import the big esm chunk.** The slice 4.1 audit was incorrect: it likely caught a transient build state, or misread the import graph. The 332 KB gz cost is paid only when the user opens RepoInsights / PR Review / Diff surfaces — exactly as intended.

### The real eager bundle composition

After fresh build, `index-*.js` imports:

| Chunk | Raw | Gzipped (estimated) | Justification |
|---|---|---|---|
| `index-*.js` itself | 236 KB | ~59 KB | App shell, eager components |
| `vendor-react` | 178 KB | ~56 KB | React core; mandatory |
| `vendor-charts` | **371 KB** | **~108 KB** | **Surprising — see below** |
| `vendor-motion` | 128 KB | ~42 KB | framer-motion; widely used |
| `vendor-markdown` | 115 KB | ~35 KB | react-markdown; appears eager too |
| `vendor-ui` | 84 KB | ~27 KB | Radix UI primitives |
| `vendor-icons` | 38 KB | ~12 KB | Lucide icons |
| `esm-iaml*.js` (small) | 16 KB | ~5 KB | Small residual catch-all |

Total eager gzipped: **~344 KB JS**.

### The vendor-charts mystery

`vendor-charts` is imported eagerly by `index-*.js` as:

```js
import { m as t, p as n } from "./vendor-charts-BHlLCwqU.js"
```

— two short-aliased exports. Yet the only files importing from `recharts` are `Dashboard/ActivityChart.jsx` and `Dashboard/LanguageChart.jsx`, both consumed by `DashboardPremium.jsx`, which is **lazy** (`lazy(() => import('./components/Dashboard/DashboardPremium')...)`).

The `m` and `p` exports map to `i` and `o` internally — minified utility re-exports. Best guess: they're transitive d3 utilities that another vendor chunk (recharts has shared deps with framer-motion's animation utils, possibly d3-shape/d3-interpolate) reuses. Rolldown's chunking algorithm picked vendor-charts as the canonical home for them, and `index-*.js` references them through a different code path.

### Why this slice did not ship

Diagnosing the chunking heuristic to relocate two aliased utility exports out of `vendor-charts` requires either:
- Reading rolldown's internal chunking decisions (no documentation; would need to bisect by tweaking config and observing output), or
- Forcing a different chunk grouping by adding a more specific `manualChunks` rule that the catch-all behavior doesn't override (uncertain the result without iteration).

Both are exploratory rather than deterministic, and the user benefit (potentially saving ~108 KB gz on cold-cache first paint) is real but not guaranteed without trial-and-error.

## Follow-ups

- [ ] **High priority** — Profile the `m` and `p` symbols imported from vendor-charts. If they're large (> 5 KB raw), pursue a `manualChunks` rule that pulls them into a separate chunk. If they're tiny (< 1 KB), the gzipped impact of the whole vendor-charts chunk being preloaded is real but unfixable without removing the recharts dep itself. Effort: ~2-3h investigation.
- [ ] **High priority** — Run a **fresh** bundle analysis with `npm run build:analyze` and re-assert: which chunks does `index-*.js` actually import? Update the [bundle-audit.md](./2026-04-26-bundle-audit.md) to correct the slice-4.1 assertion that the big `esm-*.js` is eager. **It is not.**
- [ ] **Medium** — Consider lazy-loading recharts entirely. If the only consumers are Dashboard charts, replacing them with a lighter library (e.g. `react-sparkline` for sparkline-only views, or `victory-vendor` for lighter charting) saves ~100 KB gz on every cold visit. Effort: ~3h.
- [ ] **Medium** — Add a **bundle size budget** to CI. Use a small custom check: `gzip -c dist/assets/index-*.js | wc -c` and assert ≤ 65000 bytes. Same for the eager-chunk total. Prevents future regressions. Effort: ~30min.
- [ ] **Low** — `vendor-markdown` (35 KB gz) eagerly loads even though `react-markdown` is only used in lazy modals. Same root cause as vendor-charts (transitive util reuse?). Worth investigating once the vendor-charts question resolves.

## Honest summary

This slice's premise — **"the eager bundle has a 332 KB gz catch-all chunk we can split"** — turned out to be wrong. The big `esm-*.js` IS lazy. The real eager bundle is ~344 KB gz, composed mostly of legitimate vendor chunks (react, motion, ui, icons) plus the surprise of vendor-charts and vendor-markdown being eagerly imported despite their consumers being lazy.

Slice A (Sentry tree-shake) was a clean win that shipped. Slice B's premise needed new investigation, and the deeper finding (chunking heuristics put recharts/markdown utilities into the eager path) is real but exploratory — not a one-commit fix.

The audit doc from slice 4.1 should be amended to reflect the corrected eager-bundle picture.
