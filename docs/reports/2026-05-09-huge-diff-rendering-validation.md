# Huge-Diff Rendering — Slice 2 Technical Validation

**Date:** 2026-05-09
**Purpose:** Validate the technical approach for rendering very large code diffs (thousands of lines) in `2026-05-09-pr-review-perf-and-polish-design.md` (Slice 2) before plan + implementation.

**TL;DR:** Hold the spec, with two refinements: (1) skip per-hunk virtualisation — the surface already renders one file at a time, the bottleneck is *one huge file*; (2) add `content-visibility: auto` containment + a Monaco-style click-to-compute affordance for >50k-line files.

---

## Q1. Per-hunk virtualisation wrapping `@git-diff-view/react`?

**Qualified no.** The library is a per-file diff renderer that owns its scroll container and renders all hunks contiguously. Its line-number gutter and context-line computation cross hunk boundaries; per-hunk virtualisation fights this contract and is undocumented. `Range Mode` (`generateInstanceFromLineNumberRange`) is the only seam exposed for paginated rendering, and it loses unified-gutter semantics.

The sibling `react-diff-view` (otakustay) is the lib designed for hunk virtualisation with a Web Worker tokenizer — but swapping libs is a large effort and not justified for slice 2.

**Critical insight:** our `CodeReviewSurface` and `PRReviewView` already render *one active file at a time*. The "many files mounted" problem the validation question implied does not exist in our architecture. The real bottleneck is one single file with thousands of changed lines.

**Confidence:** medium-high.

## Q2. Real perf numbers

