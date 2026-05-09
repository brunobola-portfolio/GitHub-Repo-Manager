# PR / Commit Review — Perf, Polish & Mobile Parity

**Date:** 2026-05-09
**Status:** Draft — pending user approval
**Builds on:** `2026-05-03-pr-review-premium.md` (3-column surface), `2026-05-03-ai-deep-review.md` (AI walkthrough), `2026-04-09-pr-review-experience-design.md` (initial PR review surface).

---

## Why now

Two reproducible bugs surfaced today on the live `BolaLabs/VOA-SUPPORT-SYSTEM` repo, plus a class of UX/perf debt that becomes obvious the moment a real PR with a few thousand changed lines lands in the surface:

1. `GET /api/repos/{owner}/{repo}/branches/main/protection` → **403 Forbidden** for non-admin collaborators. The current handler in `src/components/RepoDetail/BranchProtectionPanel.jsx:74-92` only special-cases `code: 'GITHUB_PRO_REQUIRED'`; everything else falls through to `toast.errorFromException`, polluting the toast area and the dev console on a state that is *expected* (you don't have admin, that's fine).
2. `[@git-diff-view/core] Mismatch detected between 'oldFileContent' and 'diff' at line N.` — emitted on every commit and PR file we render. The library validates patches and our `parsePatchToHunks` (`src/components/PRReview/DiffPanel/DiffRenderer.jsx:65-78`) synthesises minimal `--- / +++` headers per hunk; the synthesised hunks pass parsing but fail the library's *internal consistency* check, leaving warning spam in the console even though the diff renders correctly.
3. The diff renderer itself is **not virtualised**. A 5k-line PR materialises every hunk, every token, every comment widget into the DOM at once. The file tree was virtualised in the original spec (`@tanstack/react-virtual`); the diff payload was not.
4. `PRReviewView` hides the AI panel entirely below `lg` (`hidden lg:flex` at `PRReviewView.jsx:330`). On a phone there is *no* drawer fallback. `PRDetailPanel`'s Files tab inherits the same desktop-first layout from `CodeReviewSurface`.
5. The inline-comment composer in `DiffPanel` lives at the bottom of the diff scroll container. On a 4k-line file the composer scrolls off-screen the moment you click "comment" and you lose your context — exactly the GitHub 2025 anti-pattern called out in the research.

This spec covers the next-iteration work in three sliceable, mergeable chunks. Each slice ships standalone and is independently revertable.

---

## Goals

- **Console-clean review surface.** Zero unexpected errors or warnings on a normal commit/PR review.
- **Stable performance up to ~10k changed lines** across a single PR. Concretely: opening a 10k-line PR reaches first paint of the file tree in <300 ms, first paint of the active diff in <600 ms (network-bound), and `j/k` navigation between files is <16 ms (one frame) regardless of the next file's size.
- **Mobile review parity.** A reviewer with only a phone can: see the file list, jump between files, read a diff, leave an inline comment, mark files viewed, submit a review. Today they cannot do most of these.
- **Polish that earns trust.** Sticky composer that doesn't lose context. Animated "viewed" tick that signals progress. Keyboard help overlay. No layout jumps when files load or fold.

## Non-goals

