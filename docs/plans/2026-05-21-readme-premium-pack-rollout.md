# README Premium Pack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every repo's README better than github.com — syntax-highlighted code (GitHub default light+dark via starry-night), GFM alerts (NOTE/TIP/IMPORTANT/WARNING/CAUTION), Twemoji emoji, and a copy-able chrome bar on each code block — without rewriting the existing react-markdown pipeline.

**Architecture:** Additive layers on the current `RepoMarkdown.jsx`. Move the file into a new `src/components/ui/markdown/` sub-folder and add (a) one rehype plugin (`starry-night`), (b) two remark plugins (`github-blockquote-alert`, `gemoji` + our own twemoji walker), (c) one React component (`CodeBlockChrome`), (d) one CSS file (`readme-theme.css`). The five existing call-sites import the same name from the same path — only the module resolves to the new sub-folder.

**Tech Stack:** React 19, Vite 8, Tailwind v4, react-markdown 10, `@wooorm/starry-night` (new), `hast-util-to-jsx-runtime` (new), `remark-github-blockquote-alert` (new), `remark-gemoji` (new), Twemoji SVGs (self-hosted in `public/twemoji/`).

**Spec:** [`docs/specs/2026-05-21-readme-premium-pack-design.md`](../specs/2026-05-21-readme-premium-pack-design.md).

---

## Pre-flight (read once, do not skip)

- Project uses `.jsx` only (no TS). Tailwind utility classes only, no global element selectors. Design-system classes use `ds-*` prefix.
- Commit style is Conventional Commits, **no `Co-Authored-By` lines**, subject ≤ 72 chars.
- Test runners: `npm run test` (Vitest, ESM, happy-dom) and `npm run test:e2e` (Playwright).
- `lint-staged` runs `eslint --max-warnings 0` on staged files — every step that touches `.jsx`/`.js`/`.css` will be linted at commit time. Fix lint errors before committing.
- New `src/**` files must not statically import from `src/__mocks__/` (the project has a `check-no-static-mock-imports.mjs` lint-staged hook). Tests can.
- Plans go under `docs/plans/`, specs under `docs/specs/` — both already exist.

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `src/components/ui/markdown/RepoMarkdown.jsx` | New (moved) | Public component; orchestrates plugins + components |
| `src/components/ui/markdown/CodeBlockChrome.jsx` | New | Header bar (language label + Copy button) for each `<pre>` |
| `src/components/ui/markdown/rehype-starry-night.js` | New | Hast transformer that tokenises `<code>` children with starry-night |
| `src/components/ui/markdown/remark-twemoji-self-hosted.js` | New | mdast text walker; replaces unicode emoji with `<img class="ds-twemoji" src="/twemoji/{cp}.svg">` |
| `src/components/ui/markdown/grammars-common.js` | New | 20 eager-loaded starry-night grammars |
| `src/components/ui/markdown/grammars-lazy.js` | New | Record of dynamic-import grammar loaders for on-demand languages |
| `src/components/ui/markdown/index.js` | New | Re-export shim: `export { RepoMarkdown } from './RepoMarkdown'` |
| `src/components/ui/RepoMarkdown.jsx` | Rewritten as a 1-line shim | Keeps the 5 existing call-sites untouched |
| `src/components/ui/__rehype-slug-inline.js` | Unchanged | Existing inline-slug plugin; only the import path from inside RepoMarkdown changes |
| `src/styles/readme-theme.css` | New | starry-night light+dark `.pl-*` rules + alert tints + twemoji inline sizing + prose overrides — all scoped under `.ds-readme` |
| `src/index.css` | Modified | `@import "./styles/readme-theme.css";` near the top |
| `vite.config.js` | Modified | Extend `vendor-markdown` chunk matcher to include the new deps |
| `scripts/check-bundle-size.mjs` | Modified | Add `'vendor-markdown-': { maxGzipKB: 280, name: 'vendor-markdown' }` |
| `scripts/sync-twemoji.mjs` | New | One-shot Node script: downloads pinned Twemoji SVG set into `public/twemoji/` |
| `public/twemoji/*.svg` | New (committed) | ~3500 SVGs (pinned, regenerated only via `sync-twemoji.mjs`) |
| `tests/components/ui/markdown/RepoMarkdown.test.jsx` | Moved + 1 test updated | Pre-existing 10 tests; the Shiki one is rewritten for starry-night |
| `tests/components/ui/markdown/CodeBlockChrome.test.jsx` | New | Copy button + lang-label visibility |
| `tests/components/ui/markdown/alerts.test.jsx` | New | All 5 alert types + light/dark class application |
| `tests/components/ui/markdown/twemoji.test.jsx` | New | Shortcode + raw unicode → `<img class="ds-twemoji">` |
| `tests/components/ui/RepoMarkdown.test.jsx` | **Deleted** | Replaced by the moved version |
| `e2e/repo-readme-premium.spec.js` | New | Light+dark golden path: highlight class + alert + twemoji + copy |
| `package.json` | Modified | 4 deps added |

---

## Task 1: Install dependencies + add bundle budget entry

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `scripts/check-bundle-size.mjs` (the `BUDGETS` literal)

- [ ] **Step 1: Add the 4 production deps**

Run:

```bash
npm install --save @wooorm/starry-night@^1 hast-util-to-jsx-runtime@^2 remark-github-blockquote-alert@^2 remark-gemoji@^9
```

Expected: 4 packages added, no peer-dep warnings (react 19 is compatible). `package.json` lists all four under `dependencies`.

- [ ] **Step 2: Verify install**

Run:

```bash
npm ls @wooorm/starry-night hast-util-to-jsx-runtime remark-github-blockquote-alert remark-gemoji
```

Expected: each prints a single version, no `UNMET` or `extraneous`.

- [ ] **Step 3: Add the bundle budget**

Edit `scripts/check-bundle-size.mjs`. After the `'vendor-charts-':` entry (currently the last in `BUDGETS`), add:

```js
    // vendor-markdown — react-markdown (existing) + starry-night core + 20 eager
    // grammars + GFM alerts + gemoji. Spec ceiling: 280 KB gzip with headroom
    // for grammar promotions. See docs/plans/2026-05-21-readme-premium-pack-rollout.md.
    'vendor-markdown-': { maxGzipKB: 280, name: 'vendor-markdown' },
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json scripts/check-bundle-size.mjs
git commit -m "chore(readme): add starry-night + gfm-alerts + gemoji deps; vendor-markdown budget 280 KB"
```

---

## Task 2: Create the new sub-folder and re-export shim (no behaviour change)

Goal: introduce the new path **without** touching the 5 call-sites. Move the file (git mv) so git tracks the rename, add an `index.js` re-export, and keep the old `src/components/ui/RepoMarkdown.jsx` as a 1-line re-export shim that points at the new folder.

**Files:**
- Move: `src/components/ui/RepoMarkdown.jsx` → `src/components/ui/markdown/RepoMarkdown.jsx`
- Create: `src/components/ui/markdown/index.js`
- Create: `src/components/ui/RepoMarkdown.jsx` (new file, 1-line re-export shim)
- Move: `tests/components/ui/RepoMarkdown.test.jsx` → `tests/components/ui/markdown/RepoMarkdown.test.jsx`

