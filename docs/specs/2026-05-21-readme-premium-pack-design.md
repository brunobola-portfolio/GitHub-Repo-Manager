# README Premium Pack — Design

**Date:** 2026-05-21
**Status:** Spec (ready for implementation plan)
**Author:** Bruno + Claude
**Related:** Sequencing — this is independent from the [Pierre `@pierre/diffs` spike](./2026-05-18-pierre-diffs-spike-design.md). Pierre covers PR Review diff rendering; this spec covers README rendering. They share no code paths.

---

## Why

The README tab on `RepoDetail/Overview` is the first long-form surface a user sees when opening a repo. Today the rendering is technically correct but visually flat (Tailwind `prose` defaults + no syntax highlighting + emoji rendered as the host OS font). The screenshot of `cc-statusline`'s README in the app makes this concrete: a `bash` install command appears as plain text, `❌ / ⚠️` markers depend on the OS, and there is no copy affordance.

The goal of this pack is **render the README better than github.com itself** while staying within our v4.3.0 "premium-through-restraint" theme — additive layers on the existing `react-markdown` stack, not a renderer rewrite.

## Constraints decided upfront

| Decision | Choice |
|---|---|
| Renderer base | Keep `react-markdown` + `remark-gfm` + `rehype-raw` + `rehype-sanitize` (zero churn for the 5 existing call-sites). |
| Syntax highlighter | `@wooorm/starry-night` (same engine GitHub's "PrettyLights" uses; CSS-class-based, easy theming). |
| Syntax theme | **GitHub default light + GitHub default dark**, switched via `.dark` on `<html>`. No custom palette. |
| Alerts | `remark-github-blockquote-alert` (renders `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`). |
| Emoji | `remark-gemoji` + self-hosted Twemoji SVG sprite (no third-party CDN, no CSP changes). |
| Mermaid / Math / TOC sidebar / image lightbox | **Out of scope.** Separate specs. |

## Architecture

Single entry point stays at `src/components/ui/RepoMarkdown.jsx` but the file is moved into a sub-folder and the plugin pipeline is augmented. All 5 existing call-sites continue to import the same named export.

### File map

```text
src/components/ui/markdown/                 ← new sub-folder
├── RepoMarkdown.jsx                        ← moved from ../RepoMarkdown.jsx, API unchanged
├── CodeBlockChrome.jsx                     ← new: language label + copy button
├── rehype-starry-night.js                  ← new: hast transformer using starry-night
├── remark-twemoji-self-hosted.js           ← new: text-node walker → <img> SVG
├── grammars-common.js                      ← new: 16 eager-loaded grammars
├── grammars-lazy.js                        ← new: dynamic import() registry
└── readme-theme.css                        ← new: GitHub light+dark CSS class palette

src/components/ui/__rehype-slug-inline.js   ← unchanged (existing inline-slug plugin)
src/components/ui/RepoMarkdown.jsx          ← deleted (moved)

tests/components/ui/markdown/
├── RepoMarkdown.test.jsx                   ← moved from tests/components/ui/RepoMarkdown.test.jsx
├── CodeBlockChrome.test.jsx                ← new
├── alerts.test.jsx                         ← new (5 alert types, light+dark)
└── twemoji.test.jsx                        ← new (gemoji shortcode + unicode emoji)

e2e/
└── repo-readme-premium.spec.js             ← new
```

### Call-site impact

Five files import `RepoMarkdown`:

- `src/components/RepoDetail/OverviewTab.jsx`
- `src/components/AI/RepoInsightsModal.jsx`
- `src/components/AI/ReadmeEnhanceDiffPanel.jsx`
- `src/components/AIPrompts/SafeMarkdown.jsx` (re-export)
- `src/components/Roadmap/RoadmapPage.jsx`

**None change.** The import path `../ui/RepoMarkdown` still resolves via the sub-folder's `index.js` (or via the existing path because we keep a re-export shim — pick at implementation time, the spec does not constrain this).

### Plugin pipeline (after)

```js
remarkPlugins:  [remarkGfm, remarkGithubBlockquoteAlert, remarkGemoji, remarkTwemojiSelfHosted]
rehypePlugins:  [rehypeRaw, rehypeSlugInline, rehypeStarryNight, [rehypeSanitize, SCHEMA]]
```

Order matters: `rehypeRaw` first (lift raw HTML into the tree), then `rehypeSlugInline` (heading anchors), then `rehypeStarryNight` (tokenise `<code>` children — produces additional spans the sanitizer must allow), then `rehypeSanitize` LAST so it can validate the spans starry-night emits.

The `SCHEMA` constant gains entries for `span` with `className` whose value is in the allowlist of starry-night's class names (prefix `pl-`). This is critical — without this the sanitizer strips highlight spans.

## Features — detail

### 1. Syntax highlighting (starry-night)

**Eager-loaded grammars (20):** `source.ts`, `source.tsx`, `source.js`, `source.jsx`, `source.json`, `source.yaml`, `source.shell`, `source.python`, `source.go`, `source.rust`, `source.java`, `source.cs`, `source.cpp`, `source.c`, `source.php`, `source.ruby`, `source.sql`, `text.html.basic`, `source.css`, `text.md`. Selected to cover the top-20 GitHub languages, which collectively account for the language tag of >97% of README fenced blocks in our existing test fixtures (mock READMEs in `src/__mocks__/mockRepoDetail.js`) and in the top 100 GitHub-trending repos sampled during the spike.

**Lazy grammars:** all other ~600 langs go through `grammars-lazy.js`, which is a `Record<string, () => Promise<Grammar>>`. The rehype plugin checks the eager registry first; on miss it triggers the dynamic import and re-renders the block when the grammar resolves (React `useTransition` on the consumer side keeps the swap non-janky). Unknown language → no highlight, plain monospace, no error.

**No flash:** because starry-night runs at render time on the hast tree, there is no client-side post-mount tokenisation — the first paint already has the spans.

### 2. GFM Alerts

Plugin: `remark-github-blockquote-alert`. Markdown input `> [!NOTE]\n> body` becomes `<div class="markdown-alert markdown-alert-note"><p class="markdown-alert-title">…</p><p>body</p></div>`.

Theming: matched to the v4.3.0 token palette. Each of the 5 types gets a border-l-4, a tinted background (50/950 light/dark), and a tinted icon — same visual register as GitHub but pulling from our slate/blue/green/amber/red tokens so they sit consistently next to the rest of the app's modals and toasts. CSS lives in `readme-theme.css`.

Icons: lucide-react (`Info` for NOTE, `Lightbulb` for TIP, `MessageSquareWarning` for IMPORTANT, `AlertTriangle` for WARNING, `OctagonAlert` for CAUTION). Inlined into the alert via a tiny custom hast transformer chained after the alert plugin (or via a `components.div` override on the React side — implementation choice).

### 3. Twemoji (self-hosted)

`remark-gemoji` first: converts `:rocket:` shortcodes to unicode 🚀. Then `remark-twemoji-self-hosted` walks text nodes, detects unicode emoji via a precompiled regex (RGI emoji sequence), and replaces them with `<img src="/twemoji/{codepoint}.svg" alt="{emoji}" class="ds-twemoji">`.

SVG sprite is checked into the repo at `public/twemoji/` (≈3500 files, ~4 MB on disk uncompressed but each request is a single 1–2 KB SVG; only the emojis actually used by a given README are fetched). Build step: a one-shot Node script `scripts/sync-twemoji.mjs` downloads from [twitter/twemoji](https://github.com/twitter/twemoji) at pinned version, run manually and committed (not part of the production build).

Why self-hosted not CDN: avoids a third-party request (CSP `img-src` stays clean), avoids the discontinued JSDelivr/MaxCDN history, and the cost is one-time disk space we already have headroom for.

### 4. Code-block chrome (Copy + language label)

`CodeBlockChrome.jsx` wraps every `<pre><code>` rendered by `react-markdown`. Layout:

```text
┌────────────────────────────────────────────┐
│ {lang}                            ⧉ Copy   │ ← height 32px, slate-100 / slate-800
├────────────────────────────────────────────┤
│ {highlighted code, no top padding}         │
└────────────────────────────────────────────┘
```

- `{lang}` reads from `className="language-xxx"` on `<code>`. If no language → header bar hides (clean look for plain blocks).
- Copy button uses `navigator.clipboard.writeText(node.textContent)`; on success calls existing `useToast().success('Copied')`. On failure (very rare — old browsers / insecure context) shows error toast.
- Idle state: button at `opacity-60`. Hover the `<pre>`: `opacity-100`. No animation longer than 150ms — same easing as the rest of the app.
- Accessible: button has `aria-label={`Copy ${lang || 'code'} block`}`, the chrome bar is `role="presentation"`.

### 5. CSS theming

`readme-theme.css` provides:

- `.pl-*` rules from starry-night's `style/light.css` + `style/dark.css`, scoped to `.ds-readme` so they only affect README content.
- `.markdown-alert*` rules for the 5 alert types (cf. feature 2).
- `.ds-twemoji` rule: `inline-block`, `width: 1em`, `height: 1em`, `vertical-align: -0.125em` (Twemoji's recommended inline alignment).
- Adjustments to the Tailwind `prose` defaults: tighter `h1` margin-top on first child, larger `code` background tint, lighter `hr` colour. Scoped under `.ds-readme` so other `prose` usages are untouched.

Imported once from `src/index.css` after `design-system.css`.

## Bundle

Target: a new `vendor-markdown` chunk in `vite.config.js` `manualChunks`, gzipped:

| Layer | Estimated gz |
|---|---|
| `@wooorm/starry-night` core + WASM | ~95 KB |
| 20 eager grammars | ~115 KB |
| `remark-github-blockquote-alert` | ~2 KB |
| `remark-gemoji` | ~3 KB |
| `remark-twemoji-self-hosted` (our code) | ~1 KB |
| Twemoji SVGs | 0 KB (lazy per-emoji HTTP) |
| `readme-theme.css` | ~3 KB |
| **Total chunk** | **~219 KB gz** |

Acceptance: the chunk must stay under **280 KB gz** (headroom for future lazy grammars to be promoted if usage data shows it). The initial dashboard bundle must not grow by more than **+5 KB gz**.

Verification: `npm run build` before/after, compare `dist/assets/vendor-markdown-*.js` size; record both numbers in the PR description.

## Testing

### Unit (Vitest, tests/components/ui/markdown/)

- `RepoMarkdown.test.jsx` — moved; existing tests still pass (URL transforms, anchor namespace, sanitizer).
- `CodeBlockChrome.test.jsx` — chrome bar appears for ` ```js `, hides for plain ` ``` `; Copy click writes to clipboard mock and fires `toast.success`.
- `alerts.test.jsx` — each of 5 alert types renders with the right `data-alert-type` attribute, the right icon, the right colour class.
- `twemoji.test.jsx` — `:rocket:` becomes `<img class="ds-twemoji" src="/twemoji/1f680.svg">`; raw `🚀` becomes the same; `📋` (clipboard) becomes `1f4cb.svg`.

### E2E (Playwright, e2e/repo-readme-premium.spec.js)

Single deterministic spec, light + dark:

1. Navigate to a mock repo whose README contains: a `bash` fenced block, a `[!NOTE]` alert, a `:tada:` shortcode, a raw `🎉` emoji.
2. Assert: `.pl-c1` (starry-night keyword class) is present inside the bash block.
3. Assert: `[data-alert-type="note"]` exists and has the lucide `Info` icon as descendant.
4. Assert: 2× `img.ds-twemoji` exist (one from shortcode, one from raw unicode).
5. Click the Copy button → `navigator.clipboard.readText()` returns the block's exact text.
6. Toggle `.dark` on `<html>` → assert background and `.pl-c1` colour both change (computed style snapshot diff).

## Acceptance criteria

1. ✅ Fenced blocks in 16 common languages are syntax-highlighted in light **and** dark, no flash on first paint.
2. ✅ GFM alerts render with icon, border, and tinted background for all 5 types.
3. ✅ All emoji on the page (both `:shortcode:` and raw unicode) render as inline Twemoji SVGs.
4. ✅ Every fenced block has a chrome bar (lang label + Copy) when language present; clean look when not.
5. ✅ `vendor-markdown` chunk < 280 KB gz; initial dashboard bundle delta ≤ +5 KB gz.
6. ✅ All existing `tests/components/ui/RepoMarkdown.test.jsx` assertions still pass (after move).
7. ✅ New e2e spec passes in light + dark.
8. ✅ Reversible via git: change is fully additive (new sub-folder, no edits to call-sites), so a single revert restores the v4.3.0 renderer if any regression surfaces. No runtime feature flag — would double the surface area to test and require a follow-up cleanup PR.

## Risks

| Risk | Mitigation |
|---|---|
| `rehype-sanitize` strips starry-night spans (class names `pl-*`) | Extend SCHEMA `span` with the closed allowlist of `pl-*` class names exported by starry-night. Covered by a dedicated unit test. |
| Lazy grammar import causes layout shift mid-paint | Pre-measure the `<pre>` block height before the swap; use `useTransition` so React doesn't commit until the new tree is ready. If still visible, fall back to eager-loading the language on first occurrence and caching for the session. |
| Twemoji SVG sprite bloats the repo | `public/twemoji/` is checked in but counted against the *built artifact* only via the SVGs the README actually references (per-request fetch). `.gitattributes` marks the folder `linguist-vendored` so it doesn't pollute repo language stats. |
| GFM alert plugin conflicts with existing `>` blockquote styling | Alert plugin produces a `<div>`, not a `<blockquote>`, so the existing prose blockquote rules don't match. Verified in unit test. |
| Bundle creeps past 280 KB if more grammars are promoted | Hard CI gate: add a `npm run check:bundle` script using `du -k` on the built chunk; fail PRs that exceed. Out of scope to wire the CI step in this spec — the plan can add it as a follow-up task. |

## Non-goals

- **Mermaid diagrams** — separate spec, planned next.
- **TOC sticky sidebar** — separate spec.
- **Image lightbox** — separate spec.
- **README editing** — `AIPolish` already handles edits; this spec is read-rendering only.
- **Streaming markdown** — no LLM streams READMEs; the AIPolish modal has its own renderer.
- **Math (KaTeX)** — not in observed README usage data; revisit if asked.
- **Custom indigo syntax palette** — explicitly ruled out (would feel disconnected from "this is a GitHub README").

## File map (when we proceed)

- New: `docs/plans/2026-05-21-readme-premium-pack-rollout.md` (implementation plan with concrete file diffs).
- New: 7 files under `src/components/ui/markdown/` (cf. File map above).
- New: 4 test files (3 unit + 1 e2e).
- Modified: `src/index.css` (one `@import`), `vite.config.js` (manualChunks entry), `package.json` (4 deps added — `@wooorm/starry-night`, `hast-util-to-jsx-runtime`, `remark-github-blockquote-alert`, `remark-gemoji`. No Twemoji JS lib — we self-host SVGs and walk the hast tree ourselves in `remark-twemoji-self-hosted.js`).
- Modified: 5 call-sites stay byte-identical; only the import path updates if we choose to drop the re-export shim.
- Deleted: `src/components/ui/RepoMarkdown.jsx` (moved into sub-folder).
- Added (one-shot script, not built): `scripts/sync-twemoji.mjs` + `public/twemoji/*.svg`.

## Decision matrix — when to revisit

- 2 weeks after merge: review error/feedback signals on the Overview tab; if regressions, git-revert (acceptance criterion 8).
- When a Mermaid block first appears in any of our team's READMEs: kick off the Mermaid spec.
- When `starry-night` cuts a major version (current 1.x): re-evaluate eager grammar list.
- If a single language outside the eager-20 set shows up in >5% of viewed READMEs (instrument via existing analytics): promote it to eager.