- New AI features. The existing AI Deep Review (walkthrough + line comments draft + publish) is enough; this spec only changes how it's *presented*, not what it produces.
- Comment threading model overhaul. Current flat-with-replies (`groupCommentsIntoThreads` in `DiffPanel.jsx:38`) stays; nested threads can wait for a future spec.
- Suggestion-block "apply patch" UX. GitLab-style ` ```suggestion ` rendering is a great future, not this slice.
- Replacing `@git-diff-view/react` wholesale. We extend / wrap it; we do not rip it out.
- Voice dictation, pinch-zoom, swipe-between-files. Tempting from the research, but YAGNI for this round.

---

## Slice 1 — "Quiet & Correct" (1–2 days)

Focused bug-fix slice. No design changes, no new components. Goal: a clean console on a real repo with a real PR.

### 1.1 Branch protection 403 handled gracefully

**File:** `src/components/RepoDetail/BranchProtectionPanel.jsx`

- Server already returns `{ status: 403, code?: 'GITHUB_PRO_REQUIRED' | undefined }`. Add a second branch in the catch (`load`, line 83-91) for the no-code 403 case: set a new `permissionDenied` boolean and short-circuit the toast.
- Render an inline, non-alarming card explaining "Branch protection requires admin access on this repository. You're a collaborator without admin, so this surface is read-only." Reuse the same gradient/Sparkles aesthetic as the existing `upgradeRequired` block (lines 184-203) for visual continuity, but with a `Shield` icon (already imported) and neutral copy.
- Apply the same logic to the `inline` variant (used in the per-branch chip on `BranchesTab`): instead of "unprotected" or "protected", a dimmed `permission-denied` chip ("admin only").
- Backend optional follow-up (out of scope for slice 1 *unless* the change is one line): add `code: 'INSUFFICIENT_PERMISSIONS'` to the 403 response in `server/routes/branches.js` so the client can branch on `err.code` instead of `err.status === 403 && !err.code`. Spec assumes the cleaner path; if backend change isn't trivial, the heuristic is acceptable.

### 1.2 Silence `@git-diff-view/core` consistency warnings

**File:** `src/components/PRReview/DiffPanel/DiffRenderer.jsx`

The library's `_DiffFile_checkFile` validates that the diff parses round-trip against `oldFileContent`/`newFileContent`. We don't pass either, so the library reconstructs them from hunks and complains when our synthesised `--- /+++` headers don't carry enough context.

Two options, ordered by preference:

1. **Pass the GitHub-provided patch to the library as a single block** instead of split-and-re-headerise. The library's parser handles unified diffs without `--- /+++` when the data is provided through its `addAdditionLineString` / hunk-string API. Investigate `@git-diff-view/core`'s `DiffFile.addRaw` path which accepts an object `{ hunks: string[] }` *or* a single string. If a single-string entry point exists and works, drop `parsePatchToHunks` entirely.
2. **Mute the warning at the source.** The lib supports `notifyContent: false` or similar config (verify in source). If 1 isn't tractable in the time-box, do a one-line config silence with a `// REASON:` comment pointing to this spec. Document in the spec that the warning is benign and how to revisit.

Either option closes the console noise without affecting render correctness.

### 1.3 Verification

- Manual smoke: Playwright MCP run that opens `BolaLabs/VOA-SUPPORT-SYSTEM` → Branches tab (assert no toast, no console error) → Commits tab → click a commit (assert no `@git-diff-view/core` warning).
- Two unit tests added: `BranchProtectionPanel.test.jsx` permission-denied state; `DiffRenderer.test.jsx` regression for the warning (consumes a console spy).

### 1.4 Definition of done — slice 1

- [ ] Permission-denied state ships in card and inline variants.
- [ ] Console is clean on a 200-line and a 5k-line commit.
- [ ] Two new unit tests pass; existing tests still pass.
- [ ] Single PR, single commit, reverts cleanly.

---

## Slice 2 — "Pro-grade Diff Viewer" (3–5 days)

The core perf and big-diff slice. Most of the impact lives here.

### 2.1 Hunk-level virtualisation

The current `DiffRenderer` renders every hunk synchronously. For a file with hundreds of hunks (typical in a large refactor PR) this is the primary jank source.

**Approach:**

- Keep `@git-diff-view/react` as the *per-hunk* renderer (it does syntax highlight, comment widgets, split/unified mode well).
- Wrap it in a new `<VirtualizedDiff>` that:
  - Splits `patch` into hunks at the `^@@` boundary (existing `parsePatchToHunks` reuse).
  - Mounts each hunk as a `useVirtualizer` row with measured height (initial estimate from line count × line height, refined via `measureElement`).
  - Uses `overscan: 5` (hunks are larger than file-tree rows; a smaller overscan is fine).
  - Persists per-hunk measured heights in a `useRef` map keyed by hunk hash so re-mounts (filter changes, view-mode toggles) don't reflow.

