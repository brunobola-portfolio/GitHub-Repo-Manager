# Repo Detail Premium Pass — Overview / Branches / Commits / PR Diff Parity

**Date:** 2026-05-09
**Status:** Spec — awaiting user review before implementation plan
**Owner:** Bruno
**Related:** `2026-05-03-pr-review-premium.md`, `2026-05-02-resilient-pr-issue-commit.md`

## Problem

The Repo Detail surface has four uneven slices:

1. **Overview tab** renders the README as raw markdown text inside `<pre>`
   ([OverviewTab.jsx:107-109](../../src/components/RepoDetail/OverviewTab.jsx)).
   Tables, headings, fenced code, and `<div align="center">` banners all
   show as escaped source. The repo has `react-markdown` + `remark-gfm`
   + `rehype-sanitize` + Shiki installed, so this is purely an integration
   gap.
2. **Branches tab** has a real bug and a layout smell.
   - The `formatUserError` middleware logs `unmapped error: Upgrade to
     GitHub Pro` to the console twice on every load of a private repo on
     a free plan (visible in DevTools as `installHook.js:1`). The error
     is *expected* (`code: 'GITHUB_PRO_REQUIRED'`) and the
     `BranchProtectionPanel` already handles it — the global hook just
     doesn't know that.
   - The protection panel renders a large upgrade-required card ABOVE
     the branch list, which itself contains "1 Branch" + a header. On
     a private free-plan repo with a single branch this is 80% chrome,
     20% data.
3. **Commits tab** opens a `CommitDetailPanel` modal that renders patches
   as a bare `<pre>` ([CommitDetailPanel.jsx:118-122](../../src/components/RepoDetail/CommitDetailPanel.jsx)).
   No syntax highlighting, no split/unified, no file tree, no viewed
   marker — none of the affordances developers expect for diff review.
4. **PR file viewer** (`PRFilesTab`) is *already* premium: 3-column
   review surface, file tree, split/unified, viewed marker persisted to
   localStorage, prev/next, AI insights ([PRFilesTab.jsx:105-265](../../src/components/RepoDetail/PRFilesTab.jsx)).
   The asymmetry between PRs and commits is jarring and the source of
   most of the user's complaint.

## Goal

Bring all four slices to the same fidelity standard, with developer
productivity as the primary metric. Reuse what's already premium
(extract a shared surface) instead of duplicating it.

**Non-goals:**
- Inline review comments on commits (no backend endpoint yet).
- Commit-level AI summary (out of scope; defer to a follow-up).
- Binary / image diff support.
- Live socket updates.

## Architecture

Three new isolated units, two refactors, one bug fix. **Zero new
runtime dependencies** — everything is already installed.

| Unit | Type | Purpose |
|---|---|---|
| `RepoMarkdown` | new component | GitHub-faithful markdown rendering, repo-scope aware |
| `CodeReviewSurface` | extracted component | The 3-column shell currently embedded inside `PRFilesTab` |
| `useDiffPreferences` | new hook | Persists split/unified, wrap, tab-width per user |

### Boundaries

- `RepoMarkdown` knows nothing about repos. `owner`, `repo`, `branch`
  are props used only for relative-URL resolution. Trivially testable
  with mock markdown strings.
- `CodeReviewSurface` knows nothing about commits-vs-PRs. It renders
  `files[]` + slots (`headerSlot`, `rightSlot`). The "viewed" set is
  scoped by a `storageKey` prop the caller controls.
- `useDiffPreferences` is pure state + `localStorage`. No fetching, no
  React context.

A change inside any one unit cannot break the others.

## Slice 1 — README rendering

### New file: `src/components/ui/RepoMarkdown.jsx`

```jsx
<RepoMarkdown
  source={decodedReadmeString}
  owner={repoData.owner.login}
  repo={repoData.name}
  branch={repoData.default_branch || 'main'}
/>
```

Internals:
- `react-markdown` configured with:
  - `remarkPlugins`: `remark-gfm`
  - `rehypePlugins`: `rehype-raw`, then `rehype-sanitize` with a custom
    schema permitting `align` on `div`/`p`, `width`/`height` on `img`,
    `id` on headings, and `class` on `pre`/`code`. Schema lives in the
    same file (one object literal — keep co-located).
