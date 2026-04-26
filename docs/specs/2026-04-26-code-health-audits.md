# Code Health Audits — Bundle, Coverage, ds-* Cleanup

**Date:** 2026-04-26
**Status:** Draft
**Slice:** #4 (final) of the "tudo lindo, sem vaporware, premium" pass.
**Predecessors:** [Slice #1 vaporware](./2026-04-26-vaporware-and-honesty-audit.md), [Slice #2 premium AI](./2026-04-26-premium-ai-wiring.md), [Slice #3 UX uniformity](./2026-04-26-ux-uniformity-and-onboarding.md). All closed.

---

## Problem

Three forms of code-health debt have accumulated and are hard to see without dedicated audits:

1. **Bundle size is opaque.** `package.json` already lists `rollup-plugin-visualizer ^7.0.1` as a devDep but the plugin isn't wired into `vite.config.js`. Without the treemap we can't tell which dependency dominates the production bundle. Slice 1's build-honesty test made `dist/` clean of mock data; this slice makes it *measurable* of dependency cost.

2. **Test coverage is unmeasured.** `vitest.config.js` has the v8 coverage provider configured with thresholds (lines/functions/branches/statements all 80%), but no recent run has verified the actual numbers. The threshold may be aspirational or actually-met; we don't know.

3. **`ds-*` design system has potential dead classes.** `src/design-system.css` defines **53 `.ds-*` classes** in 485 lines. The 2026-04-11 product-honesty pass identified 7 classes with zero usages at the time. Some were activated in subsequent sweeps, but no fresh enumeration has been done. Dead CSS is shipping bytes for nothing.

Two larger items from the original brief (the `set-state-in-effect` disables and the `text-slate-500 dark:text-slate-400` deduplication) are explicit non-goals here — see below.

## Goals

1. **Bundle treemap published.** `vite.config.js` enables `rollup-plugin-visualizer` so every `npm run build` writes a treemap to `dist/stats.html`. A short doc at `docs/reports/2026-04-26-bundle-audit.md` records the headline numbers (total gzipped size, top 5 largest dependencies, any chunk > 500 KB).
2. **Coverage report published.** A short doc at `docs/reports/2026-04-26-coverage-audit.md` lists files / directories below 60% line coverage, prioritised by user-facing impact, as a hit-list for follow-up tests. The current 80% threshold in `vitest.config.js` is verified or relaxed honestly to match reality.
3. **`ds-*` orphan classes removed.** Each class in `src/design-system.css` is checked against the codebase. Classes with zero usages outside their own definition get removed. The remaining set is documented inline in the CSS file's header comment.
4. **Zero new build/runtime regressions.** All existing tests + the build honesty test stay green. The visualizer plugin must not affect production bundle output (it writes a sidecar HTML; no bundle change).

## Non-goals

- **No `set-state-in-effect` refactor.** 22 files have the disable comment; refactoring each requires careful data-flow analysis. Defer to a dedicated slice.
- **No `text-slate-500 dark:text-slate-400` deduplication.** 353 occurrences. Either keep Tailwind direct (current pattern, fast to read) or extract a `ds-text-muted` (one find/replace round, reduces visual noise). Both are valid; the choice is architectural and warrants its own RFC, not an inline decision in a code-health audit.
- **No new test writing.** The coverage doc identifies gaps; the actual test-writing is each gap's own slice.
- **No removal of CSS classes that have legitimate but rare usages.** The grep must show zero matches outside the definition file before removal. False-positive removal is worse than orphan retention.
- **No new dependencies.** `rollup-plugin-visualizer` is already in package.json.

---

## Solution overview

Three independent slices, each ~30-40min, ~2h total.

| Slice | Scope | Effort |
|---|---|---|
| **4.1** | Bundle treemap (visualizer plugin + audit doc) | ~30min |
| **4.2** | Coverage report + hit-list doc | ~30min |
| **4.3** | `ds-*` orphan audit + cleanup | ~45min |

---

## Slice 4.1 — Bundle treemap

### Plugin wiring

In `vite.config.js`, add `rollup-plugin-visualizer` to the `plugins` array. The plugin should:

- Run on every `vite build` (not on `vite dev`)
- Emit `dist/stats.html` (default name)
- Use `gzipSize: true` and `brotliSize: false` (gzip matches what's served; brotli is rarely served by static hosts and doubles compute time)
- Use `template: 'treemap'` (clearest single-glance view)
- `open: false` (don't auto-launch a browser; we publish the artifact)

The plugin is conditional on `command === 'build'` so dev startup is untouched.

### Audit doc

Create `docs/reports/2026-04-26-bundle-audit.md`:

- Total gzipped bundle size (single number)
- Top 5 largest chunks (by gzipped size)
- Top 5 largest individual node_modules dependencies (the visualizer surfaces these)
- Any chunk > 500 KB gzipped (Vite's default warning threshold) with mitigation note
- 2-3 sentence "what this looks like for the user" — slow networks (3G), cold cache scenarios

The doc is the deliverable. Optimization decisions (drop a dep, code-split a route, lazy-load a chunk) are explicitly NOT in this slice; they're follow-up tickets.

### Files

- Modify: `vite.config.js`
- Create: `docs/reports/2026-04-26-bundle-audit.md`
- Update: `.gitignore` (if `dist/stats.html` shouldn't ship)

### Tests

The slice has no new test logic. Existing `build-honesty.test.js` runs `vite build` and would catch a build break. Verifier: `RUN_BUILD_TESTS=1 npx vitest run tests/build/` stays green AND `dist/stats.html` exists after the build.

---

## Slice 4.2 — Coverage report

### Procedure

```bash
# Run with coverage. The v8 provider is already configured.
# Drop the lines/functions/branches/statements thresholds for this run
# so the report generates instead of failing on a 79% number.
npx vitest run --coverage
```

The default coverage config in `vitest.config.js` has `lines/functions/branches/statements: 80` thresholds. Running `--coverage` either:
- **Passes** — current coverage meets 80% across the board. Doc that.
- **Fails** — actual coverage is below threshold somewhere. Doc the gap and decide:
  - **(a)** Lower the threshold to a number that reflects current reality, with a `// TODO: raise to 80% after follow-up tests in <area>` comment.
  - **(b)** Accept the failure and write the missing tests as a follow-up.

The slice picks **(a)** — pragmatic relaxation. Writing tests is a separate scope.

### Audit doc

Create `docs/reports/2026-04-26-coverage-audit.md`:

- Headline numbers (lines / functions / branches / statements percentages)
- Files / directories under 60% line coverage, sorted by impact (auth + payment + AI surfaces > internal helpers)
- Top 3 follow-up suggestions: which test gaps would move the headline number most cheaply
- Threshold change rationale (if any)

### Files

- Run: `npx vitest run --coverage` (writes to `coverage/` — gitignored)
- Modify: `vitest.config.js` (threshold relaxation if needed)
- Create: `docs/reports/2026-04-26-coverage-audit.md`

### Tests

Same as before — the suite must stay green. `vitest run --coverage` is the verification command.

---

## Slice 4.3 — `ds-*` orphan audit + cleanup

### Procedure

For each class name `.ds-XXX` defined in `src/design-system.css`:

1. `grep -rn "\bds-XXX\b" src/ docs/ --include='*.{jsx,js,css,md}' | grep -v 'design-system.css'`
2. If zero matches: class is orphan, remove its definition (and any related `:root` custom properties used only by it).
3. If matches: leave it alone.

The grep is conservative — `\b` boundary prevents false matches on substrings like `ds-card-shimmer-2`.

A small Node.js script makes this mechanical:

```js
// .dev/audit-ds-classes.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const css = readFileSync('src/design-system.css', 'utf8')
const classes = [...new Set([...css.matchAll(/^\.(ds-[\w-]+)/gm)].map(m => m[1]))]
const orphans = []
for (const cls of classes) {
    const out = execSync(`grep -rn --include="*.jsx" --include="*.js" --include="*.css" --include="*.md" "\\b${cls}\\b" src/ docs/ 2>/dev/null`, { encoding: 'utf8' })
    const lines = out.split('\n').filter(l => l && !l.includes('design-system.css'))
    if (lines.length === 0) orphans.push(cls)
}
console.log('Orphans:', orphans)
```

The script outputs the orphan list. The engineer manually confirms each (sometimes a class is defined as a CSS-only animation referenced by another `ds-*` rule via `animation-name`; those aren't orphans even if no JSX uses them directly), then deletes the orphan definitions.

### Files

- Create (gitignored): `.dev/audit-ds-classes.mjs`
- Modify: `src/design-system.css` (remove orphan blocks)
- Update the file's header comment with a one-line "Last orphan audit: 2026-04-26"

### Tests

After cleanup, run:

- `npx vitest run` — all tests still pass (no JSX broken)
- `npm run build` — bundle still builds
- Manual visual smoke on Dashboard, Settings, RepoList, RepoDetail, WorkBoard at desktop + mobile + dark — no missing visual treatments

---

## Architecture — shared concerns

### Doc format

All three audit docs follow a consistent shape:

```md
# {Audit Name} — {Date}

## Headline

{One sentence summary number / status}

## Findings

- {Bullet 1}
- {Bullet 2}

## Follow-ups

- [ ] {Follow-up suggestion 1, with effort estimate}
```

Keeps `docs/reports/` browsable.

### Failure modes

| Scenario | Handling |
|---|---|
| Visualizer plugin breaks build | Plugin is wrapped in a try/catch around the array entry — but Vite plugins are configured statically so a broken plugin causes immediate startup failure that's easy to spot. Verify in CI before pushing. |
| Coverage run takes > 5 min | Acceptable as one-off; not in default suite. Doc says "run when investigating coverage". |
| `ds-*` orphan removed but actually referenced via dynamic className | Manual smoke catches it. The risk is low because `ds-*` classes don't get string-concatenated dynamically in this codebase (we'd see `clsx('ds-' + foo)` patterns; those aren't there). |

---

## Testing strategy

- Bundle: build runs to completion, `dist/stats.html` exists after.
- Coverage: `vitest run --coverage` exits 0 (or with a relaxed threshold).
- ds-* cleanup: `vitest run` and `npm run build` both pass; manual smoke on key surfaces.

## Shipping order

1. **Slice 4.1** — bundle. Lowest risk, gives data for the others.
2. **Slice 4.2** — coverage. Independent of 4.1, lower risk than 4.3.
3. **Slice 4.3** — `ds-*` cleanup. Modifies CSS; do last so the manual smoke happens against a known-good baseline.

Each slice: commit (Conventional Commits, no Co-Authored-By, ≤72 chars subject) + push to origin/main + suite green.

## Success metrics

- **One** new line in `vite.config.js` enabling visualizer.
- **One** `dist/stats.html` artifact produced by `npm run build`.
- **Three** new audit docs in `docs/reports/`.
- **N** orphan `ds-*` classes removed (N reported in the cleanup commit message).
- **No regression** — `npx vitest run` stays at 2728+ passing; `RUN_BUILD_TESTS=1 npx vitest run tests/build/` stays at 21+ passing.

---

## Open questions

1. **`dist/stats.html` in `.gitignore` or committed?** Default: gitignored (it's a build artifact). If we want PR review to inspect it, we publish via the deploy step instead. Resolved at plan-time: gitignored.
2. **Coverage threshold pragmatic floor.** If actual coverage is, say, 67% lines, set the threshold to 65% (current - 2%) so we don't ratchet down silently in a future PR. Resolved at plan-time once we have the number.
3. **Are any `ds-*` classes referenced by other `ds-*` classes via `@apply` or `animation-name`?** Cross-reference within `design-system.css` itself; the audit script ignores that file, so internal CSS-to-CSS references survive. Confirm during cleanup.

These resolve during the implementation plan.
