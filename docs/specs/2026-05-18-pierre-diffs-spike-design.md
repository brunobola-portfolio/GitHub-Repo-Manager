# Pierre `@pierre/diffs` Spike — Design

**Date:** 2026-05-18
**Status:** Spike (no implementation yet — spec captures the upfront research)
**Author:** Bruno + Claude
**Related:** [v4.3.0 release notes](../../CHANGELOG.md) added a Roadmap "Next" entry for this; this spec resolves the open license question and scopes the spike.

---

## Why

`v4.3.0`'s roadmap research surfaced **Pierre Computer Company**'s open-source
diff + tree primitives as the headline candidate for replacing our current
diff-rendering stack. The components are the same ones powering
[diffshub.com](https://diffshub.com) and Pierre's own git platform, so they
are production-grade, browser-tested, and built specifically for
repo-management UX (the exact problem space this app sits in).

Today our PR Review surface composes:

- `vendor-diff-gZJjGZPC.js` (303 KB, gzip 85 KB) — currently the
  `MrWangJustToDo/git-diff-view` library (per `vite.config.js` manualChunks).
- A hand-rolled `<DiffCollapser>` fold-by-default for files >500 lines and
  `<DiffComputeOnDemand>` above 50 000 lines (shipped in `v4.1.0`).
- `<MobileFileTreeSheet>` and `<FileTree>` for the file tree (in-house).

This works but ships ~300 KB of vendor JS per PR review session, and the
visual treatment is good-but-generic. Pierre's components are purpose-built
for the GitHub-tasteful aesthetic we adopted in `v4.3.0` (see the non-LFM
theme spec) so they should fit the visual contract better than a generic
diff lib.

## License — resolved

| Package | Version | License | npm |
|---|---|---|---|
| `@pierre/diffs` | `1.1.22` | **Apache-2.0** | Published, public |
| `@pierre/trees` | `1.0.0-beta.3` | **Apache-2.0** | Published, public (beta) |

Apache-2.0 is fully compatible with our AGPL-3 license (Apache code can be
embedded in AGPL projects). The `pierrecomputer/pierre` GitHub repo root has
no top-level LICENSE file (which is why `gh api repos/.../pierre` returns
`license: null`), but each individual package's `package.json` declares
`"license": "apache-2.0"`, which is the canonical legal statement for an npm
package and what `license-checker` style tools rely on.

**Conclusion:** No license blocker. Spike can proceed.

## Spike scope (proposed)

Two-phase, easy to abort if the visual fit isn't there.

### Phase A — Side-by-side prototype (1-2 days)

- [ ] `pnpm add @pierre/diffs` (peer-deps already satisfied: `react`,
      `react-dom`).
- [ ] Add a `?pierre=1` URL flag on the PR Review page that swaps the
      current diff renderer for `@pierre/diffs` for a single hard-coded
      mock PR (use the existing `src/big-refactor.js` fixture from
      `pr-review-mobile.spec.js`).
- [ ] Visual comparison: side-by-side screenshots of the same diff under
      both renderers, light + dark, mobile + desktop.
- [ ] Bundle delta: vite-bundle-analyzer before + after; record the
      `vendor-diff` chunk size change.
- [ ] Capability matrix: split view, unified view, syntax highlighting,
      word-level diff, inline comments support, code suggestions, mobile
      gesture support.

**Exit criteria:** Pierre wins on at least 4 of the 6 capabilities AND the
bundle delta is neutral or favourable (no more than +20 KB gzipped).

### Phase B — Roll-out (2-3 days, gated on Phase A success)

- [ ] Replace `vendor-diff` chunk in `vite.config.js` manualChunks.
- [ ] Migrate `<DiffPanel>`, `<DiffCollapser>`, `<DiffComputeOnDemand>`,
      `<DiffRenderer>` to Pierre's primitives. The fold-by-default behaviour
      stays — it's a product policy, not a renderer feature.
- [ ] Migrate `<FileTree>` and `<MobileFileTreeSheet>` to `@pierre/trees`
      (probably as a separate sub-spike — trees has fewer existing tests so
      lower risk).
- [ ] Inline comment integration: confirm Pierre's API exposes a per-line
      slot for our existing `<InlineComment>` and `<AIInlineComment>`
      components. If not, gated revert.
- [ ] E2E coverage: run the existing `pr-review.spec.js` and
      `pr-review-mobile.spec.js` suites against the new renderer; adjust
      selectors only as needed.

**Exit criteria:** All existing PR Review e2e tests pass; bundle is smaller
or within +20 KB gzipped; AI inline comments still render correctly; mobile
sheet still works.

## Non-goals

- This is a **renderer swap**, not a PR Review re-design. Toolbar, sticky
  status bar, AI panel, file tree behaviour, keyboard shortcuts — all stay.
- We do not adopt Pierre's full stack (router, server, auth) — just the two
  rendering primitives.
- We do not chase parity with `diffshub.com` features that aren't already
  on the Repo Manager roadmap (e.g. anchor URLs to a diff line).

## Risks

| Risk | Mitigation |
|---|---|
| Pierre's API doesn't expose a per-line inline-comment slot | Phase A capability matrix catches this before rollout; abort at the gate. |
| `@pierre/diffs@1.1.22` is still pre-2.0 — API may break | Pin exact version in `package.json`; subscribe to repo releases; budget 1 day per minor bump. |
| Trees is `1.0.0-beta.3` — beta tag | Sequence trees as a **separate** spike after diffs is in. Don't bundle them. |
| Visual fit doesn't match our restraint-first theme | Phase A is explicitly a side-by-side visual review; abort if Pierre's defaults clash with our tokens. |

## File map (when we proceed)

- New: `docs/plans/2026-05-XX-pierre-diffs-rollout.md` — implementation
  plan with concrete file diffs.
- Modified: `vite.config.js` (manualChunks), `package.json` (add
  `@pierre/diffs`), six PR-review surface files
  (`DiffPanel.jsx`, `DiffCollapser.jsx`, `DiffComputeOnDemand.jsx`,
  `DiffRenderer.jsx`, `FileTree.jsx` if trees too, `MobileFileTreeSheet.jsx`
  if trees too).
- Removed: dependency on `git-diff-view` (~303 KB chunk).

## Decision matrix — when to revisit

This spec is a **green light** for Phase A but not Phase B. Re-read after
Phase A and re-confirm Phase B gate. Re-read again whenever Pierre cuts a
major version (2.0+).