- `transformImage` and `transformLinkUri`: relative `./foo.png` →
  `https://raw.githubusercontent.com/{owner}/{repo}/{branch}/foo.png`;
  relative `./docs/x.md` → `https://github.com/{owner}/{repo}/blob/{branch}/docs/x.md`.
  Absolute URLs and anchors (`#section`) pass through.
- Heading anchors: `rehype-slug` (NOT yet installed — replaceable with
  a 12-line custom rehype plugin that derives `id` from text content,
  to avoid a new dep). **Decision: write the inline plugin, no new
  dep.**
- Code-fence renderer: a custom `code` component receives
  `className="language-xxx"` and calls a memoised Shiki highlighter
  reused from the diff viewer. Falls back to plain monospace when the
  language isn't on the small allowlist (`js, ts, jsx, tsx, py, rb,
  rs, go, java, cs, cpp, c, php, swift, sh, yaml, json, md, html, css,
  sql, dockerfile, toml`). Unknown / no language → plain `<pre><code>`.
- Wrapper: `<div className="prose prose-sm dark:prose-invert max-w-none ds-readme">`.
  No global `<pre>` wrapper around the whole thing.

### Modify: `OverviewTab.jsx`

Replace the `readme?.content` branch:

```jsx
) : readme?.content ? (
  <RepoMarkdown
    source={decodeBase64ReadmeUtf8(readme.content)}
    owner={repoData.owner.login}
    repo={repoData.name}
    branch={repoData.default_branch || 'main'}
  />
) : (
  <EmptyState ... />
)
```

Remove the `<pre>` wrapper entirely. Keep the loading/error branches
unchanged.

## Slice 2 — Branches tab

### Bug fix: silence expected 403s

**Validated location:** the noisy line is at
[src/utils/errors.js:341](../../src/utils/errors.js) —
`console.warn('[formatUserError] unmapped error:', err)`. It's a
DEV-only warn (gated by `import.meta.env?.DEV`), but it fires twice
on every Branches-tab open for free-plan-private repos because
`'GITHUB_PRO_REQUIRED'` is not in the `KNOWN_ERRORS` map.

**Two-part fix:**

1. Server-side: confirm the protection-403 envelope returns
   `{ error, code: 'GITHUB_PRO_REQUIRED' }`. If it doesn't, add the
   `code` (the implementation plan must verify this against
   `server/routes/repos.js` or wherever the protection route lives).
2. Client-side: add a `GITHUB_PRO_REQUIRED` entry to `KNOWN_ERRORS`
   in `src/utils/errors.js` with a calm message ("Branch protection
   requires GitHub Pro"). Once mapped, `formatUserError` returns the
   friendly entry and never reaches the unmapped-warn branch.

This is strictly additive — the existing `BranchProtectionPanel`
early-return on `err.code === 'GITHUB_PRO_REQUIRED'` keeps working,
and any *other* surface that bubbles the error now gets a clean
toast instead of falling back to the generic "Something went wrong".

### Layout polish

`BranchesTab.jsx`:
- **Header bar**: search input (filter by name), sort dropdown
  (`Recently active` / `Name` / `Divergence`), filter chips
  (`All` / `Active` / `Stale` / `Protected`). "Stale" defined as no
  commits in 90+ days; computed from the commit date already returned
  in the existing branches payload (no extra fetch).
- **Default branch row** pinned to the top with a subtle
  `from-indigo-500/10 to-transparent` strip and a "default" pill.
- **Each branch row** gains:
  - last-commit subject (truncate) + relative age + author avatar
  - copy-SHA button (ghost, hover-revealed)
  - "Open in GitHub" link
  - on the default branch row, when free-plan-private: a single
    inline `⚠ Pro to protect` badge that links to GitHub pricing
- **Protection panel** stays — but only renders inline (full panel)
  when protection is *available* (paid plan or public repo). On
  free-plan-private it collapses to the inline badge above; the big
  upgrade card moves into a dismissible info strip at the very top of
  the tab. State: `localStorage` key `branches:upgrade-strip:dismissed`.

### Files

- modify `src/components/RepoDetail/BranchesTab.jsx`
- modify `src/components/RepoDetail/BranchProtectionPanel.jsx`
- modify `src/hooks/useRepoDetail.js`
- modify whichever file logs the unmapped-error message (TBD in plan)

## Slice 3 — Codex-style commit diff viewer

### Extract: `src/components/diff/CodeReviewSurface.jsx`

Lift lines ~105-265 of `PRFilesTab.jsx` verbatim, parameterise:

```jsx
<CodeReviewSurface
  files={files}                     // [{ filename, additions, deletions, patch, sha? }, ...]
  storageKey="pr-reviewed:owner/repo#42"
  defaultDiffMode="unified"         // 'unified' | 'split'
  headerSlot={<PRMessage ... />}    // optional content above the diff column
  rightSlot={<AISummaryPanel ... />}// optional right rail; null = widen diff
  emptyState={<NoFilesEmptyState />}