**File touched:** `src/components/PRReview/DiffPanel/DiffRenderer.jsx` becomes a thin shell that switches between:
- `<VirtualizedDiff>` for files with >200 changed lines (threshold tunable);
- The current single-pass `<DiffView>` for small files (overhead of virtualisation is not worth it for a 30-line diff).

**Library:** `@tanstack/react-virtual` (already in deps; we use it for `FileTree`). No new dependency.

### 2.2 Fold-by-default for large files

Mirrors GitHub's 2025 behaviour and the Reviewable convention:

- Files with `additions + deletions > 500` render collapsed by default with a "Show diff (N lines changed)" expand button and a one-screen preview of the first hunk.
- Per-file collapsed state lives in the same `localStorage` set as `reviewed` (new `expanded` set), so a user who chose to expand a large file once doesn't have to expand it again.
- Bulk action in the toolbar: "Expand all" / "Collapse all" (Gerrit's `Shift+X` / `Shift+C`).

**File:** `src/components/diff/CodeReviewSurface.jsx` — wrap the `<DiffRenderer>` mount in a `<DiffCollapser>` that respects the threshold. Toolbar buttons added to `CodeReviewToolbar.jsx`.

### 2.3 Keep tokenisation off the main thread (deferred mitigation)

The research recommends worker-thread tokenisation. `@git-diff-view/react` bundles its own Shiki and runs synchronously in render — moving that off-thread requires either forking the library or swapping to `react-diff-view` with `withTokenizeWorker`. Both are large efforts.

**This slice:** *do not* swap. Instead:
- Move the existing `expandTabs` call (`DiffRenderer.jsx:12-16`) into a `useDeferredValue` so tab-width changes don't block paint on huge patches.
- Add a CPU budget guard: if `additions + deletions > 5000`, force-disable syntax highlighting (`highlightLanguage="plaintext"`) with a small "Highlighting paused for large file" pill the user can dismiss to opt back in.

A future slice can revisit a worker-driven highlighter swap; that's a multi-day investigation we should not couple to this work.

### 2.4 Sticky inline composer

The single largest UX regression from the research is the comment composer being a modal or a bottom-of-scroll element. We do the latter.

**Change:** when `commentingLine` is set in `DiffPanel.jsx`, the composer renders as a *floating, position-fixed* card anchored to the right side of the diff column at viewport-relative coordinates — not at the bottom of the scroll container. Width 420px on desktop, full-bleed bottom sheet on mobile. The diff stays scrollable behind it.

Reuse the existing `useDraftPersistence` hook so composer state survives accidental dismissal.

### 2.5 Definition of done — slice 2

- [ ] 10k-line PR opens to first diff paint in <600 ms (measured on a mid-tier laptop, dev build acceptable).
- [ ] `j`/`k` between files in a 10k-line PR is <16 ms on the next file's first frame.
- [ ] Files >500 lines collapsed by default; per-file expand persists across refresh.
- [ ] Composer remains visible while user scrolls a long diff.
- [ ] No new top-level dependencies (only `@tanstack/react-virtual` re-use).
- [ ] Unit tests for `<VirtualizedDiff>` (1: respects threshold; 2: re-uses measured heights on view-mode toggle) and `<DiffCollapser>` (1: collapses above threshold; 2: persists expanded state).
- [ ] One e2e in `e2e/` opens a fixture PR with >500 lines, asserts collapse, expands, asserts diff is rendered.

---

## Slice 3 — "Mobile & Polish" (3–5 days)

Closes the mobile parity gap and adds the polish that turns a working surface into a delightful one.

### 3.1 File tree as a bottom sheet on mobile

`CodeReviewSurface` today uses a fixed `w-[220px]` left column. Below `md` we hide the tree entirely if `treeCollapsed`; there's no way to *open* it without toolbar interaction.

**Change:**

- Below `md` breakpoint, the tree is always collapsed in the layout sense (no left column).
- A new toolbar button "Files (N)" opens the tree as a bottom sheet via the existing `<Modal mobileVariant="sheet">` primitive (`src/components/ui/Modal.jsx`) — no new dependency. The sheet's body hosts the existing `<FileTree>` virtualised list.
- Selecting a file in the sheet auto-closes it and scrolls the diff to the top.

### 3.2 AI panel as a right-edge drawer on tablet/mobile

`PRReviewView` hard-hides the AI panel below `lg`. Replace with:

- `lg+`: panel persistent in the third column (current behaviour).
- `md`: panel reachable via a floating action button bottom-right that slides the AI panel in from the right edge as an overlay.
- `<md`: same FAB; full-screen sheet from the right edge.

`CodeReviewSurface`'s `rightSlot` follows the same pattern (it's used by `PRFilesTab` for AI insights, and can hold any right-side content).