- [ ] **Step 1: Create the markdown folder and move the source file**

```bash
mkdir src/components/ui/markdown
git mv src/components/ui/RepoMarkdown.jsx src/components/ui/markdown/RepoMarkdown.jsx
```

- [ ] **Step 2: Update the moved file's import for `rehypeSlugInline`**

Open `src/components/ui/markdown/RepoMarkdown.jsx` and change the import path:

```js
// before:
import { rehypeSlugInline } from './__rehype-slug-inline'

// after:
import { rehypeSlugInline } from '../__rehype-slug-inline'
```

(The underscore-prefixed file stays at `src/components/ui/`. Path goes up one level.)

- [ ] **Step 3: Write `src/components/ui/markdown/index.js`**

```js
export { RepoMarkdown } from './RepoMarkdown'
```

- [ ] **Step 4: Write the shim at `src/components/ui/RepoMarkdown.jsx`**

```js
// Re-export shim — the real implementation lives under ./markdown.
// Kept so the 5 existing call-sites can continue to import from
// '../ui/RepoMarkdown' without churn. Drop in a follow-up cleanup PR.
export { RepoMarkdown } from './markdown'
```

- [ ] **Step 5: Move the test file**

```bash
mkdir tests/components/ui/markdown
git mv tests/components/ui/RepoMarkdown.test.jsx tests/components/ui/markdown/RepoMarkdown.test.jsx
```

- [ ] **Step 6: Update the test's import path**

Open `tests/components/ui/markdown/RepoMarkdown.test.jsx` and change line 3:

```js
// before:
import { RepoMarkdown } from '../../../src/components/ui/RepoMarkdown'

// after:
import { RepoMarkdown } from '../../../../src/components/ui/markdown/RepoMarkdown'
```

- [ ] **Step 7: Run the existing tests to make sure nothing broke**

```bash
npm run test -- tests/components/ui/markdown/RepoMarkdown.test.jsx
```

Expected: **9 pass, 1 fail.** The failure is the existing `applies a Shiki language class` test — we have not added starry-night yet, AND we will rewrite the assertion in Task 4. Note the failure but leave it; it converts to PASS at the end of Task 4. If any OTHER test fails (e.g. import path resolution), fix before continuing.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/RepoMarkdown.jsx src/components/ui/markdown/ tests/components/ui/markdown/
git commit -m "refactor(readme): move RepoMarkdown into ui/markdown sub-folder (re-export shim)"
```

---

## Task 3: Write `readme-theme.css` and wire it into `src/index.css`

**Files:**
- Create: `src/styles/readme-theme.css`
- Modify: `src/index.css` (add `@import`)

- [ ] **Step 1: Create the directory**

```bash
mkdir -p src/styles
```

- [ ] **Step 2: Write `src/styles/readme-theme.css`**

This file ships GitHub's light + dark `.pl-*` classes scoped under `.ds-readme`, plus the alert tints and the twemoji inline rule. All rules scoped under `.ds-readme` so other `prose` usages elsewhere in the app are not affected.

```css
/* starry-night — GitHub default LIGHT theme, scoped to README content */
.ds-readme {
    /* paste contents of node_modules/@wooorm/starry-night/style/light.css here,
       with every selector prefixed with ".ds-readme ". Example transformation:
         .pl-c { color: #6e7781; } -> .ds-readme .pl-c { color: #6e7781; }
       Copy verbatim from the installed file so the rules stay in sync. */
}

/* starry-night — GitHub default DARK theme, swapped via the .dark variant */
:where(.dark) .ds-readme {
    /* paste contents of node_modules/@wooorm/starry-night/style/dark.css here,
       same transformation. :where() keeps specificity equal so cascade order
       alone determines which wins. */
}

/* GFM alerts (NOTE / TIP / IMPORTANT / WARNING / CAUTION) */
.ds-readme .markdown-alert {
    border-left: 4px solid var(--alert-color, theme('colors.slate.400'));
    background: var(--alert-bg-light, theme('colors.slate.50'));
    padding: 0.75rem 1rem;
    margin: 1rem 0;
    border-radius: 0.5rem;
}
:where(.dark) .ds-readme .markdown-alert {
    background: var(--alert-bg-dark, theme('colors.slate.900'));
}
.ds-readme .markdown-alert-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    color: var(--alert-color);
}
.ds-readme .markdown-alert-note      { --alert-color: theme('colors.blue.600');   --alert-bg-light: theme('colors.blue.50');   --alert-bg-dark: theme('colors.blue.950'); }
.ds-readme .markdown-alert-tip       { --alert-color: theme('colors.green.600');  --alert-bg-light: theme('colors.green.50');  --alert-bg-dark: theme('colors.green.950'); }
.ds-readme .markdown-alert-important { --alert-color: theme('colors.violet.600'); --alert-bg-light: theme('colors.violet.50'); --alert-bg-dark: theme('colors.violet.950'); }
.ds-readme .markdown-alert-warning   { --alert-color: theme('colors.amber.600');  --alert-bg-light: theme('colors.amber.50');  --alert-bg-dark: theme('colors.amber.950'); }
.ds-readme .markdown-alert-caution   { --alert-color: theme('colors.red.600');    --alert-bg-light: theme('colors.red.50');    --alert-bg-dark: theme('colors.red.950'); }
:where(.dark) .ds-readme .markdown-alert-note      { --alert-color: theme('colors.blue.400'); }
:where(.dark) .ds-readme .markdown-alert-tip       { --alert-color: theme('colors.green.400'); }
:where(.dark) .ds-readme .markdown-alert-important { --alert-color: theme('colors.violet.400'); }
:where(.dark) .ds-readme .markdown-alert-warning   { --alert-color: theme('colors.amber.400'); }
:where(.dark) .ds-readme .markdown-alert-caution   { --alert-color: theme('colors.red.400'); }

/* Twemoji inline sizing (Twitter recommended baseline alignment) */
.ds-twemoji {
    display: inline-block;
    width: 1em;
    height: 1em;
    vertical-align: -0.125em;
}

/* prose overrides scoped to README only */
.ds-readme :first-child { margin-top: 0; }
.ds-readme code:not(pre code) {
    background: rgb(175 184 193 / 0.2);
    padding: 0.125em 0.3em;
    border-radius: 0.25rem;
    font-size: 0.875em;
}
:where(.dark) .ds-readme code:not(pre code) {
    background: rgb(110 118 129 / 0.3);
}
.ds-readme hr { border-color: theme('colors.slate.200'); }
:where(.dark) .ds-readme hr { border-color: theme('colors.slate.800'); }
```

For the starry-night `.pl-*` blocks, paste the full contents from `node_modules/@wooorm/starry-night/style/light.css` (or `dark.css`) with the scoping prefix. Do not hand-write the rules — copy them verbatim from the installed file so they stay in sync with the package.

- [ ] **Step 3: Wire the file into `src/index.css`**

Open `src/index.css`. After line 1 (`@import "tailwindcss";`), insert:

```css
@import "./styles/readme-theme.css";
```

- [ ] **Step 4: Run the build to make sure nothing breaks**

```bash
npm run dev
```

Expected: dev server starts, no PostCSS errors, no Tailwind `theme()` resolution warnings. Stop the server (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add src/styles/readme-theme.css src/index.css
git commit -m "feat(readme): add scoped css palette (starry-night light+dark, alerts, twemoji)"
```