/>
```

`useDiffPreferences()` controls `diffMode` (overrides the prop on first
toggle), `wrap`, `tabWidth`. Persisted under `diffview:preferences`.

### Refactor: `PRFilesTab.jsx`

Becomes a thin adapter — passes PR-specific props (sortFilesByRisk,
AISummaryPanel as `rightSlot`, `useReviewAI` data) into
`CodeReviewSurface`. **No UX regression**: the same toolbar, the same
file tree, the same prev/next, the same viewed marker.

Verification: existing PR review e2e specs must pass without changes.

### Rebuild: `CommitDetailPanel.jsx`

**Validated:** `src/components/ui/Modal.jsx` currently exposes
`size: 'sm' | 'md' | 'lg' | 'xl'` only (line 65). To get true
full-bleed we need to **add a `'full'` entry** to both
`SIZE_CLASSES` and `SHEET_SIZE_CLASSES`:

```js
SIZE_CLASSES.full = 'max-w-[min(96vw,1600px)] max-h-[92vh]'
SHEET_SIZE_CLASSES.full = 'max-h-[92vh]'
```

That's a 2-line additive change in Modal.jsx (no breakage; existing
sizes untouched). The comment at Modal.jsx:22 ("never build these
at runtime") is honoured — the new entry is a literal string, not a
template.

Then convert from `Modal size="2xl"` (note: `2xl` was a typo in the
earlier draft — the current value is whatever the panel passes, the
plan should grep) → `Modal size="full"`. New layout:

```
┌─────────────────────────────────────────────────────────────┐
│ [grad strip] feat: subject line                          [×]│
│ avatar · Author Name · sha pill · 2 hours ago · GitHub ↗   │
│ +56  −11  ·  5 files                                        │
├──────────────┬──────────────────────────────┬──────────────┤
│  File tree   │  [sticky file header]        │              │
│  • a.ts +2 −0│  ─── diff with Shiki ───     │   (no AI     │
│  • b.ts +5 −1│                              │    rail for  │
│  • ...       │                              │    commits)  │
└──────────────┴──────────────────────────────┴──────────────┘
```

`rightSlot={null}` → surface widens the centre column to fill.
`storageKey={\`commit-reviewed:${owner}/${repo}#${sha}\`}` so per-commit
viewed state persists across reloads.

`headerSlot` renders the long-form commit description (multi-line body
after the subject) in a styled card.

### Files

- new `src/components/diff/CodeReviewSurface.jsx`
- new `src/hooks/useDiffPreferences.js`
- modify `src/components/RepoDetail/PRFilesTab.jsx` (consume surface)
- modify `src/components/RepoDetail/CommitDetailPanel.jsx` (full rewrite of body)

## Slice 4 — Diff viewer enhancements

These land in `DiffRenderer` + the surface toolbar; both commits and
PRs benefit because they share the surface.

### Wrap toggle (off by default)

CSS-only: when `wrap` is on, add `whitespace-pre-wrap break-all` to
diff line cells. No re-tokenization. The Shiki output is per-line so
wrap is safe.

### Tab-width control (default 4)

Rewrite `\t` → N spaces in `parsePatchToHunks` *before* handing to the
diff library. Deterministic, cheap. Options: 2 / 4 / 8.

### Copy buttons

- "Copy file path" — sticky file header (already there, just add
  copy affordance)
- "Copy SHA" — header on commit modal
- "Copy line" — line-level ghost button on hover (overlays the line
  number gutter). Only on the right side (post-image) for unified mode.

### Hunk hotkeys

`n` / `N` cycle through `@@` hunks within the active file. Implement in
`CodeReviewSurface` via `useKeyboardShortcuts` (already in the codebase;
see [useKeyboardShortcuts.js](../../src/hooks/useKeyboardShortcuts.js)).
Existing `j` / `k` for prev/next file are kept.

### Persistence

`useDiffPreferences` writes one JSON blob to `localStorage` under
`diffview:preferences`:

```json
{ "mode": "unified", "wrap": false, "tabWidth": 4 }
```

Hydrate on first render; save on each setter call. SSR-safe (read
guarded by `typeof window`).

## Testing

| Slice | Test | Type |
|---|---|---|
| README | RepoMarkdown renders table, fenced code with Shiki, relative `<img src="./banner.png">` resolves to raw.githubusercontent.com, `<div align="center">` survives sanitization, `<script>` does not | unit (Vitest + RTL) |
| README | OverviewTab integration: real README payload renders without `<pre>` wrapper around the whole content | unit |
| Branches | filter chips narrow the list correctly; sort by divergence orders ahead-of-default first | unit |
| Branches | upgrade-required state shows ONE inline badge + dismissible strip, NOT the duplicate panel | unit |
| Branches | apiFetch attaches `expected: true` when body has a `code`; formatUserError skips logging | unit |
| Commit diff | CommitDetailPanel renders CodeReviewSurface with file tree + diff; storageKey scopes viewed set per-sha | unit |
| Diff prefs | useDiffPreferences round-trips through localStorage | unit |
| E2E | open commit → split/unified toggle → mark file viewed → reload modal → marker persists | Playwright |
| E2E | overview tab on a repo with a markdown README → table renders → relative image loads | Playwright |
| E2E (regression) | existing PR review specs continue to pass against the refactored PRFilesTab | Playwright |

Test files (per project convention):
- `tests/components/ui/RepoMarkdown.test.jsx`
- `tests/components/diff/CodeReviewSurface.test.jsx`
- `tests/components/RepoDetail/BranchesTab.test.jsx` (extend if exists)
- `tests/components/RepoDetail/CommitDetailPanel.test.jsx` (new)
- `tests/hooks/useDiffPreferences.test.js`
- `e2e/commit-diff-viewer.spec.js`
- `e2e/repo-readme.spec.js`

## Acceptance criteria

A reviewer can verify the work by:

1. Opening any repo with a markdown README → it renders with tables,
   headings, fenced code highlighted, and the banner image visible.
2. Opening a private repo on a free plan → no "unmapped error" lines
   in DevTools console; Branches tab shows one tidy strip + a single
   ⚠ Pro badge on the default branch row.
3. Opening any commit → full-bleed modal with file tree, syntax-
   highlighted diff, working split/unified, working viewed marker that
   survives a reload.
4. Opening any PR → unchanged UX (regression check); same toolbar
   gains wrap + tab-width controls that persist across PRs.

## Out of scope (intentional)

| What | Why deferred |
|---|---|
| Inline review comments on commits | No backend endpoint; would be vaporware |
| Commit-level AI summary | Needs `useReviewAI` adaptation + budget review; follow-up spec |
| Binary / image diff | The diff library doesn't support it; needs different surface |
| Live updates via WebSocket | Existing `useResilientFetch` polling is good enough |
| `rehype-slug` dep | A 12-line inline plugin avoids the new dep |

## Risks

| Risk | Mitigation |
|---|---|
| Shiki bundle bloat from README highlighting | Reuse the highlighter the diff viewer already loads; restrict the language allowlist |
| `rehype-raw` + `rehype-sanitize` letting through unsafe HTML | Custom schema is explicit-allow only; unit test asserts `<script>` is stripped |
| Refactor breaks PR review (a load-bearing premium surface) | Existing PR review e2e suite gates the refactor; surface extraction is a pure lift, no logic change |
| Free-plan branch logic flickers between states during load | Use `BranchProtectionPanel`'s existing `loading` state; don't render the upgrade strip until the protection fetch resolves |
| Per-commit "viewed" state grows unbounded in localStorage | Cap at 200 entries via LRU eviction inside `useDiffPreferences`; commits are small keys (`owner/repo#sha`) |

## Success metric

The user (a developer reviewing real diffs) prefers this to GitHub.com
for at least three commit reviews in a row. No regression on PR review.