### 3.3 Sticky review action bar

A persistent footer (or top-right docked card on desktop) with:

- Approve / Comment / Request changes buttons
- A circular progress ring showing `reviewedCount / totalFiles` with a Framer Motion spring on each tick.
- Pending comment count badge.

On mobile the bar is a thumb-zone bottom action bar with `safe-area-inset-bottom` padding.

This already exists in skeletal form as `<ReviewStatusBar>` (`src/components/PRReview/ReviewToolbar/ReviewStatusBar.jsx`). Promote it to a true action bar (currently it only shows counts), and elevate it to mobile.

### 3.4 Animated "Viewed" interaction

When a user marks a file viewed:

- Framer Motion `layout` animates the file row in `FileTree` to its new position (typically pushed below unviewed files when sort=`risk`). Duration 180ms ease-out.
- The progress ring in the action bar springs to its new value.
- A subtle inline `Check` icon scales-in next to the file name.

All Framer Motion, all <30 lines of code total, all leveraging the `layout` prop.

### 3.5 Keyboard help overlay & shortcut grid

- Add `?` shortcut (using existing `useKeyboardShortcuts` registry) → opens a `<KeyboardHelpOverlay>` modal grouped by section: Navigate, Comment, Review, View.
- Document the canonical grid (j/k/n/p/v/c/r/?) in `src/config/keyboardShortcuts.js`.
- The `cmdk`-based `CommandPalette` (already exists at `src/components/CommandPalette.jsx`) gets PR-review-scoped commands ("Mark current file viewed", "Approve", "Request changes", "Toggle file tree") when the surface is focused.

### 3.6 Definition of done — slice 3

- [ ] Full review flow works on a 375×667 viewport: open PR, browse files via sheet, read diff, comment inline, mark viewed, submit review.
- [ ] No layout jump when a file is marked viewed.
- [ ] `?` opens help overlay; `cmd+k` lists PR-scoped commands when surface is focused.
- [ ] Action bar has a working progress ring and pending count.
- [ ] Two e2e tests in `e2e/`: one for mobile review flow (Playwright `--device "iPhone 13"`), one for keyboard navigation through a 5-file PR.

---

## Cross-cutting concerns

### Where the changes land

| File | Slice | Type |
|---|---|---|
| `src/components/RepoDetail/BranchProtectionPanel.jsx` | 1 | Edit |
| `src/components/PRReview/DiffPanel/DiffRenderer.jsx` | 1, 2 | Edit |
| `src/components/PRReview/DiffPanel/VirtualizedDiff.jsx` | 2 | New |
| `src/components/PRReview/DiffPanel/DiffCollapser.jsx` | 2 | New |
| `src/components/diff/CodeReviewSurface.jsx` | 2, 3 | Edit |
| `src/components/diff/CodeReviewToolbar.jsx` | 2, 3 | Edit |
| `src/components/PRReview/DiffPanel/DiffPanel.jsx` | 2 | Edit (sticky composer) |
| `src/components/PRReview/PRReviewView.jsx` | 3 | Edit (drawer + action bar) |
| `src/components/PRReview/ReviewToolbar/ReviewStatusBar.jsx` | 3 | Edit (promote to action bar) |
| `src/components/PRReview/KeyboardHelpOverlay.jsx` | 3 | New |
| `src/config/keyboardShortcuts.js` | 3 | Edit (add PR-scoped grid) |
| `src/components/CommandPalette.jsx` | 3 | Edit (PR-scoped commands) |
| `tests/components/...` | 1–3 | New + edits |
| `e2e/...` | 1–3 | New |