---

## Task 4: Build the starry-night plugin + grammar registries + sanitizer SCHEMA (TDD)

We add syntax highlighting end-to-end: the plugin, the eager grammar registry, the sanitizer allowlist for the spans starry-night emits, and we wire it into `RepoMarkdown.jsx`. We finish by converting the failing Shiki test from Task 2.

**Files:**
- Create: `src/components/ui/markdown/grammars-common.js`
- Create: `src/components/ui/markdown/grammars-lazy.js`
- Create: `src/components/ui/markdown/rehype-starry-night.js`
- Modify: `src/components/ui/markdown/RepoMarkdown.jsx` (plugin pipeline + SCHEMA)
- Modify: `tests/components/ui/markdown/RepoMarkdown.test.jsx` (the Shiki test)

- [ ] **Step 1: Write `grammars-common.js`**

```js
// 20 eager-loaded starry-night grammars covering the top GitHub languages.
// Total weight: ~115 KB gzip in the vendor-markdown chunk. Any language
// outside this set is fetched on demand via grammars-lazy.js.
import sourceTs       from '@wooorm/starry-night/source.ts'
import sourceTsx      from '@wooorm/starry-night/source.tsx'
import sourceJs       from '@wooorm/starry-night/source.js'
import sourceJsx      from '@wooorm/starry-night/source.js.jsx'
import sourceJson     from '@wooorm/starry-night/source.json'
import sourceYaml     from '@wooorm/starry-night/source.yaml'
import sourceShell    from '@wooorm/starry-night/source.shell'
import sourcePython   from '@wooorm/starry-night/source.python'
import sourceGo       from '@wooorm/starry-night/source.go'
import sourceRust     from '@wooorm/starry-night/source.rust'
import sourceJava     from '@wooorm/starry-night/source.java'
import sourceCs       from '@wooorm/starry-night/source.cs'
import sourceCpp      from '@wooorm/starry-night/source.c++'
import sourceC        from '@wooorm/starry-night/source.c'
import sourcePhp      from '@wooorm/starry-night/source.php'
import sourceRuby     from '@wooorm/starry-night/source.ruby'
import sourceSql      from '@wooorm/starry-night/source.sql'
import sourceHtml     from '@wooorm/starry-night/text.html.basic'
import sourceCss      from '@wooorm/starry-night/source.css'
import sourceMarkdown from '@wooorm/starry-night/text.md'

export const COMMON_GRAMMARS = [
    sourceTs, sourceTsx, sourceJs, sourceJsx, sourceJson, sourceYaml,
    sourceShell, sourcePython, sourceGo, sourceRust, sourceJava, sourceCs,
    sourceCpp, sourceC, sourcePhp, sourceRuby, sourceSql, sourceHtml,
    sourceCss, sourceMarkdown,
]
```

If any import path above is wrong for the installed package version, run `ls node_modules/@wooorm/starry-night/` and adjust. starry-night exposes each grammar as its own entry point.

- [ ] **Step 2: Write `grammars-lazy.js`**

```js
// On-demand loader for grammars outside the eager-20. Keys are starry-night
// scope names (NOT the README triple-backtick language tag — that mapping
// happens in rehype-starry-night.js). Add entries here as analytics shows demand.
export const LAZY_GRAMMARS = {
    'source.kotlin':     () => import('@wooorm/starry-night/source.kotlin').then(m => m.default),
    'source.swift':      () => import('@wooorm/starry-night/source.swift').then(m => m.default),
    'source.lua':        () => import('@wooorm/starry-night/source.lua').then(m => m.default),
    'source.dart':       () => import('@wooorm/starry-night/source.dart').then(m => m.default),
    'source.r':          () => import('@wooorm/starry-night/source.r').then(m => m.default),
    'source.scala':      () => import('@wooorm/starry-night/source.scala').then(m => m.default),
    'source.haskell':    () => import('@wooorm/starry-night/source.haskell').then(m => m.default),
    'source.elixir':     () => import('@wooorm/starry-night/source.elixir').then(m => m.default),
    'source.dockerfile': () => import('@wooorm/starry-night/source.dockerfile').then(m => m.default),
    'source.makefile':   () => import('@wooorm/starry-night/source.makefile').then(m => m.default),
}
```

- [ ] **Step 3: Write `rehype-starry-night.js`**

```js
// Rehype plugin: tokenises every <pre><code class="language-xxx"> in the tree
// using starry-night. Async (the highlighter is async-constructed and lazy
// grammars come in via dynamic import). The sanitizer SCHEMA in RepoMarkdown.jsx
// allowlists span classNames starting with "pl-" so the spans survive.

import { createStarryNight } from '@wooorm/starry-night'
import { COMMON_GRAMMARS } from './grammars-common'
import { LAZY_GRAMMARS } from './grammars-lazy'

// Module-level singleton — building the highlighter is the expensive step
// (~50 ms first call). Reused across all RepoMarkdown renders.
let highlighterPromise = null
function getHighlighter() {
    if (!highlighterPromise) {
        highlighterPromise = createStarryNight(COMMON_GRAMMARS)
    }
    return highlighterPromise
}

// Map a README triple-backtick language tag to a starry-night scope name.
const ALIAS = {
    'sh': 'source.shell', 'bash': 'source.shell', 'zsh': 'source.shell',
    'console': 'source.shell', 'terminal': 'source.shell',
    'js': 'source.js', 'javascript': 'source.js',
    'ts': 'source.ts', 'typescript': 'source.ts',
    'tsx': 'source.tsx',
    'jsx': 'source.js.jsx',
    'py': 'source.python',
    'rb': 'source.ruby',
    'yml': 'source.yaml', 'yaml': 'source.yaml',
    'md': 'text.md', 'markdown': 'text.md',
    'html': 'text.html.basic',
    'cpp': 'source.c++', 'c++': 'source.c++', 'cxx': 'source.c++',
    'cs': 'source.cs', 'csharp': 'source.cs',
}

function flagFromClassName(className) {
    if (!className) return null
    const arr = Array.isArray(className) ? className : String(className).split(/\s+/)
    for (const c of arr) {
        const m = String(c).match(/^language-(.+)$/)
        if (m) return m[1].toLowerCase()
    }
    return null
}

function textOfCodeNode(codeNode) {
    let out = ''
    for (const child of codeNode.children || []) {
        if (child.type === 'text') out += child.value
    }
    return out
}

export function rehypeStarryNight() {
    return async function transformer(tree) {
        const items = []
        function visit(node, parent) {
            if (node.type === 'element' && node.tagName === 'code' && parent?.type === 'element' && parent.tagName === 'pre') {
                const flag = flagFromClassName(node.properties?.className)
                if (flag) items.push({ node, flag })
            }
            for (const c of node.children || []) visit(c, node)
        }
        visit(tree, null)
        if (items.length === 0) return

        const sn = await getHighlighter()

        for (const { node, flag } of items) {
            let scope = sn.flagToScope(flag) || ALIAS[flag] || null
            if (!scope) continue

            if (!sn.scopes().includes(scope) && LAZY_GRAMMARS[scope]) {
                const grammar = await LAZY_GRAMMARS[scope]()
                await sn.register([grammar])
            }
            if (!sn.scopes().includes(scope)) continue

            const text = textOfCodeNode(node)
            const fragment = sn.highlight(text, scope) // hast root
            node.children = fragment.children
        }
    }
}
```