- **GitHub diff view (2024 redesign)**: TanStack Virtual at the file-list level. p95 PR (~10k diff lines): heap **150–250 MB → 80–120 MB**, INP **275–700 ms → 40–80 ms**, components **183 504 → 50 004**. Pre-virtualisation extreme cases hit **>1 GB heap, >400k DOM nodes**. ([github.blog/engineering](https://github.blog/engineering/architecture-optimization/the-uphill-climb-of-making-diff-lines-performant/))
- **`react-virtualized-diff` benchmark (Apr 2026)**: 10k lines = 60.8 fps, 127 ms initial render, 9.5 MB heap; 100k lines = 104 MB.
- **`react-diff-view` README**: explicit "2.2 MB diff performs slowly but tolerably without lazy rendering" — the lib's `withTokenizeWorker` exists for a reason.

**Confidence:** high. Above ~3k lines, virtualisation OR equivalent paint-skipping is non-negotiable.

## Q3. Syntax highlighting at scale

| Highlighter   | Throughput  | Per call   | Bundle (gz)        |
|--------------|-------------|------------|--------------------|
| Prism        | 1400–2000/s | 0.5–0.7 ms | 11.7 KiB           |
| highlight.js | 700–900/s   | 1.1–1.4 ms | 15.6 KiB           |
| Shiki        | 200–280/s   | 3.5–5.0 ms | 279.8 KiB + WASM   |

(Source: chsm.dev/blog/2025/01/08/comparing-web-code-highlighters)

`@git-diff-view/react` ships `@git-diff-view/lowlight` (highlight.js engine) by default — already in the "good" bucket. Shiki adapter exists but is opt-in and 7× slower with a quarter-MB WASM bootstrap.

**Action:** keep lowlight default; force `plaintext` above 5k lines with a dismissible pill.

**Confidence:** high.

## Q4. TanStack Virtual vs react-virtuoso for variable-height rows

- TanStack Virtual works with `estimateSize` + `measureElement`, but issue [#425](https://github.com/TanStack/virtual/issues/425) and community guidance flag re-measurement storms when first estimate is far off.
- react-virtuoso auto-measures with no manual cache management; less footgun risk for diff hunks (variable height after tokenisation).
- GitHub themselves use TanStack Virtual at the *file-list* level, where heights are uniform.

**Action:** moot for this slice — we are not virtualising the diff. Keep `@tanstack/react-virtual` for `FileTree` (uniform-height, perfect fit). No new dep.

**Confidence:** moot.

## Q5. `content-visibility: auto`

- Nolan Lawson's testing: ~15% paint gain in Chrome alone, ~5% in Firefox; combined with image lazy-load, ~40–45%. Explicit caveat: *"rendering 20k DOM nodes is just never going to be as fast as a virtualized list."*
- Safari support: 18.0 (Sept 2024). iOS 17 users get nothing — graceful no-op.
- Use as **secondary** optimisation inside any contiguous render — perfect fit on each hunk wrapper inside the lib's output.

**Action:** add a CSS rule under `@supports (content-visibility: auto)` targeting `.diff-renderer .diff-hunk` (the lib's own class). Zero JS cost, ~10–15% paint savings, no regression risk.

**Confidence:** high.

## Q6. Mobile memory

iOS Safari kills tabs at 1.0–1.5 GB resident; safe target is <400 MB. Pre-virtualisation GitHub regularly crossed 1 GB on big PRs and crashed Safari. With the layered approach (fold-by-default + content-visibility + tiered highlight + click-to-compute) we keep a comfortable 4–5× margin.

**Action:** treat the >500-line fold default as a *mobile correctness* rule, not just UX.

**Confidence:** high.

## Q7. Beautiful huge-diff UIs to borrow from

- **VS Code / Monaco diff editor**: viewport-bounded compute, `maxFileSize` config, "this diff was too big — click to compute" affordance. The pattern, not the embed (Monaco is too heavy).
- **`react-virtualized-diff`** (Zhang-JiahangH, MIT): modern, Tailwind-friendly, ships actual benchmarks. Reference reading.
- **`react-diff-viewer-continued`** (Aeolun): nice baseline visual polish, no virtualisation.
- **`@git-diff-view/react` demo site**: already our chosen visual target.

**Action:** copy Monaco's click-to-compute affordance for files >50,000 lines.

**Confidence:** high.

---

## Revised Slice 2 strategy (applied to the spec)

1. **Fold-by-default above 500 changed lines** (was already in spec; now the central pillar instead of a complement to virtualisation).
2. **CSS containment on each hunk wrapper** via `content-visibility: auto` + `contain-intrinsic-size: auto 24px` under `@supports`. New addition.
3. **Tiered syntax highlighting**: lowlight default, plaintext >5k lines (already in spec).
4. **Click-to-compute placeholder above 50,000 changed lines.** New addition (Monaco pattern).
5. **`useDeferredValue` on tab expansion** (already in spec).
6. **Sticky / floating composer** (already in spec).
7. **No virtualisation library swap.** No new top-level deps. The `@tanstack/react-virtual` use stays in `FileTree` only.

**Confidence in revised approach: high.** Mirrors GitHub's production architecture (file-level granularity) and combines layers each backed by published numbers. If a real-world test shows a single 30k-line file still chokes after layers 1–4, follow-up spec investigates `react-diff-view` with a Web Worker tokenizer.

## Sources

- [The uphill climb of making diff lines performant — GitHub Blog](https://github.blog/engineering/architecture-optimization/the-uphill-climb-of-making-diff-lines-performant/)
- [Comparing web code highlighters — chsm.dev](https://chsm.dev/blog/2025/01/08/comparing-web-code-highlighters)
- [Improving rendering performance with CSS content-visibility — Nolan Lawson](https://nolanlawson.com/2024/09/18/improving-rendering-performance-with-css-content-visibility/)
- [HN: Rendering large code diffs in the browser without freezing the UI](https://news.ycombinator.com/item?id=47700529)
- [git-diff-view (MrWangJustToDo) GitHub](https://github.com/MrWangJustToDo/git-diff-view)
- [react-diff-view (otakustay) GitHub](https://github.com/otakustay/react-diff-view)
- [react-virtualized-diff GitHub](https://github.com/Zhang-JiahangH/react-virtualized-diff)
- [TanStack Virtual issue #425 — measurement cache](https://github.com/TanStack/virtual/issues/425)
- [Monaco diff editor performance issue #4834](https://github.com/microsoft/monaco-editor/issues/4834)
- [content-visibility caniuse](https://caniuse.com/css-content-visibility)