No new top-level dependencies. Reuses `@tanstack/react-virtual`, `framer-motion`, `cmdk`, `@git-diff-view/react`, all already in `package.json`.

### Bundle budget

Current main bundle budget is 65 KB (raised from 60 KB for the v3.8 premium pass — see `chore(perf)` commit `2072349`). The new components are small and the `<VirtualizedDiff>` chunk is loaded inside the existing lazy `DiffRenderer` chunk, so it does not enter the main bundle.

Net main-bundle delta target: **≤ +2 KB**. CI honesty gate already enforces the budget; if we exceed, we either tighten or raise with a commit explanation.

### Telemetry / instrumentation

Out of scope for this spec — no analytics added. Future spec can add per-slice timing marks if we need to *prove* the perf goals beyond manual measurement.

### Accessibility

- All new buttons get `aria-label`.
- Bottom sheet preserves focus trap (Modal already does this via `useFocusTrap`).
- Composer maintains focus on open and returns it on close.
- Keyboard help overlay is announced via `role="dialog"` + `aria-labelledby`.
- Reduced-motion respected for all Framer Motion (`useReducedMotion` already used in `Modal.jsx:95`).

### Risks & open questions

1. **`@git-diff-view/react` virtualisation interaction.** The library may rely on contiguous DOM for its line-number sync. Slice 2 needs a one-day spike to verify the wrap-per-hunk approach plays well. Mitigation: if it doesn't, we render the whole file but use `content-visibility: auto` as a CSS-only fallback (less optimal but zero-risk).
2. **Comment widget callbacks across virtualised rows.** Each hunk renders an independent `<DiffView>` — `onAddWidgetClick` receives line numbers relative to the hunk. The wrapper must translate to file-absolute line numbers. Existing `parsePatchToHunks` returns hunks in source order so absolute line tracking is straightforward.
3. **Backend `code` field on 403.** Slice 1.1 assumes the option to add a structured code on the server. If that's politically expensive (mass test churn), the heuristic `status === 403 && !code` works fine.
4. **Mobile sheet on iOS Safari with diff inside.** iOS Safari has known issues with `100vh` + virtualised content. Use `100dvh` and the existing `useMobileKeyboardFix` hook (`Modal.jsx:6`).

---

## Sequencing

Slices ship in order, each as a separate PR:

1. **Slice 1** lands first; revert-safe, isolated, validates the cycle.
2. **Slice 2** depends on slice 1 only for the cleanest diff renderer baseline (no warning noise to confuse perf debugging).
3. **Slice 3** depends on slice 2 for the sticky composer (which will be embedded in mobile flows).

Each slice gets its own implementation plan via `superpowers:writing-plans` after this design is approved.

---

## What we are explicitly *not* doing in this spec

- Replacing `@git-diff-view/react` with `react-diff-view`. Worth a future spec; not this one.
- Migrating draft persistence from `localStorage` to IndexedDB (`idb-keyval`). Drafts are small and rarely lost — the cost/benefit doesn't favour the migration *yet*.
- Adding `vaul` for bottom sheets. Our existing `<Modal mobileVariant="sheet">` is good enough; adding a second sheet system would cause inconsistency and bundle weight.
- Building a CodeRabbit-style first-comment AI walkthrough. The existing AI Deep Review surface is the right home for that and it already exists.
- Swipe-between-files on mobile. Tempting but adds a gesture model that fights browser back-swipe on iOS. Park for a future spec when we can prototype on real users.

---

## Approval gate

Before any slice starts implementation, this spec is reviewed and approved by the user. After approval, each slice gets a separate plan via `superpowers:writing-plans` and is implemented through `superpowers:subagent-driven-development` or `superpowers:executing-plans` depending on parallelism.