- [ ] **Step 4: Wire the plugin and update SCHEMA in `RepoMarkdown.jsx`**

Edit `src/components/ui/markdown/RepoMarkdown.jsx`:

After the existing `import { rehypeSlugInline } from '../__rehype-slug-inline'` line, add:

```js
import { rehypeStarryNight } from './rehype-starry-night'
```

starry-night class taxonomy is closed (~30 classes documented in the package README). Hard-code the list and replace the existing SCHEMA:

```js
const STARRY_NIGHT_CLASSES = [
    'pl-c', 'pl-c1', 'pl-cce', 'pl-cn', 'pl-corl', 'pl-e', 'pl-en', 'pl-ent',
    'pl-ii', 'pl-k', 'pl-mb', 'pl-md', 'pl-mdh', 'pl-mdht', 'pl-mdr', 'pl-mh',
    'pl-mi', 'pl-mi1', 'pl-mp', 'pl-mp1', 'pl-ms', 'pl-pds', 'pl-pse',
    'pl-pse-v1', 'pl-pse-v2', 'pl-s', 'pl-s1', 'pl-sg', 'pl-smi', 'pl-smp',
    'pl-sr', 'pl-sra', 'pl-sre', 'pl-srm', 'pl-ss', 'pl-sx', 'pl-v',
]

const SCHEMA = {
    ...defaultSchema,
    clobberPrefix: 'readme-',
    attributes: {
        ...defaultSchema.attributes,
        div: [...(defaultSchema.attributes?.div || []), 'align'],
        p:   [...(defaultSchema.attributes?.p   || []), 'align'],
        img: [...(defaultSchema.attributes?.img || []), 'width', 'height', 'align'],
        h1:  [...(defaultSchema.attributes?.h1  || []), 'id'],
        h2:  [...(defaultSchema.attributes?.h2  || []), 'id'],
        h3:  [...(defaultSchema.attributes?.h3  || []), 'id'],
        h4:  [...(defaultSchema.attributes?.h4  || []), 'id'],
        h5:  [...(defaultSchema.attributes?.h5  || []), 'id'],
        h6:  [...(defaultSchema.attributes?.h6  || []), 'id'],
        span: [
            ...(defaultSchema.attributes?.span || []),
            ['className', ...STARRY_NIGHT_CLASSES],
        ],
    },
}
```

Update the rehype pipeline — add `rehypeStarryNight` BEFORE `rehypeSanitize`:

```jsx
rehypePlugins={[rehypeRaw, rehypeSlugInline, rehypeStarryNight, [rehypeSanitize, SCHEMA]]}
```

**Order critical:** `rehypeStarryNight` runs BEFORE `rehypeSanitize` so the sanitizer validates the spans starry-night just produced.

- [ ] **Step 5: Update the existing Shiki test to assert starry-night**

Open `tests/components/ui/markdown/RepoMarkdown.test.jsx`. Find the test named `applies a Shiki language class…` and replace it entirely with:

```js
    it('syntax-highlights fenced JavaScript via starry-night', async () => {
        const md = '```javascript\nconst x = 1\n```'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        // starry-night runs asynchronously inside the rehype pipeline;
        // react-markdown commits the tree after the async transformer resolves.
        await new Promise(r => setTimeout(r, 50))
        const code = container.querySelector('pre code')
        // "const" is the keyword → starry-night emits class "pl-k"
        expect(code?.querySelector('.pl-k')?.textContent).toBe('const')
    })
```

- [ ] **Step 6: Run the test file**

```bash
npm run test -- tests/components/ui/markdown/RepoMarkdown.test.jsx
```

Expected: **all 10 pass**, including the new starry-night one.

If the new test fails because the highlighter has not resolved within 50 ms, increase the timeout to 200 ms. If it fails for another reason, check that `rehypeStarryNight` is actually in the plugin list and that the SCHEMA allows `span.className`.

- [ ] **Step 7: Manual smoke test**

```bash
npm run dev
```

Open the dashboard, navigate to any repo whose README has a fenced code block, confirm the code block is now coloured in both light and dark. Stop the server.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/markdown/grammars-common.js src/components/ui/markdown/grammars-lazy.js src/components/ui/markdown/rehype-starry-night.js src/components/ui/markdown/RepoMarkdown.jsx tests/components/ui/markdown/RepoMarkdown.test.jsx
git commit -m "feat(readme): syntax-highlight fenced blocks via starry-night"
```

---

## Task 5: Build `CodeBlockChrome.jsx` + tests (TDD)

The chrome bar wraps every `<pre>` with a header showing the language label and a Copy button. It hides itself when there is no language (clean look for plain triple-backtick blocks).

**Files:**
- Create: `tests/components/ui/markdown/CodeBlockChrome.test.jsx` (write FIRST)
- Create: `src/components/ui/markdown/CodeBlockChrome.jsx`
- Modify: `src/components/ui/markdown/RepoMarkdown.jsx` (use chrome as the `pre` component override)

- [ ] **Step 1: Write the failing test**

Create `tests/components/ui/markdown/CodeBlockChrome.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeBlockChrome } from '../../../../src/components/ui/markdown/CodeBlockChrome'

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('../../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: { success: toastSuccess, errorFromException: toastError } }),
}))

describe('CodeBlockChrome', () => {
    beforeEach(() => {
        toastSuccess.mockClear()
        toastError.mockClear()
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: vi.fn().mockResolvedValue(undefined) },
        })
    })

    it('shows the language label when a language is provided', () => {
        render(
            <CodeBlockChrome language="bash">
                <pre><code>echo hi</code></pre>
            </CodeBlockChrome>
        )
        expect(screen.getByText('bash')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /copy bash block/i })).toBeInTheDocument()
    })

    it('renders without a header bar when no language is provided', () => {
        const { container } = render(
            <CodeBlockChrome language={null}>
                <pre><code>plain text</code></pre>
            </CodeBlockChrome>
        )
        expect(container.querySelector('[data-testid="codeblock-header"]')).toBeNull()
        expect(container.querySelector('pre')).toBeTruthy()
    })

    it('copies the code text and shows a success toast on click', async () => {
        const user = userEvent.setup()
        render(
            <CodeBlockChrome language="bash" rawText="echo hi">
                <pre><code>echo hi</code></pre>
            </CodeBlockChrome>
        )
        await user.click(screen.getByRole('button', { name: /copy bash block/i }))
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('echo hi')
        expect(toastSuccess).toHaveBeenCalledWith('Copied')
    })

    it('shows an error toast when clipboard write fails', async () => {
        const user = userEvent.setup()
        navigator.clipboard.writeText = vi.fn().mockRejectedValue(new Error('denied'))
        render(
            <CodeBlockChrome language="bash" rawText="echo hi">
                <pre><code>echo hi</code></pre>
            </CodeBlockChrome>
        )
        await user.click(screen.getByRole('button', { name: /copy bash block/i }))
        expect(toastError).toHaveBeenCalled()
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test -- tests/components/ui/markdown/CodeBlockChrome.test.jsx
```

Expected: FAIL — `Cannot find module '.../CodeBlockChrome'`.

- [ ] **Step 3: Write `CodeBlockChrome.jsx`**

```jsx
import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { useToast } from '../../../hooks/useToast'

/**
 * Wraps a <pre><code> rendered by react-markdown with a header bar
 * (language label + Copy button). Header hides when language is null.
 * The actual code content is whatever <pre>/<code> tree react-markdown
 * passes as children — we never re-tokenise here; starry-night already
 * did that upstream in rehype-starry-night.
 */
export function CodeBlockChrome({ language, rawText, children }) {
    const { toast } = useToast()
    const [justCopied, setJustCopied] = useState(false)

    async function onCopy() {
        try {
            await navigator.clipboard.writeText(rawText || '')
            toast.success('Copied')
            setJustCopied(true)
            setTimeout(() => setJustCopied(false), 1500)
        } catch (e) {
            toast.errorFromException(e, { fallbackTitle: 'Copy failed' })
        }
    }

    if (!language) {
        return <>{children}</>
    }

    return (
        <div className="ds-codeblock my-3 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800">
            <div
                data-testid="codeblock-header"
                className="flex items-center justify-between px-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800"
            >
                <span className="font-mono">{language}</span>
                <button
                    type="button"
                    onClick={onCopy}
                    aria-label={`Copy ${language} block`}
                    className="inline-flex items-center gap-1 opacity-60 hover:opacity-100 transition ds-focus-ring rounded px-1.5 py-0.5"
                >
                    {justCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{justCopied ? 'Copied' : 'Copy'}</span>
                </button>
            </div>
            {children}
        </div>
    )
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test -- tests/components/ui/markdown/CodeBlockChrome.test.jsx
```

Expected: 4 PASS.

- [ ] **Step 5: Wire `CodeBlockChrome` into `RepoMarkdown.jsx`**

Add the import near the top:

```js
import { CodeBlockChrome } from './CodeBlockChrome'
```

In the existing `components={{ ... }}` prop passed to `<ReactMarkdown>`, REMOVE the current `code:` override (starry-night handles tokenisation now) and ADD a `pre:` override:

```jsx
components={{
    a: ({ node, ...props }) => (
        // eslint-disable-next-line jsx-a11y/anchor-has-content -- children come from react-markdown
        <a {...props} target="_blank" rel="noopener noreferrer" />
    ),
    pre: ({ node, children, ...rest }) => {
        const codeNode = node?.children?.[0]
        const className = codeNode?.properties?.className
        const flag = Array.isArray(className)
            ? (className.find(c => /^language-/.test(c)) || '').replace(/^language-/, '') || null
            : null
        // Recover the raw source by walking text children of the original code node.
        const rawText = (function walk(n) {
            if (!n) return ''
            if (n.type === 'text') return n.value
            return (n.children || []).map(walk).join('')
        })(codeNode)
        return (
            <CodeBlockChrome language={flag} rawText={rawText}>
                <pre {...rest}>{children}</pre>
            </CodeBlockChrome>
        )
    },
}}
```

- [ ] **Step 6: Run the full markdown test folder to confirm nothing regressed**

```bash
npm run test -- tests/components/ui/markdown/
```

Expected: all 14 tests PASS (10 RepoMarkdown + 4 CodeBlockChrome).

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/markdown/CodeBlockChrome.jsx src/components/ui/markdown/RepoMarkdown.jsx tests/components/ui/markdown/CodeBlockChrome.test.jsx
git commit -m "feat(readme): code block chrome (language label + copy button)"
```

---

## Task 6: GFM Alerts plugin + lucide icons + tests (TDD)

**Files:**
- Create: `tests/components/ui/markdown/alerts.test.jsx`
- Modify: `src/components/ui/markdown/RepoMarkdown.jsx` (plugin + lucide icon injection)

- [ ] **Step 1: Write the failing test**

Create `tests/components/ui/markdown/alerts.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { RepoMarkdown } from '../../../../src/components/ui/markdown/RepoMarkdown'

const PROPS = { owner: 'octocat', repo: 'demo', branch: 'main' }

const TYPES = [
    { tag: 'NOTE',      cls: 'markdown-alert-note',      title: 'Note' },
    { tag: 'TIP',       cls: 'markdown-alert-tip',       title: 'Tip' },
    { tag: 'IMPORTANT', cls: 'markdown-alert-important', title: 'Important' },
    { tag: 'WARNING',   cls: 'markdown-alert-warning',   title: 'Warning' },
    { tag: 'CAUTION',   cls: 'markdown-alert-caution',   title: 'Caution' },
]

describe('RepoMarkdown — GFM alerts', () => {
    for (const t of TYPES) {
        it(`renders [!${t.tag}] as a styled alert div`, () => {
            const md = `> [!${t.tag}]\n> body text`
            const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
            const alert = container.querySelector(`.${t.cls}`)
            expect(alert).toBeTruthy()
            expect(alert.textContent).toContain(t.title)
            expect(alert.textContent).toContain('body text')
            // Sanitizer must not strip the alert into a plain <blockquote>
            expect(container.querySelector('blockquote')).toBeNull()
        })
    }

    it('still renders plain blockquotes for non-alert >', () => {
        const md = '> just a quote'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        expect(container.querySelector('blockquote')).toBeTruthy()
        expect(container.querySelector('.markdown-alert')).toBeNull()
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test -- tests/components/ui/markdown/alerts.test.jsx
```

Expected: 6 FAIL (5 alert types + 1 fallback baseline). The plugin is not wired yet, so `> [!NOTE]` renders as a plain blockquote.

- [ ] **Step 3: Wire the alert plugin into `RepoMarkdown.jsx`**

Add the import:

```js
import { remarkAlert } from 'remark-github-blockquote-alert'
```

Update `remarkPlugins`:

```jsx
remarkPlugins={[remarkGfm, remarkAlert]}
```

Update SCHEMA so the sanitizer accepts the alert div with the `markdown-alert*` class names. Replace the existing `div:` and `p:` entries inside SCHEMA `attributes` with:

```js
div: [
    ...(defaultSchema.attributes?.div || []),
    'align',
    ['className', 'markdown-alert', 'markdown-alert-note', 'markdown-alert-tip', 'markdown-alert-important', 'markdown-alert-warning', 'markdown-alert-caution'],
],
p: [
    ...(defaultSchema.attributes?.p || []),
    'align',
    ['className', 'markdown-alert-title'],
    'dataAlertType', // hast property name (camelCase). HTML attribute is data-alert-type.
],
```

- [ ] **Step 4: Add lucide icons to alert titles**

Inline rehype plugin in `RepoMarkdown.jsx` that walks alert divs and stamps each title `<p>` with a `data-alert-type` derived from the parent class. The React `components.p` mapping then reads that attribute to prepend the correct lucide icon.

Add imports:

```js
import { Info, Lightbulb, MessageSquareWarning, AlertTriangle, OctagonAlert } from 'lucide-react'
```

Add this constant and inline plugin near the top of the file:

```js
const ALERT_ICON = {
    note: Info,
    tip: Lightbulb,
    important: MessageSquareWarning,
    warning: AlertTriangle,
    caution: OctagonAlert,
}

function rehypeAlertIcons() {
    return (tree) => {
        function visit(node) {
            if (node.type === 'element' && node.tagName === 'div' && Array.isArray(node.properties?.className)) {
                const t = node.properties.className.find(c => /^markdown-alert-(note|tip|important|warning|caution)$/.test(c))
                if (t) {
                    const type = t.replace('markdown-alert-', '')
                    for (const c of node.children || []) {
                        if (c.type === 'element' && c.tagName === 'p' && c.properties?.className?.includes?.('markdown-alert-title')) {
                            // hast camelCase form — serialises to data-alert-type
                            // in the final HTML. SCHEMA must allowlist the same
                            // camelCase key (see RepoMarkdown.jsx SCHEMA.p).
                            c.properties.dataAlertType = type
                        }
                    }
                }
            }
            for (const c of node.children || []) visit(c)
        }
        visit(tree)
    }
}
```

Add `rehypeAlertIcons` to the pipeline BEFORE sanitize:

```jsx
rehypePlugins={[rehypeRaw, rehypeSlugInline, rehypeStarryNight, rehypeAlertIcons, [rehypeSanitize, SCHEMA]]}
```

Add a `p:` entry to the `components` mapping (extend the existing object):

```jsx
p: ({ node, children, ...rest }) => {
    const type = node?.properties?.dataAlertType
    if (type && ALERT_ICON[type]) {
        const Icon = ALERT_ICON[type]
        return (
            <p {...rest}>
                <Icon className="w-4 h-4" aria-hidden="true" />
                {children}
            </p>
        )
    }
    return <p {...rest}>{children}</p>
},
```

- [ ] **Step 5: Run the alerts test**

```bash
npm run test -- tests/components/ui/markdown/alerts.test.jsx
```

Expected: 6 PASS.

- [ ] **Step 6: Run the full markdown test folder**

```bash
npm run test -- tests/components/ui/markdown/
```

Expected: all 20 tests PASS (10 + 4 + 6).

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/markdown/RepoMarkdown.jsx tests/components/ui/markdown/alerts.test.jsx
git commit -m "feat(readme): GFM alerts (NOTE/TIP/IMPORTANT/WARNING/CAUTION) with lucide icons"
```

---

## Task 7: Twemoji — remark-gemoji + self-hosted SVG walker + sync script + tests

Two remark plugins (gemoji for shortcodes, our walker for unicode), a one-shot script to populate `public/twemoji/`, tests.

**Files:**
- Create: `scripts/sync-twemoji.mjs`
- Create: `public/twemoji/.gitkeep` (placeholder so the dir is committed even before the SVG dump)
- Create: `src/components/ui/markdown/remark-twemoji-self-hosted.js`
- Create: `tests/components/ui/markdown/twemoji.test.jsx`
- Modify: `src/components/ui/markdown/RepoMarkdown.jsx` (plugin list + SCHEMA `img` allowlist + urlTransform)
- Modify: `.gitattributes` (mark `public/twemoji/*` as `linguist-vendored`)

- [ ] **Step 1: Write the failing test**

Create `tests/components/ui/markdown/twemoji.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { RepoMarkdown } from '../../../../src/components/ui/markdown/RepoMarkdown'

const PROPS = { owner: 'octocat', repo: 'demo', branch: 'main' }

describe('RepoMarkdown — Twemoji', () => {
    it('replaces :rocket: shortcode with an <img class="ds-twemoji">', () => {
        const md = 'Launch :rocket: now'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        const img = container.querySelector('img.ds-twemoji')
        expect(img).toBeTruthy()
        expect(img?.getAttribute('src')).toMatch(/^\/twemoji\/1f680\.svg$/)
        expect(img?.getAttribute('alt')).toBe('🚀')
    })

    it('replaces raw unicode emoji with an <img class="ds-twemoji">', () => {
        const md = 'Hello 🎉 world'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        const img = container.querySelector('img.ds-twemoji')
        expect(img).toBeTruthy()
        expect(img?.getAttribute('src')).toMatch(/^\/twemoji\/1f389\.svg$/)
    })

    it('leaves regular text untouched', () => {
        const md = 'no emoji here'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        expect(container.querySelector('img.ds-twemoji')).toBeNull()
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test -- tests/components/ui/markdown/twemoji.test.jsx
```

Expected: 2 FAIL, 1 PASS (the "no emoji" case passes trivially).

- [ ] **Step 3: Write `remark-twemoji-self-hosted.js`**

```js
// Remark plugin: walks every text node, finds unicode emoji (RGI sequences),
// and replaces them with mdast image nodes whose URL points at
// /twemoji/{codepoint}.svg (served from public/). Runs AFTER remark-gemoji,
// so :rocket: shortcodes have already been turned into raw 🚀 unicode text.

const EMOJI_REGEX = /(\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic})*️?)/gu

function emojiToCodepoint(emoji) {
    // Twemoji filename convention: lower-case hex codepoints joined by '-',
    // with VS16 (U+FE0F) stripped (its presence in a sequence is implicit in
    // the SVG selection rules).
    return Array.from(emoji)
        .map(c => c.codePointAt(0))
        .filter(cp => cp !== 0xFE0F)
        .map(cp => cp.toString(16))
        .join('-')
}

function visit(node, parent, index, fn) {
    fn(node, parent, index)
    if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
            visit(node.children[i], node, i, fn)
        }
    }
}

export function remarkTwemojiSelfHosted() {
    return (tree) => {
        const items = []
        visit(tree, null, 0, (node, parent, index) => {
            if (node.type !== 'text' || !parent || index == null) return
            if (parent.type === 'code' || parent.type === 'inlineCode') return
            EMOJI_REGEX.lastIndex = 0
            if (!EMOJI_REGEX.test(node.value)) return
            EMOJI_REGEX.lastIndex = 0
            items.push({ node, parent, index })
        })

        for (const { node, parent, index } of items) {
            const newChildren = []
            let last = 0
            for (const match of node.value.matchAll(EMOJI_REGEX)) {
                const emoji = match[0]
                const start = match.index
                if (start > last) {
                    newChildren.push({ type: 'text', value: node.value.slice(last, start) })
                }
                const cp = emojiToCodepoint(emoji)
                newChildren.push({
                    type: 'image',
                    url: `/twemoji/${cp}.svg`,
                    alt: emoji,
                    data: { hProperties: { className: ['ds-twemoji'] } },
                })
                last = start + emoji.length
            }
            if (last < node.value.length) {
                newChildren.push({ type: 'text', value: node.value.slice(last) })
            }
            parent.children.splice(index, 1, ...newChildren)
        }
    }
}
```

- [ ] **Step 4: Wire both plugins into `RepoMarkdown.jsx`**

Add imports:

```js
import remarkGemoji from 'remark-gemoji'
import { remarkTwemojiSelfHosted } from './remark-twemoji-self-hosted'
```

Update `remarkPlugins`:

```jsx
remarkPlugins={[remarkGfm, remarkAlert, remarkGemoji, remarkTwemojiSelfHosted]}
```

(Order: gemoji turns `:rocket:` into 🚀; twemoji walker turns 🚀 into an image. Both run before rehype.)

Extend SCHEMA `img` allowlist to permit our class:

```js
img: [
    ...(defaultSchema.attributes?.img || []),
    'width', 'height', 'align',
    ['className', 'ds-twemoji'],
],
```

The `urlTransform` prop on `<ReactMarkdown>` currently rewrites image src for relative paths. We must let `/twemoji/...` pass through unchanged:

```jsx
urlTransform={(url, key) => {
    if (key === 'src' && typeof url === 'string' && url.startsWith('/twemoji/')) return url
    if (key === 'src') return transformImage(url)
    if (key === 'href') return transformLink(url)
    return url
}}
```

- [ ] **Step 5: Run the twemoji test**

```bash
npm run test -- tests/components/ui/markdown/twemoji.test.jsx
```

Expected: 3 PASS.

If a test fails because the `alt` does not equal the expected emoji, double-check `emojiToCodepoint` strips VS16 and lower-cases hex. If the image isn't found at all, confirm `remarkTwemojiSelfHosted` ran AFTER `remarkGemoji` in the plugin order.

- [ ] **Step 6: Write `scripts/sync-twemoji.mjs`**

```js
#!/usr/bin/env node
/**
 * One-shot: downloads the Twemoji SVG set from the upstream archive into
 * public/twemoji/. Pinned to a known release tag for reproducibility. Run
 * by hand when bumping Twemoji; the result is committed to the repo so the
 * production build does NOT need network access.
 *
 *   node scripts/sync-twemoji.mjs
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'

const TAG = 'v15.1.0' // Last MIT-licensed Twemoji release before Twitter rebrand
const ARCHIVE = `https://github.com/jdecked/twemoji/releases/download/${TAG}/twemoji-${TAG.slice(1)}.zip`
const OUT = 'public/twemoji'

console.log(`Downloading Twemoji ${TAG}…`)
const tmp = 'tmp-twemoji.zip'
const res = await fetch(ARCHIVE)
if (!res.ok) {
    console.error(`Failed to download ${ARCHIVE}: ${res.status}`)
    process.exit(1)
}
await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))

console.log(`Extracting SVG subset…`)
const { default: AdmZip } = await import('adm-zip')
const zip = new AdmZip(tmp)
await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })
let count = 0
for (const entry of zip.getEntries()) {
    if (entry.entryName.endsWith('.svg') && entry.entryName.includes('/svg/')) {
        const name = entry.entryName.split('/svg/')[1]
        await writeFile(join(OUT, name), entry.getData())
        count++
    }
}
await rm(tmp)
console.log(`Wrote ${count} SVGs to ${OUT}/`)
```

- [ ] **Step 7: Create the placeholder + .gitattributes entry**

```bash
mkdir -p public/twemoji
touch public/twemoji/.gitkeep
```

Append to `.gitattributes` (create the file if missing):

```text
public/twemoji/* linguist-vendored
```

- [ ] **Step 8: Run the sync script ONCE to populate the SVGs**

```bash
node scripts/sync-twemoji.mjs
```

Expected: prints "Wrote ~3500 SVGs to public/twemoji/", takes <30 s on broadband. `adm-zip` is already a project dep.

- [ ] **Step 9: Manual smoke**

```bash
npm run dev
```

Open any repo whose README has a `:rocket:` or a raw unicode emoji. Confirm it renders as a coloured Twemoji glyph. Stop the server.

- [ ] **Step 10: Commit (two commits — feature code + the asset dump separately)**

```bash
git add scripts/sync-twemoji.mjs src/components/ui/markdown/remark-twemoji-self-hosted.js src/components/ui/markdown/RepoMarkdown.jsx tests/components/ui/markdown/twemoji.test.jsx .gitattributes public/twemoji/.gitkeep
git commit -m "feat(readme): twemoji via remark-gemoji + self-hosted svg walker"

git add public/twemoji/
git commit -m "chore(readme): commit twemoji v15.1.0 svg set (~3500 files)"
```

---

## Task 8: Extend the vendor-markdown chunk in `vite.config.js`

**Files:**
- Modify: `vite.config.js` (`manualChunks` block)

- [ ] **Step 1: Update the matcher**

Open `vite.config.js`. Find the existing line:

```js
if (/[\\/]node_modules[\\/]react-markdown[\\/]/.test(id)) return 'vendor-markdown'
```

Replace with:

```js
if (/[\\/]node_modules[\\/](react-markdown|remark-gfm|remark-github-blockquote-alert|remark-gemoji|@wooorm[\\/]starry-night|hast-util-to-jsx-runtime|hast-util-to-string|mdast-util-.+|micromark-extension-.+|micromark-util-.+|remark-parse|remark-rehype|unified|unist-util-.+|vfile.*|character-entities.+|bail|trough|is-plain-obj|space-separated-tokens|comma-separated-tokens|property-information|ccount|markdown-table|stringify-entities)[\\/]/.test(id)) return 'vendor-markdown'
```

That regex catches the full transitive subtree the markdown stack pulls in — without it, half the unified/micromark/mdast packages land in `index-` and inflate the main bundle.

- [ ] **Step 2: Build and inspect chunk sizes**

```bash
npm run build
```

Expected: build succeeds. In the output, find the line for `vendor-markdown-*.js`. Note its brotli and gzip sizes. The gzip size should be in the 200–280 KB range.

```bash
npm run check:bundle-size
```

Expected: `✅ vendor-markdown ... within budget (280 KB)`.

If `vendor-markdown` exceeds 280 KB: identify the culprit via `npm run build:analyze` (opens the bundle treemap), trim eager grammars or promote them to lazy. Do NOT raise the budget without an explicit follow-up decision.

- [ ] **Step 3: Commit**

```bash
git add vite.config.js
git commit -m "build: route markdown subtree into vendor-markdown chunk"
```

---

## Task 9: E2E spec — light + dark golden path

**Files:**
- Create: `e2e/repo-readme-premium.spec.js`

The existing `e2e/repo-readme.spec.js` is skipped (pre-existing routing issue documented at its top). We follow its mock-API pattern but target the README via the dashboard's repo-card click instead of `page.goto('/repos/...')`, which sidesteps the routing skip.

- [ ] **Step 1: Write the spec**

Create `e2e/repo-readme-premium.spec.js`:

```js
import { test, expect } from '@playwright/test'

const REPO_OWNER = 'dev-user'
const REPO_NAME = 'premium-readme-demo'

const MOCK_REPO = {
    id: 99, name: REPO_NAME, full_name: `${REPO_OWNER}/${REPO_NAME}`,
    owner: { login: REPO_OWNER },
    private: false,
    html_url: `https://github.com/${REPO_OWNER}/${REPO_NAME}`,
    description: 'README premium fixture', language: 'JavaScript',
    stargazers_count: 0, watchers_count: 0, forks_count: 0, open_issues_count: 0,
    default_branch: 'main', archived: false, fork: false, topics: [],
}

function b64(s) { return Buffer.from(s, 'utf-8').toString('base64') }

const README_MD = [
    '# Hello',
    '',
    '```bash',
    'npm install premium',
    '```',
    '',
    '> [!NOTE]',
    '> Read this carefully.',
    '',
    'Launch :tada: now — also raw 🎉.',
].join('\n')

const MOCK_README = {
    name: 'README.md',
    path: 'README.md',
    content: b64(README_MD),
    encoding: 'base64',
}

async function mockApi(page) {
    const basePath = `/api/repos/${REPO_OWNER}/${REPO_NAME}`
    await page.route(new RegExp(`${basePath.replace(/\//g, '\\/')}(\\b|/|\\?|$)`), (route) => {
        const path = new URL(route.request().url()).pathname
        if (path === basePath) {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK_REPO) })
        }
        if (path === `${basePath}/readme`) {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MOCK_README) })
        }
        return route.fallback()
    })
    // Mock the repo list endpoint so the dashboard can render the card we
    // click to enter the repo detail view.
    await page.route(/\/api\/repos(\?.*)?$/, (route) => {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify([MOCK_REPO]) })
    })
}

test.describe('README premium rendering', () => {
    test('renders highlight + alert + twemoji + copy in light mode', async ({ page }) => {
        await mockApi(page)
        await page.goto('/')

        await page.getByText(REPO_NAME).first().click()
        await expect(page.getByRole('heading', { level: 1, name: /^Hello$/ })).toBeVisible()

        // starry-night emits .pl-* tokens — any of these means highlighting ran.
        await expect(page.locator('pre code .pl-en, pre code .pl-c, pre code .pl-s, pre code .pl-k')).not.toHaveCount(0)

        // Copy button + language label visible.
        await expect(page.getByText('bash')).toBeVisible()
        const copyBtn = page.getByRole('button', { name: /copy bash block/i })
        await expect(copyBtn).toBeVisible()

        // GFM alert renders as styled div with the data-alert-type stamp.
        await expect(page.locator('p[data-alert-type="note"]')).toBeVisible()
        await expect(page.getByText('Read this carefully.')).toBeVisible()

        // Twemoji: 2 images (one from :tada:, one from raw 🎉).
        await expect(page.locator('img.ds-twemoji')).toHaveCount(2)
    })

    test('switches highlight colours when dark mode is on', async ({ page }) => {
        await mockApi(page)
        await page.goto('/')
        await page.evaluate(() => document.documentElement.classList.add('dark'))
        await page.getByText(REPO_NAME).first().click()
        await expect(page.getByRole('heading', { level: 1, name: /^Hello$/ })).toBeVisible()

        const codeBg = await page.locator('pre').first().evaluate(el => getComputedStyle(el).backgroundColor)
        // GitHub default dark theme uses a near-black background; we assert
        // it is NOT the bright off-white rgb(246, 248, 250) of light mode.
        expect(codeBg).not.toBe('rgb(246, 248, 250)')
    })
})
```

- [ ] **Step 2: Start the dev server in another terminal**

```bash
npm run dev:all
```

Wait for both server and Vite to be ready (Vite prints "Local: http://localhost:5173").

- [ ] **Step 3: Run the spec**

```bash
npm run test:e2e -- e2e/repo-readme-premium.spec.js
```

Expected: 2 PASS.

If the alert assertion fails: confirm the `rehypeAlertIcons` plugin from Task 6 is wired and the SCHEMA passes the `data-alert-type` attribute (hast property name is `dataAlertType`).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add e2e/repo-readme-premium.spec.js
git commit -m "test(e2e): readme premium pack golden path (light + dark)"
```

---

## Task 10: Final verification — full test sweep + bundle measurement + visual confirmation

Gate before merging. No code changes, just verification.

- [ ] **Step 1: Run the entire unit test suite**

```bash
npm run test:run
```

Expected: 100% pass. If anything red, fix in a follow-up commit before moving on.

- [ ] **Step 2: Run the full e2e suite**

```bash
npm run test:e2e
```

Expected: all green. The pre-existing skipped tests stay skipped (do not touch them).

- [ ] **Step 3: Build and check bundle budgets**

```bash
npm run build
npm run check:bundle-size
```

Expected: all green, including the new `vendor-markdown` entry. Record the actual gzip size in the PR description.

- [ ] **Step 4: Visual confirmation (manual)**

```bash
npm run dev
```

Open the dashboard. Navigate into a real repo with a real README (pick one from your own account that has fenced code, an alert, and emoji). Toggle between light and dark via the theme switcher in the header. Confirm:

- Code blocks are coloured in both modes.
- The copy button works (click → toast appears, paste somewhere to verify).
- `> [!NOTE]` etc. render with icon + tinted background.
- Emoji render as Twemoji glyphs (consistent across OSes).

Stop the dev server.

- [ ] **Step 5: Final commit (only if Steps 1–4 surfaced minor fixes — otherwise skip)**

If nothing needed fixing, no commit. If you fixed something during this task, commit each fix with a focused message (`fix(readme): …`).

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin <your-branch>
gh pr create --title "feat(readme): premium pack — highlight, alerts, twemoji, copy chrome" --body "$(cat <<'EOF'
## Summary

Implements docs/specs/2026-05-21-readme-premium-pack-design.md (Plan: docs/plans/2026-05-21-readme-premium-pack-rollout.md).

- Syntax highlighting via @wooorm/starry-night (GitHub default light+dark, 20 eager grammars, lazy registry for the rest).
- GFM alerts ([!NOTE/TIP/IMPORTANT/WARNING/CAUTION]) with lucide icons.
- Twemoji emoji (shortcodes + raw unicode) via self-hosted SVG set in public/twemoji/.
- Code-block chrome: language label + Copy button.

## Bundle impact

- vendor-markdown chunk: <measured gzip> KB (budget 280 KB).
- Initial dashboard bundle delta: <measured> KB gzip.

## Test plan

- [x] All unit tests pass (npm run test:run).
- [x] All e2e specs pass (npm run test:e2e).
- [x] Bundle budget check passes (npm run check:bundle-size).
- [x] Manual visual confirmation in light + dark with a real-world README.
EOF
)"
```

---

## Spec coverage cross-check (self-review)

| Spec acceptance criterion | Task(s) |
|---|---|
| #1 Fenced highlight in 16+ langs | Tasks 1, 4 |
| #2 GFM alerts | Task 6 |
| #3 Twemoji | Task 7 |
| #4 Code-block chrome | Task 5 |
| #5 Bundle < 280 KB | Tasks 1 (budget) + 8 (chunk routing) + 10 (verification) |
| #6 Existing tests still pass after move | Task 2 + Task 4 (Shiki test rewrite) |
| #7 New e2e spec | Task 9 |
| #8 Reversible via git | Guaranteed by additive structure (re-export shim from Task 2, no behaviour change in call-sites) |
