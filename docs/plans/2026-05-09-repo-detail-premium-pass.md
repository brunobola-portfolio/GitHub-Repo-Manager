# Repo Detail Premium Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Repo Detail surface (Overview, Branches, Commits, PR diffs) to a uniform premium standard — render the README as real GitHub-faithful markdown, fix the Branches console noise and tighten its layout, and give commits the same Codex-style 3-column review surface that PRs already have.

**Architecture:** Three new isolated units (`RepoMarkdown`, `CodeReviewSurface`, `useDiffPreferences`) plus two refactors (`PRFilesTab` consumes the extracted surface; `CommitDetailPanel` rebuilt as a full-bleed modal that consumes it). One bug fix on the client error map. **No new runtime deps except `rehype-raw`** (for README HTML pass-through with sanitization).

**Tech Stack:** React 19, Vite 7, Tailwind v4, `react-markdown` v10, `remark-gfm`, `rehype-sanitize`, `rehype-raw` (new), Shiki (already loaded by `@git-diff-view/shiki`), `@git-diff-view/react`, Framer Motion, Vitest + React Testing Library, Playwright.

**Spec:** [docs/specs/2026-05-09-repo-detail-premium-pass.md](../specs/2026-05-09-repo-detail-premium-pass.md)

---

## File map

### New files

| Path | Responsibility |
|---|---|
| `src/components/ui/RepoMarkdown.jsx` | GitHub-faithful markdown renderer with relative-URL rewriting and Shiki code highlighting |
| `src/components/ui/__rehype-slug-inline.js` | 12-line inline rehype plugin that adds `id` to headings (avoids the `rehype-slug` dep) |
| `src/components/diff/CodeReviewSurface.jsx` | The 3-column review shell extracted from `PRFilesTab` |
| `src/components/diff/CodeReviewToolbar.jsx` | Top-bar controls (split/unified, wrap, tab-width, prev/next, file-tree toggle) |
| `src/hooks/useDiffPreferences.js` | LocalStorage-backed persistence for diff view preferences |
| `tests/components/ui/RepoMarkdown.test.jsx` | Markdown rendering, sanitization, URL resolution |
| `tests/components/diff/CodeReviewSurface.test.jsx` | Surface integration: file tree + diff + viewed marker |
| `tests/hooks/useDiffPreferences.test.js` | Round-trip through localStorage |
| `tests/components/RepoDetail/CommitDetailPanel.test.jsx` | Commit modal renders surface + storageKey scopes viewed set |
| `e2e/commit-diff-viewer.spec.js` | Open commit, switch split/unified, mark viewed, reload persists |
| `e2e/repo-readme.spec.js` | Markdown README renders with table + relative image |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add `rehype-raw` dependency |
| `src/utils/errors.js` | Add `GITHUB_PRO_REQUIRED` to `KNOWN_ERRORS` map |
| `src/components/RepoDetail/OverviewTab.jsx` | Replace `<pre>` README with `<RepoMarkdown />` |
| `src/components/RepoDetail/BranchesTab.jsx` | Search / sort / filter chips, branch row enrichment, default-branch pinning |
| `src/components/RepoDetail/BranchProtectionPanel.jsx` | Inline-collapsed variant on free-plan-private |
| `src/components/RepoDetail/CommitDetailPanel.jsx` | Rebuild around `CodeReviewSurface` |
| `src/components/RepoDetail/PRFilesTab.jsx` | Refactor to consume `CodeReviewSurface` (no UX change) |
| `src/components/PRReview/DiffPanel/DiffRenderer.jsx` | Wrap support, tab-width preprocessing |
| `src/components/ui/Modal.jsx` | Widen the `full` size to `max-w-[min(96vw,1600px)]` + `max-h-[92vh]` |

---

## Task ordering rationale

Slices land in dependency order: error-map fix and the markdown component are independent and ship first. Then the diff-prefs hook + Modal width tweak unblock the surface extraction. The PRFilesTab refactor must land before the CommitDetailPanel rebuild (so we extract once and consume twice). Branches polish lands anywhere — it's independent.

---

## Task 1: Add `GITHUB_PRO_REQUIRED` to the known-errors map

**Files:**
- Modify: `src/utils/errors.js`
- Test: `tests/utils/errors.test.js` (extend if exists, create otherwise)

- [ ] **Step 1: Locate the existing `KNOWN_ERRORS` map**

Run:
```
Grep -n "KNOWN_ERRORS = {" src/utils/errors.js
```

Open the file and read the surrounding lines (~50 above and below) so you understand the shape — entries look like `{ title, body, ... }`.

- [ ] **Step 2: Write the failing test**

Append to `tests/utils/errors.test.js` (or create it):

```js
import { describe, it, expect } from 'vitest'
import { formatUserError } from '../../src/utils/errors'

describe('formatUserError — GITHUB_PRO_REQUIRED', () => {
    it('maps a code: GITHUB_PRO_REQUIRED error to a calm message and never falls through to FALLBACK', () => {
        const err = Object.assign(new Error('Upgrade to GitHub Pro or make this repository public to enable this feature.'), {
            status: 403,
            code: 'GITHUB_PRO_REQUIRED',
        })
        const result = formatUserError(err)
        expect(result.code).toBe('GITHUB_PRO_REQUIRED')
        expect(result.title).toMatch(/branch protection|github pro/i)
        // Must not be the generic fallback title
        expect(result.title).not.toBe('Something went wrong')
    })

    it('does not log "unmapped error" warn for a known GITHUB_PRO_REQUIRED code', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const err = Object.assign(new Error('Upgrade to GitHub Pro'), { status: 403, code: 'GITHUB_PRO_REQUIRED' })
        formatUserError(err)
        const unmappedCalls = warnSpy.mock.calls.filter(c => String(c[0]).includes('[formatUserError] unmapped'))
        expect(unmappedCalls).toHaveLength(0)
        warnSpy.mockRestore()
    })
})
```

- [ ] **Step 3: Run the test and confirm it FAILS**

Run: `npx vitest run tests/utils/errors.test.js`
Expected: failures — `result.code` is `null` and the unmapped-warn fires.

- [ ] **Step 4: Add the entry to `KNOWN_ERRORS`**

In `src/utils/errors.js`, locate the `KNOWN_ERRORS` map and add:

```js
GITHUB_PRO_REQUIRED: {
    title: 'Branch protection requires GitHub Pro',
    body: 'On the free plan, branch protection rules are only available on public repositories. Upgrade to GitHub Pro, or make this repo public, to enable protection.',
    severity: 'info',
    isRetryable: false,
},
```

(Match the shape of adjacent entries — copy from a neighbour like `RATE_LIMITED` and adjust.)

- [ ] **Step 5: Run the test and confirm it PASSES**

Run: `npx vitest run tests/utils/errors.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add src/utils/errors.js tests/utils/errors.test.js
git commit -m "fix(errors): map GITHUB_PRO_REQUIRED so protection 403 stops logging unmapped"
```

---

## Task 2: Confirm server-side attaches `code: 'GITHUB_PRO_REQUIRED'` on protection 403

**Files:**
- Modify (only if missing): `server/routes/repos.js` (or wherever the protection route lives)
- Test: `server/__tests__/branch-protection-403.test.js`

- [ ] **Step 1: Find the protection route**

Run:
```
Grep -n "branches/.+/protection|/protection" server/routes
```

Open the file and confirm the 403 handler. We expect a shape like:
```js
res.status(403).json({ error: '...', code: 'GITHUB_PRO_REQUIRED' })
```

- [ ] **Step 2: If `code` is missing, write the failing test**

Create `server/__tests__/branch-protection-403.test.js`:

```js
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
// adjust this import to match how server tests bootstrap an app in this repo
import { createApp } from '../app.js'

describe('GET /api/repos/:owner/:repo/branches/:branch/protection — free-plan-private 403', () => {
    let app
    beforeAll(() => { app = createApp({ /* test fixtures */ }) })

    it('responds 403 with a structured code so the client can branch on it', async () => {
        // Use the same fixture the existing suite uses for "free plan, private repo".
        // If no such fixture exists, copy from an adjacent test and substitute the expected status.
        const res = await request(app)
            .get('/api/repos/freeOwner/privateRepo/branches/main/protection')
            .set('Cookie', ['session=fake'])
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('GITHUB_PRO_REQUIRED')
    })
})
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run server/__tests__/branch-protection-403.test.js`

- If it PASSES, the server already returns the code. **Skip to Step 6.**
- If it FAILS because `code` is missing, continue to Step 4.

- [ ] **Step 4: Add the code to the 403 envelope**

In the protection route handler, locate the GitHub error catch block. The shape is roughly:
```js
} catch (e) {
    if (e.status === 403 && /upgrade.*pro/i.test(e.message)) {
        return res.status(403).json({
            error: 'Upgrade to GitHub Pro or make this repository public to enable this feature.',
            code: 'GITHUB_PRO_REQUIRED',
        })
    }
    // ... existing fallthrough
}
```

If the route already has a 403 branch but no `code`, just add `code: 'GITHUB_PRO_REQUIRED'` to the JSON.

- [ ] **Step 5: Re-run the test**

Run: `npx vitest run server/__tests__/branch-protection-403.test.js`
Expected: PASS.

- [ ] **Step 6: Commit (skip if Step 3 was already passing)**

```
git add server/routes server/__tests__
git commit -m "feat(api): tag branch-protection 403 with GITHUB_PRO_REQUIRED code"
```

---

## Task 3: Install `rehype-raw`

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the dep**

Run: `npm install rehype-raw@^7`
Expected: package added to `dependencies`, lockfile updated.

- [ ] **Step 2: Verify the install**

Run: `node -e "import('rehype-raw').then(m => console.log(typeof m.default === 'function'))"`
Expected: `true`.

- [ ] **Step 3: Commit**

```
git add package.json package-lock.json
git commit -m "chore(deps): add rehype-raw for README HTML pass-through"
```

---

## Task 4: Inline rehype-slug plugin

**Files:**
- Create: `src/components/ui/__rehype-slug-inline.js`
- Test: `tests/components/ui/rehype-slug-inline.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/components/ui/rehype-slug-inline.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { unified } from 'unified'
import rehypeParse from 'rehype-parse'
import rehypeStringify from 'rehype-stringify'
import { rehypeSlugInline } from '../../../src/components/ui/__rehype-slug-inline'

async function process(html) {
    const file = await unified()
        .use(rehypeParse, { fragment: true })
        .use(rehypeSlugInline)
        .use(rehypeStringify)
        .process(html)
    return String(file)
}

describe('rehypeSlugInline', () => {
    it('adds an id derived from heading text', async () => {
        const out = await process('<h2>My Section</h2>')
        expect(out).toContain('id="my-section"')
    })
    it('lowercases and strips punctuation', async () => {
        const out = await process('<h3>Hello, World! (v2)</h3>')
        expect(out).toContain('id="hello-world-v2"')
    })
    it('preserves an existing id', async () => {
        const out = await process('<h2 id="custom">Title</h2>')
        expect(out).toContain('id="custom"')
    })
    it('handles all heading levels h1-h6', async () => {
        for (const level of [1, 2, 3, 4, 5, 6]) {
            const out = await process(`<h${level}>Sec</h${level}>`)
            expect(out).toContain('id="sec"')
        }
    })
})
```

- [ ] **Step 2: Verify the test fails**

Run: `npx vitest run tests/components/ui/rehype-slug-inline.test.js`
Expected: module-not-found error.

- [ ] **Step 3: Implement the plugin**

Create `src/components/ui/__rehype-slug-inline.js`:

```js
// Inline rehype plugin: assign id to <h1>-<h6> from text content.
// Intentionally avoids the `rehype-slug` dependency for a 12-line transform.

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

function slugify(text) {
    return String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 80)
}

function visit(node, fn) {
    fn(node)
    if (node.children) for (const c of node.children) visit(c, fn)
}

function textOf(node) {
    let out = ''
    visit(node, (n) => { if (n.type === 'text') out += n.value })
    return out
}

export function rehypeSlugInline() {
    return (tree) => {
        visit(tree, (node) => {
            if (node.type !== 'element' || !HEADINGS.has(node.tagName)) return
            node.properties = node.properties || {}
            if (node.properties.id) return
            const id = slugify(textOf(node))
            if (id) node.properties.id = id
        })
    }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/components/ui/rehype-slug-inline.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/components/ui/__rehype-slug-inline.js tests/components/ui/rehype-slug-inline.test.js
git commit -m "feat(ui): add inline rehype-slug plugin for README headings"
```

---

## Task 5: Build `RepoMarkdown` component

**Files:**
- Create: `src/components/ui/RepoMarkdown.jsx`
- Test: `tests/components/ui/RepoMarkdown.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/components/ui/RepoMarkdown.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RepoMarkdown } from '../../../src/components/ui/RepoMarkdown'

const PROPS = { owner: 'octocat', repo: 'demo', branch: 'main' }

describe('RepoMarkdown', () => {
    it('renders GFM tables', () => {
        const md = `| a | b |\n|---|---|\n| 1 | 2 |`
        render(<RepoMarkdown source={md} {...PROPS} />)
        expect(screen.getByRole('table')).toBeInTheDocument()
        expect(screen.getByRole('cell', { name: '1' })).toBeInTheDocument()
    })

    it('renders fenced code blocks (no <pre> wrapping the entire document)', () => {
        const md = '```js\nconst x = 1\n```'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        // Code lives inside a <code> within a <pre>, but the container's first
        // child must NOT itself be a single <pre> wrapping everything.
        expect(container.firstChild?.tagName).not.toBe('PRE')
        expect(container.querySelector('pre code')).toBeTruthy()
    })

    it('rewrites a relative <img src> to raw.githubusercontent.com', () => {
        const md = '![banner](./banner.png)'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        const img = container.querySelector('img')
        expect(img?.getAttribute('src')).toBe(
            'https://raw.githubusercontent.com/octocat/demo/main/banner.png',
        )
    })

    it('rewrites a relative markdown link to github.com/.../blob/...', () => {
        const md = '[docs](./docs/x.md)'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        const a = container.querySelector('a')
        expect(a?.getAttribute('href')).toBe(
            'https://github.com/octocat/demo/blob/main/docs/x.md',
        )
    })

    it('lets absolute URLs and anchors pass through unchanged', () => {
        const md = '[anchor](#section) and [absolute](https://example.com/x)'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        const links = container.querySelectorAll('a')
        expect(links[0]?.getAttribute('href')).toBe('#section')
        expect(links[1]?.getAttribute('href')).toBe('https://example.com/x')
    })

    it('preserves <div align="center"> from raw HTML', () => {
        const md = '<div align="center">Banner</div>'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        const div = container.querySelector('div[align="center"]')
        expect(div).toBeTruthy()
    })

    it('strips <script> tags via sanitize', () => {
        const md = 'Hello <script>alert(1)</script> world'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        expect(container.querySelector('script')).toBeNull()
    })

    it('adds id slugs to headings', () => {
        const md = '# Hello World'
        const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
        expect(container.querySelector('h1')?.id).toBe('hello-world')
    })
})
```

- [ ] **Step 2: Verify the tests fail**

Run: `npx vitest run tests/components/ui/RepoMarkdown.test.jsx`
Expected: module-not-found.

- [ ] **Step 3: Implement `RepoMarkdown`**

Create `src/components/ui/RepoMarkdown.jsx`:

```jsx
import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { rehypeSlugInline } from './__rehype-slug-inline'

// Sanitize schema: defaults + relax a handful of attributes that GitHub
// READMEs habitually use. Tag/attribute lists are explicit-allow only —
// adding here is the only way new HTML reaches the DOM.
const SCHEMA = {
    ...defaultSchema,
    attributes: {
        ...defaultSchema.attributes,
        div: [...(defaultSchema.attributes?.div || []), 'align'],
        p: [...(defaultSchema.attributes?.p || []), 'align'],
        img: [...(defaultSchema.attributes?.img || []), 'width', 'height', 'align'],
        h1: [...(defaultSchema.attributes?.h1 || []), 'id'],
        h2: [...(defaultSchema.attributes?.h2 || []), 'id'],
        h3: [...(defaultSchema.attributes?.h3 || []), 'id'],
        h4: [...(defaultSchema.attributes?.h4 || []), 'id'],
        h5: [...(defaultSchema.attributes?.h5 || []), 'id'],
        h6: [...(defaultSchema.attributes?.h6 || []), 'id'],
    },
}

function isAbsolute(url) {
    return /^[a-z]+:\/\//i.test(url) || url.startsWith('#') || url.startsWith('mailto:')
}

function rewriteImageUri(uri, owner, repo, branch) {
    if (!uri || isAbsolute(uri)) return uri
    const clean = uri.replace(/^\.\//, '').replace(/^\//, '')
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${clean}`
}

function rewriteLinkUri(uri, owner, repo, branch) {
    if (!uri || isAbsolute(uri)) return uri
    const clean = uri.replace(/^\.\//, '').replace(/^\//, '')
    return `https://github.com/${owner}/${repo}/blob/${branch}/${clean}`
}

export function RepoMarkdown({ source, owner, repo, branch = 'main', className = '' }) {
    const transformImage = useMemo(() => (uri) => rewriteImageUri(uri, owner, repo, branch), [owner, repo, branch])
    const transformLink  = useMemo(() => (uri) => rewriteLinkUri(uri, owner, repo, branch), [owner, repo, branch])

    if (!source) return null

    return (
        <div className={`prose prose-sm dark:prose-invert max-w-none ds-readme ${className}`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, rehypeSlugInline, [rehypeSanitize, SCHEMA]]}
                urlTransform={(url, key) => {
                    if (key === 'src') return transformImage(url)
                    if (key === 'href') return transformLink(url)
                    return url
                }}
                components={{
                    a: ({ node, ...props }) => (
                        // eslint-disable-next-line jsx-a11y/anchor-has-content -- children come from react-markdown via {...props}
                        <a {...props} target="_blank" rel="noopener noreferrer" />
                    ),
                }}
            >
                {source}
            </ReactMarkdown>
        </div>
    )
}
```

(Code-fence syntax highlighting via Shiki is **deferred to Task 6** — keeping this task focused.)

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/components/ui/RepoMarkdown.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/components/ui/RepoMarkdown.jsx tests/components/ui/RepoMarkdown.test.jsx
git commit -m "feat(ui): RepoMarkdown — GitHub-faithful README renderer with sanitized HTML"
```

---

## Task 6: Add Shiki code-fence highlighting to `RepoMarkdown`

**Files:**
- Modify: `src/components/ui/RepoMarkdown.jsx`
- Modify: `tests/components/ui/RepoMarkdown.test.jsx`

- [ ] **Step 1: Write the failing test**

Append to `tests/components/ui/RepoMarkdown.test.jsx`:

```jsx
it('applies a Shiki language class to fenced code blocks for known languages', async () => {
    const md = '```javascript\nconst x = 1\n```'
    const { container } = render(<RepoMarkdown source={md} {...PROPS} />)
    // Shiki renders inline-styled spans; we don't assert exact tokens (theme-
    // dependent), only that the language class survived.
    const code = container.querySelector('pre code')
    expect(code?.className || '').toMatch(/language-javascript/)
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/components/ui/RepoMarkdown.test.jsx -t "Shiki language class"`

- [ ] **Step 3: Add the code-component override**

In `src/components/ui/RepoMarkdown.jsx`, extend the `components` map:

```jsx
components={{
    a: ({ node, ...props }) => (
        // eslint-disable-next-line jsx-a11y/anchor-has-content
        <a {...props} target="_blank" rel="noopener noreferrer" />
    ),
    code: ({ inline, className, children, ...rest }) => {
        if (inline) return <code className={className} {...rest}>{children}</code>
        // Block code — preserve the language class so Shiki / our syntax CSS
        // can theme it. We don't tokenize at render-time (cost-prohibitive
        // for long READMEs); we add the class and let our existing Shiki
        // CSS bundle (loaded by @git-diff-view/shiki) style it.
        return <code className={className || ''} {...rest}>{children}</code>
    },
}}
```

(Decision: **don't run Shiki tokenization at render-time** for READMEs — too expensive. We rely on the language class + the existing Shiki theme CSS already in the bundle. If a future task wants real tokenization, add it then; today's gain is correctness, not glow.)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/components/ui/RepoMarkdown.test.jsx`
Expected: all PASS.

- [ ] **Step 5: Commit**

```
git add src/components/ui/RepoMarkdown.jsx tests/components/ui/RepoMarkdown.test.jsx
git commit -m "feat(ui): preserve language class on fenced code so Shiki CSS themes it"
```

---

## Task 7: Wire `RepoMarkdown` into `OverviewTab`

**Files:**
- Modify: `src/components/RepoDetail/OverviewTab.jsx`
- Modify: `tests/components/RepoDetail/OverviewTab.test.jsx` (extend; create if missing)

- [ ] **Step 1: Write the failing test**

Add to `tests/components/RepoDetail/OverviewTab.test.jsx`:

```jsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { OverviewTab } from '../../../src/components/RepoDetail/OverviewTab'

const REPO = {
    name: 'demo',
    owner: { login: 'octocat' },
    default_branch: 'main',
    description: '',
    homepage: '',
    archived: false,
}

function makeApi(readmeContent) {
    return {
        fetchReadme: vi.fn().mockResolvedValue({
            data: { content: btoa(readmeContent) },
        }),
        updateRepo: vi.fn(),
    }
}

describe('OverviewTab — README rendering', () => {
    it('renders a markdown table from the README (not raw <pre>)', async () => {
        const api = makeApi('| h | i |\n|---|---|\n| 1 | 2 |')
        render(<OverviewTab api={api} repoData={REPO} onUpdate={() => {}} />)
        await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
        expect(screen.queryByText('| h | i |')).toBeNull() // raw pipe text must NOT be visible
    })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/components/RepoDetail/OverviewTab.test.jsx`
Expected: fail — current code renders `<pre>` of the raw markdown.

- [ ] **Step 3: Replace the README branch in `OverviewTab.jsx`**

Find:
```jsx
) : readme?.content ? (
    <div className="prose dark:prose-invert prose-sm max-w-none overflow-auto">
        <pre className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
            {decodeBase64ReadmeUtf8(readme.content)}
        </pre>
    </div>
) : (
```

Replace with:
```jsx
) : readme?.content ? (
    <RepoMarkdown
        source={decodeBase64ReadmeUtf8(readme.content)}
        owner={repoData.owner?.login || repoData.full_name?.split('/')[0]}
        repo={repoData.name}
        branch={repoData.default_branch || 'main'}
    />
) : (
```

Add the import at the top:
```jsx
import { RepoMarkdown } from '../ui/RepoMarkdown'
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/components/RepoDetail/OverviewTab.test.jsx`
Expected: PASS.

- [ ] **Step 5: Smoke-test in the browser**

Run: `npm run dev:all`
Open a private repo with a markdown README → confirm the table, headings, and any `<div align="center">` banner render. Hit refresh — should re-render cleanly.

- [ ] **Step 6: Commit**

```
git add src/components/RepoDetail/OverviewTab.jsx tests/components/RepoDetail/OverviewTab.test.jsx
git commit -m "feat(overview): render README as real markdown via RepoMarkdown"
```

---

## Task 8: Widen Modal `full` size for Codex-style diff viewer

**Files:**
- Modify: `src/components/ui/Modal.jsx`
- Test: `tests/components/ui/Modal.test.jsx` (extend if exists)

- [ ] **Step 1: Write the failing test**

Add to `tests/components/ui/Modal.test.jsx`:

```jsx
it('size="full" applies a near-full-viewport width class', () => {
    render(<Modal isOpen onClose={() => {}} title="t" size="full">x</Modal>)
    const dialog = screen.getByRole('dialog')
    // The modal panel is a descendant carrying a size class. We assert one of
    // the new generous-width tokens lands on a child.
    const widePanel = dialog.querySelector('[class*="max-w-"]')
    expect(widePanel?.className || '').toMatch(/max-w-\[min\(96vw,1600px\)\]/)
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/components/ui/Modal.test.jsx -t "near-full-viewport"`
Expected: fail — current `full` is `max-w-7xl`.

- [ ] **Step 3: Update the size tables**

In `src/components/ui/Modal.jsx`, change the `full` entries:

```js
const SIZE_CLASSES = {
    sm:    'max-w-md',
    md:    'max-w-lg',
    lg:    'max-w-2xl',
    xl:    'max-w-4xl',
    '2xl': 'max-w-5xl',
    '3xl': 'max-w-6xl',
    full:  'max-w-[min(96vw,1600px)] max-h-[92vh]',
}

const SHEET_SIZE_CLASSES = {
    sm:    'md:max-w-md',
    md:    'md:max-w-lg',
    lg:    'md:max-w-2xl',
    xl:    'md:max-w-4xl',
    '2xl': 'md:max-w-5xl',
    '3xl': 'md:max-w-6xl',
    full:  'md:max-w-[min(96vw,1600px)] md:max-h-[92vh]',
}
```

(The `max-w-[...]` and `max-h-[...]` literals must remain static strings so Tailwind's JIT scanner picks them up — see the file-level comment at line 22-23.)

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/components/ui/Modal.test.jsx`
Expected: PASS. Other modal tests must keep passing — re-run the whole file.

- [ ] **Step 5: Commit**

```
git add src/components/ui/Modal.jsx tests/components/ui/Modal.test.jsx
git commit -m "feat(ui): widen Modal size=full to 96vw/1600px for diff viewer use"
```

---

## Task 9: `useDiffPreferences` hook

**Files:**
- Create: `src/hooks/useDiffPreferences.js`
- Test: `tests/hooks/useDiffPreferences.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/hooks/useDiffPreferences.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDiffPreferences, DEFAULTS } from '../../src/hooks/useDiffPreferences'

describe('useDiffPreferences', () => {
    beforeEach(() => { localStorage.clear() })

    it('returns defaults on first use', () => {
        const { result } = renderHook(() => useDiffPreferences())
        expect(result.current.prefs).toEqual(DEFAULTS)
    })

    it('persists changes through setMode / setWrap / setTabWidth', () => {
        const { result, rerender } = renderHook(() => useDiffPreferences())
        act(() => result.current.setMode('split'))
        act(() => result.current.setWrap(true))
        act(() => result.current.setTabWidth(2))

        // Re-mount the hook in a new instance — state must rehydrate from storage
        rerender()
        const { result: r2 } = renderHook(() => useDiffPreferences())
        expect(r2.current.prefs).toEqual({ mode: 'split', wrap: true, tabWidth: 2 })
    })

    it('ignores corrupt localStorage payloads', () => {
        localStorage.setItem('diffview:preferences', '{not json')
        const { result } = renderHook(() => useDiffPreferences())
        expect(result.current.prefs).toEqual(DEFAULTS)
    })

    it('clamps tabWidth to allowed values', () => {
        const { result } = renderHook(() => useDiffPreferences())
        act(() => result.current.setTabWidth(99))
        expect(result.current.prefs.tabWidth).toBe(DEFAULTS.tabWidth)
    })
})
```

- [ ] **Step 2: Verify failure**

Run: `npx vitest run tests/hooks/useDiffPreferences.test.js`
Expected: module-not-found.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useDiffPreferences.js`:

```js
import { useCallback, useEffect, useState } from 'react'

const KEY = 'diffview:preferences'
const ALLOWED_TAB_WIDTHS = [1, 2, 4, 8]

export const DEFAULTS = Object.freeze({
    mode: 'unified', // 'unified' | 'split'
    wrap: false,
    tabWidth: 4,
})

function readStorage() {
    if (typeof window === 'undefined') return DEFAULTS
    try {
        const raw = localStorage.getItem(KEY)
        if (!raw) return DEFAULTS
        const parsed = JSON.parse(raw)
        return {
            mode: parsed.mode === 'split' ? 'split' : 'unified',
            wrap: !!parsed.wrap,
            tabWidth: ALLOWED_TAB_WIDTHS.includes(parsed.tabWidth) ? parsed.tabWidth : DEFAULTS.tabWidth,
        }
    } catch { return DEFAULTS }
}

function writeStorage(prefs) {
    if (typeof window === 'undefined') return
    try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* quota — silent */ }
}

export function useDiffPreferences() {
    const [prefs, setPrefs] = useState(readStorage)

    useEffect(() => { writeStorage(prefs) }, [prefs])

    const setMode = useCallback((mode) => {
        setPrefs(p => ({ ...p, mode: mode === 'split' ? 'split' : 'unified' }))
    }, [])

    const setWrap = useCallback((wrap) => {
        setPrefs(p => ({ ...p, wrap: !!wrap }))
    }, [])

    const setTabWidth = useCallback((tabWidth) => {
        if (!ALLOWED_TAB_WIDTHS.includes(tabWidth)) return
        setPrefs(p => ({ ...p, tabWidth }))
    }, [])

    return { prefs, setMode, setWrap, setTabWidth }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/hooks/useDiffPreferences.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/hooks/useDiffPreferences.js tests/hooks/useDiffPreferences.test.js
git commit -m "feat(hooks): useDiffPreferences for split/wrap/tab-width persistence"
```

---

## Task 10: Add tab-width preprocessing + wrap support to `DiffRenderer`

**Files:**
- Modify: `src/components/PRReview/DiffPanel/DiffRenderer.jsx`
- Test: `tests/components/PRReview/DiffPanel/DiffRenderer.test.jsx` (extend; create if missing)

- [ ] **Step 1: Read the current `DiffRenderer.jsx`**

Run:
```
Read src/components/PRReview/DiffPanel/DiffRenderer.jsx
```

Note the existing prop shape (`filename`, `patch`, `viewMode`, `onAddComment`).

- [ ] **Step 2: Write the failing tests**

Add to `tests/components/PRReview/DiffPanel/DiffRenderer.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { DiffRenderer } from '../../../../src/components/PRReview/DiffPanel/DiffRenderer'

const PATCH_WITH_TABS = `@@ -1,1 +1,1 @@
-\tfoo
+\tbar`

describe('DiffRenderer — tabWidth + wrap', () => {
    it('rewrites \\t to N spaces when tabWidth=2', () => {
        const { container } = render(
            <DiffRenderer filename="x.js" patch={PATCH_WITH_TABS} viewMode="unified" tabWidth={2} />,
        )
        const text = container.textContent || ''
        expect(text).toMatch(/  foo/)
        expect(text).not.toMatch(/\tfoo/)
    })

    it('applies a wrap class to the root when wrap=true', () => {
        const { container } = render(
            <DiffRenderer filename="x.js" patch={PATCH_WITH_TABS} viewMode="unified" wrap={true} />,
        )
        expect(container.firstChild?.className || '').toMatch(/diff-wrap-on/)
    })
})
```

- [ ] **Step 3: Run the tests, confirm failure**

Run: `npx vitest run tests/components/PRReview/DiffPanel/DiffRenderer.test.jsx -t "tabWidth + wrap"`

- [ ] **Step 4: Implement**

In `src/components/PRReview/DiffPanel/DiffRenderer.jsx`:

a) Extend the prop signature to accept `tabWidth` (default 4) and `wrap` (default false).

b) Inside `parsePatchToHunks` (or in the wrapper before it's called), expand tabs:

```js
function expandTabs(patch, tabWidth) {
    if (!patch || !tabWidth || tabWidth === 1) return patch
    const spaces = ' '.repeat(tabWidth)
    return patch.replace(/\t/g, spaces)
}
```

Apply at the top of the component:
```jsx
const expanded = useMemo(() => expandTabs(patch, tabWidth), [patch, tabWidth])
```

Then pass `expanded` everywhere the code currently passes `patch`.

c) Wrap the rendered root in a `<div>` that conditionally adds the `diff-wrap-on` class:

```jsx
return (
    <div className={`diff-renderer ${wrap ? 'diff-wrap-on' : ''}`}>
        {/* existing DiffView render */}
    </div>
)
```

d) Add the wrap CSS to `src/design-system.css`:

```css
.diff-wrap-on .diff-line-content,
.diff-wrap-on pre,
.diff-wrap-on code {
    white-space: pre-wrap !important;
    word-break: break-all;
}
```

(If the `.diff-line-content` selector doesn't match the actual class emitted by `@git-diff-view/react`, inspect a rendered diff in DevTools first and substitute the real one.)

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/components/PRReview/DiffPanel/DiffRenderer.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add src/components/PRReview/DiffPanel/DiffRenderer.jsx src/design-system.css tests/components/PRReview/DiffPanel/DiffRenderer.test.jsx
git commit -m "feat(diff): tabWidth preprocessing and wrap toggle in DiffRenderer"
```

---

## Task 11: Extract `CodeReviewToolbar` from `PRFilesTab`

**Files:**
- Create: `src/components/diff/CodeReviewToolbar.jsx`
- Test: `tests/components/diff/CodeReviewToolbar.test.jsx`
- Modify: `src/components/RepoDetail/PRFilesTab.jsx` (consume the toolbar)

- [ ] **Step 1: Write the failing test**

Create `tests/components/diff/CodeReviewToolbar.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CodeReviewToolbar } from '../../../src/components/diff/CodeReviewToolbar'

const BASE_PROPS = {
    filesCount: 3,
    additions: 42,
    deletions: 7,
    reviewedCount: 1,
    activeIndex: 0,
    treeCollapsed: false,
    onToggleTree: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    mode: 'unified',
    onToggleMode: vi.fn(),
    wrap: false,
    onToggleWrap: vi.fn(),
    tabWidth: 4,
    onSetTabWidth: vi.fn(),
    rightSlotPresent: true,
    rightCollapsed: false,
    onToggleRight: vi.fn(),
}

describe('CodeReviewToolbar', () => {
    it('shows files / additions / deletions counts', () => {
        render(<CodeReviewToolbar {...BASE_PROPS} />)
        expect(screen.getByText(/3/)).toBeInTheDocument()
        expect(screen.getByText(/\+42/)).toBeInTheDocument()
        expect(screen.getByText(/−7/)).toBeInTheDocument()
    })

    it('clicking the mode button calls onToggleMode', () => {
        render(<CodeReviewToolbar {...BASE_PROPS} />)
        fireEvent.click(screen.getByRole('button', { name: /split|unified/i }))
        expect(BASE_PROPS.onToggleMode).toHaveBeenCalled()
    })

    it('hides the right-slot toggle when rightSlotPresent is false', () => {
        render(<CodeReviewToolbar {...BASE_PROPS} rightSlotPresent={false} />)
        expect(screen.queryByLabelText(/AI insights/i)).toBeNull()
    })

    it('exposes a tab-width selector with values 2 / 4 / 8', () => {
        render(<CodeReviewToolbar {...BASE_PROPS} />)
        const select = screen.getByLabelText(/tab width/i)
        expect(select).toBeInTheDocument()
        const options = [...select.querySelectorAll('option')].map(o => o.value)
        expect(options).toEqual(expect.arrayContaining(['2', '4', '8']))
    })
})
```

- [ ] **Step 2: Run the test, confirm failure**

Run: `npx vitest run tests/components/diff/CodeReviewToolbar.test.jsx`

- [ ] **Step 3: Implement the toolbar**

Create `src/components/diff/CodeReviewToolbar.jsx`:

```jsx
import { Columns2, AlignLeft, ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen, WrapText } from 'lucide-react'

export function CodeReviewToolbar({
    filesCount, additions, deletions, reviewedCount,
    activeIndex,
    treeCollapsed, onToggleTree,
    onPrev, onNext,
    mode, onToggleMode,
    wrap, onToggleWrap,
    tabWidth, onSetTabWidth,
    rightSlotPresent, rightCollapsed, onToggleRight,
}) {
    return (
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 flex-shrink-0">
            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                <button
                    type="button"
                    onClick={onToggleTree}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    aria-label={treeCollapsed ? 'Show file tree' : 'Hide file tree'}
                >
                    {treeCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </button>
                <span>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{filesCount}</span> files changed
                    {' · '}<span className="text-green-600 dark:text-green-400">+{additions}</span>{' '}
                    <span className="text-red-600 dark:text-red-400">−{deletions}</span>
                </span>
                <span className="text-slate-400">·</span>
                <span>
                    <span className="font-semibold text-indigo-600 dark:text-indigo-400">{reviewedCount}</span>/{filesCount} reviewed
                </span>
            </div>

            <div className="flex items-center gap-1.5">
                <button type="button" onClick={onPrev} disabled={activeIndex === 0}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
                    aria-label="Previous file">
                    <ChevronLeft className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                </button>
                <span className="text-xs text-slate-500 dark:text-slate-400 w-14 text-center tabular-nums">
                    {activeIndex + 1} / {filesCount}
                </span>
                <button type="button" onClick={onNext} disabled={activeIndex >= filesCount - 1}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
                    aria-label="Next file">
                    <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                </button>

                <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

                <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <span aria-label="Tab width" className="sr-only">Tab width</span>
                    <select
                        aria-label="Tab width"
                        value={tabWidth}
                        onChange={e => onSetTabWidth(Number(e.target.value))}
                        className="bg-transparent border border-slate-200 dark:border-slate-700 rounded px-1 py-0.5"
                    >
                        <option value="2">tab 2</option>
                        <option value="4">tab 4</option>
                        <option value="8">tab 8</option>
                    </select>
                </label>

                <button type="button" onClick={onToggleWrap}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        wrap
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                    aria-pressed={wrap}
                    aria-label="Toggle line wrap">
                    <WrapText className="w-3.5 h-3.5" /> Wrap
                </button>

                <button type="button" onClick={onToggleMode}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
                    {mode === 'unified'
                        ? <><Columns2 className="w-3.5 h-3.5" /> Split</>
                        : <><AlignLeft className="w-3.5 h-3.5" /> Unified</>
                    }
                </button>

                {rightSlotPresent && (
                    <button type="button" onClick={onToggleRight}
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                        aria-label={rightCollapsed ? 'Show AI insights' : 'Hide AI insights'}>
                        {rightCollapsed ? <PanelRightOpen className="w-3.5 h-3.5" /> : <PanelRightClose className="w-3.5 h-3.5" />}
                    </button>
                )}
            </div>
        </div>
    )
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/components/diff/CodeReviewToolbar.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/components/diff/CodeReviewToolbar.jsx tests/components/diff/CodeReviewToolbar.test.jsx
git commit -m "feat(diff): extract CodeReviewToolbar with wrap and tab-width controls"
```

---

## Task 12: Extract `CodeReviewSurface`

**Files:**
- Create: `src/components/diff/CodeReviewSurface.jsx`
- Test: `tests/components/diff/CodeReviewSurface.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/components/diff/CodeReviewSurface.test.jsx`:

```jsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CodeReviewSurface } from '../../../src/components/diff/CodeReviewSurface'

const FILES = [
    { filename: 'a.js', additions: 2, deletions: 0, patch: '@@ -0,0 +1,2 @@\n+a\n+b' },
    { filename: 'b.js', additions: 0, deletions: 1, patch: '@@ -1,1 +0,0 @@\n-x' },
]

describe('CodeReviewSurface', () => {
    beforeEach(() => { localStorage.clear() })

    it('renders the file tree, the toolbar, and the active diff', () => {
        render(<CodeReviewSurface files={FILES} storageKey="test:1" />)
        expect(screen.getByText('a.js')).toBeInTheDocument()
        expect(screen.getByText('b.js')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Previous file/i })).toBeInTheDocument()
    })

    it('persists viewed state under storageKey', () => {
        const { unmount } = render(<CodeReviewSurface files={FILES} storageKey="test:viewed" />)
        const checkbox = screen.getByLabelText(/Mark as reviewed/i)
        fireEvent.click(checkbox)
        unmount()
        // Re-mount and confirm the box is still checked
        render(<CodeReviewSurface files={FILES} storageKey="test:viewed" />)
        expect(screen.getByLabelText(/Mark as reviewed/i)).toBeChecked()
    })

    it('storageKey scopes viewed state', () => {
        render(<CodeReviewSurface files={FILES} storageKey="test:A" />)
        fireEvent.click(screen.getByLabelText(/Mark as reviewed/i))
        // Different surface, different key
        const { container } = render(<CodeReviewSurface files={FILES} storageKey="test:B" />)
        const checkboxes = container.querySelectorAll('input[type="checkbox"]')
        const surfaceB = checkboxes[checkboxes.length - 1]
        expect(surfaceB).not.toBeChecked()
    })

    it('omits the right column when rightSlot is null', () => {
        const { container } = render(<CodeReviewSurface files={FILES} storageKey="test:no-right" rightSlot={null} />)
        // The right rail uses a 280px column. Confirm it isn't rendered.
        expect(container.querySelector('[data-testid="code-review-right"]')).toBeNull()
    })

    it('renders headerSlot above the diff column when provided', () => {
        render(<CodeReviewSurface files={FILES} storageKey="test:hs" headerSlot={<div>HEADER</div>} />)
        expect(screen.getByText('HEADER')).toBeInTheDocument()
    })
})
```

- [ ] **Step 2: Run the tests, confirm failure**

Run: `npx vitest run tests/components/diff/CodeReviewSurface.test.jsx`

- [ ] **Step 3: Implement the surface**

Create `src/components/diff/CodeReviewSurface.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileTree } from '../PRReview/FileTree/FileTree'
import { DiffRenderer } from '../PRReview/DiffPanel/DiffRenderer'
import { Spinner } from '../ui/Spinner'
import { CodeReviewToolbar } from './CodeReviewToolbar'
import { useDiffPreferences } from '../../hooks/useDiffPreferences'

function loadReviewed(storageKey) {
    if (!storageKey) return new Set()
    try {
        const raw = localStorage.getItem(storageKey)
        return new Set(raw ? JSON.parse(raw) : [])
    } catch { return new Set() }
}

function saveReviewed(storageKey, set) {
    if (!storageKey) return
    try { localStorage.setItem(storageKey, JSON.stringify([...set])) } catch { /* quota — silent */ }
}

export function CodeReviewSurface({
    files = [],
    storageKey,
    sortFiles,                  // optional: (files) => sortedFiles
    fileMeta,                   // optional: { [filename]: { risk, ... } } passed to FileTree
    headerSlot = null,
    rightSlot = null,
    emptyState = null,
    initialActiveIndex = 0,
}) {
    const sortedFiles = useMemo(() => (sortFiles ? sortFiles(files) : files), [files, sortFiles])
    const [activeIndex, setActiveIndex] = useState(initialActiveIndex)
    const [reviewed, setReviewedRaw] = useState(() => loadReviewed(storageKey))
    const [treeCollapsed, setTreeCollapsed] = useState(false)
    const [rightCollapsed, setRightCollapsed] = useState(false)
    const { prefs, setMode, setWrap, setTabWidth } = useDiffPreferences()

    // Re-hydrate viewed set when storageKey changes (commit/PR navigation)
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot reset on key change
        setReviewedRaw(loadReviewed(storageKey))
    }, [storageKey])

    const setReviewed = useCallback((updater) => {
        setReviewedRaw(curr => {
            const next = typeof updater === 'function' ? updater(curr) : updater
            saveReviewed(storageKey, next)
            return next
        })
    }, [storageKey])

    const activeFile = sortedFiles[activeIndex] ?? null

    function toggleReviewed(filename) {
        setReviewed(prev => {
            const next = new Set(prev)
            if (next.has(filename)) next.delete(filename); else next.add(filename)
            return next
        })
    }

    function handleFileSelect(filename) {
        const idx = sortedFiles.findIndex(f => f.filename === filename)
        if (idx !== -1) setActiveIndex(idx)
    }

    if (!sortedFiles.length) {
        return emptyState ?? (
            <div className="flex items-center justify-center h-40 text-sm text-slate-500 dark:text-slate-400">
                No files in this changeset.
            </div>
        )
    }

    const additions = sortedFiles.reduce((s, f) => s + (f.additions || 0), 0)
    const deletions = sortedFiles.reduce((s, f) => s + (f.deletions || 0), 0)

    return (
        <div className="flex flex-col h-full min-h-0">
            <CodeReviewToolbar
                filesCount={sortedFiles.length}
                additions={additions}
                deletions={deletions}
                reviewedCount={reviewed.size}
                activeIndex={activeIndex}
                treeCollapsed={treeCollapsed}
                onToggleTree={() => setTreeCollapsed(c => !c)}
                onPrev={() => setActiveIndex(i => Math.max(0, i - 1))}
                onNext={() => setActiveIndex(i => Math.min(sortedFiles.length - 1, i + 1))}
                mode={prefs.mode}
                onToggleMode={() => setMode(prefs.mode === 'unified' ? 'split' : 'unified')}
                wrap={prefs.wrap}
                onToggleWrap={() => setWrap(!prefs.wrap)}
                tabWidth={prefs.tabWidth}
                onSetTabWidth={setTabWidth}
                rightSlotPresent={rightSlot != null}
                rightCollapsed={rightCollapsed}
                onToggleRight={() => setRightCollapsed(c => !c)}
            />

            <div className="flex flex-1 min-h-0 overflow-hidden">
                {!treeCollapsed && (
                    <div className="w-[220px] flex-shrink-0 border-r border-slate-200 dark:border-slate-700 overflow-y-auto bg-slate-50/40 dark:bg-slate-800/20">
                        <FileTree
                            files={sortedFiles}
                            activeFile={activeFile?.filename ?? ''}
                            reviewedFiles={[...reviewed]}
                            aiFileRisks={fileMeta?.aiFileRisks ?? []}
                            onFileSelect={handleFileSelect}
                        />
                        {activeFile && (
                            <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800">
                                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={reviewed.has(activeFile.filename)}
                                        onChange={() => toggleReviewed(activeFile.filename)}
                                        className="rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    Mark as reviewed
                                </label>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex-1 min-w-0 overflow-auto">
                    {headerSlot}
                    {activeFile ? (
                        <div className="min-w-0">
                            <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-100 dark:border-slate-800 text-xs">
                                <span className="font-mono text-slate-700 dark:text-slate-200 font-medium truncate">{activeFile.filename}</span>
                                <span className="flex-shrink-0 text-green-600 dark:text-green-400">+{activeFile.additions}</span>
                                <span className="flex-shrink-0 text-red-600 dark:text-red-400">−{activeFile.deletions}</span>
                            </div>
                            {activeFile.patch ? (
                                <DiffRenderer
                                    filename={activeFile.filename}
                                    patch={activeFile.patch}
                                    viewMode={prefs.mode}
                                    tabWidth={prefs.tabWidth}
                                    wrap={prefs.wrap}
                                />
                            ) : (
                                <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
                                    No diff available for this file (binary or too large).
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-40">
                            <Spinner size="md" />
                        </div>
                    )}
                </div>

                {rightSlot && !rightCollapsed && (
                    <div data-testid="code-review-right" className="w-[280px] flex-shrink-0 border-l border-slate-200 dark:border-slate-700 overflow-y-auto bg-slate-50/40 dark:bg-slate-800/20 p-3">
                        {rightSlot}
                    </div>
                )}
            </div>
        </div>
    )
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/components/diff/CodeReviewSurface.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/components/diff/CodeReviewSurface.jsx tests/components/diff/CodeReviewSurface.test.jsx
git commit -m "feat(diff): CodeReviewSurface — shared 3-column review shell"
```

---

## Task 13: Refactor `PRFilesTab` to consume `CodeReviewSurface`

**Files:**
- Modify: `src/components/RepoDetail/PRFilesTab.jsx`

- [ ] **Step 1: Run the existing PRFilesTab tests as a baseline**

Run: `npx vitest run tests/components/RepoDetail/PRFilesTab` (if any) and `npx playwright test e2e/ -g "PR review"` (or whichever spec covers PR review). Note which pass — those must keep passing.

- [ ] **Step 2: Replace the body of `PRFilesTab` with a thin adapter**

Open `src/components/RepoDetail/PRFilesTab.jsx`. Replace lines 38-266 (the export function body) with:

```jsx
export function PRFilesTab({ files = [], owner, repo, pr }) {
    const prNumber = pr?.number ?? 0
    const headSha = MOCK_MODE ? '' : (pr?.head?.sha ?? '')
    const sortedFiles = useMemo(() => sortFilesByRisk(files, {}), [files])

    const { summary: aiSummary, loading: aiLoading, error: aiError, retry: retryAI } =
        useReviewAI(owner, repo, prNumber, headSha, files)

    const rightSlot = MOCK_MODE && !aiSummary && !aiLoading ? (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-500 dark:text-slate-400">
            <p className="font-semibold text-slate-600 dark:text-slate-300 mb-1">AI Insights</p>
            <p>AI analysis not available in demo mode. Configure a provider in Settings → AI Configuration.</p>
        </div>
    ) : (
        <AISummaryPanel
            summary={aiSummary}
            loading={aiLoading}
            error={aiError}
            collapsed={false}
            onToggle={() => {}}
            onRetry={retryAI}
            onFileClick={(filename) => {
                // Surface owns the active index; let consumers jump via window event.
                window.dispatchEvent(new CustomEvent('code-review-surface:select-file', { detail: { filename } }))
            }}
        />
    )

    return (
        <CodeReviewSurface
            files={files}
            sortFiles={(f) => sortFilesByRisk(f, {})}
            storageKey={`pr-reviewed:${owner}/${repo}#${prNumber}`}
            headerSlot={null}
            rightSlot={rightSlot}
            fileMeta={{ aiFileRisks: aiSummary?.fileRisks ?? [] }}
        />
    )
}
```

(The earlier `_unused` value `sortedFiles` becomes redundant — the surface accepts a `sortFiles` callback. Remove the unused `useMemo` line.)

Update imports:
```jsx
import { useMemo } from 'react'
import { CodeReviewSurface } from '../diff/CodeReviewSurface'
import { AISummaryPanel } from '../PRReview/AIInsights/AISummaryPanel'
import { useReviewAI, sortFilesByRisk } from '../PRReview/hooks/useReviewAI'
import { MOCK_MODE } from '../../config'
```

(Drop the `FileTree`, `DiffRenderer`, `Spinner`, and `lucide-react` imports — the surface owns those.)

In `CodeReviewSurface.jsx`, register the `code-review-surface:select-file` event so the AI panel's "click to jump to file" still works:

```jsx
useEffect(() => {
    function onSelect(e) {
        const filename = e?.detail?.filename
        if (filename) handleFileSelect(filename)
    }
    window.addEventListener('code-review-surface:select-file', onSelect)
    return () => window.removeEventListener('code-review-surface:select-file', onSelect)
}, [sortedFiles])
```

- [ ] **Step 3: Run all PR-related tests**

Run: `npx vitest run` (whole suite — fast). Then:
Run: `npx playwright test -g "PR review"` (or the relevant grep)

Expected: PR review specs continue to pass. If a test fails, do NOT continue — diagnose and fix the regression first.

- [ ] **Step 4: Commit**

```
git add src/components/RepoDetail/PRFilesTab.jsx src/components/diff/CodeReviewSurface.jsx
git commit -m "refactor(pr): PRFilesTab consumes CodeReviewSurface (no UX change)"
```

---

## Task 14: Rebuild `CommitDetailPanel` around `CodeReviewSurface`

**Files:**
- Modify: `src/components/RepoDetail/CommitDetailPanel.jsx`
- Test: `tests/components/RepoDetail/CommitDetailPanel.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/components/RepoDetail/CommitDetailPanel.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CommitDetailPanel } from '../../../src/components/RepoDetail/CommitDetailPanel'

const COMMIT = {
    sha: 'abc123def4567',
    html_url: 'https://github.com/octocat/demo/commit/abc123def4567',
    commit: {
        message: 'feat: shiny\n\nLong description\nspanning lines',
        author: { name: 'Alice', date: '2026-05-08T10:00:00Z' },
    },
    stats: { additions: 7, deletions: 3 },
    files: [
        { filename: 'a.js', additions: 5, deletions: 1, patch: '@@ -1,1 +1,1 @@\n-old\n+new' },
        { filename: 'b.js', additions: 2, deletions: 2, patch: '@@ -1,2 +1,2 @@\n-x\n-y\n+a\n+b' },
    ],
}

vi.mock('../../../src/hooks/useResilientFetch', () => ({
    useResilientFetch: () => ({ data: COMMIT, loading: false, error: null, stale: false, fetchedAt: Date.now(), reload: vi.fn() }),
}))

describe('CommitDetailPanel', () => {
    beforeEach(() => { localStorage.clear() })

    it('renders the commit subject in the modal header', () => {
        render(<CommitDetailPanel owner="octocat" repo="demo" sha="abc123def4567" onClose={() => {}} />)
        expect(screen.getByText('feat: shiny')).toBeInTheDocument()
    })

    it('renders the file tree with both commit files', () => {
        render(<CommitDetailPanel owner="octocat" repo="demo" sha="abc123def4567" onClose={() => {}} />)
        expect(screen.getByText('a.js')).toBeInTheDocument()
        expect(screen.getByText('b.js')).toBeInTheDocument()
    })

    it('persists viewed state under a sha-scoped key', () => {
        const { unmount } = render(<CommitDetailPanel owner="octocat" repo="demo" sha="abc123def4567" onClose={() => {}} />)
        fireEvent.click(screen.getByLabelText(/Mark as reviewed/i))
        unmount()
        render(<CommitDetailPanel owner="octocat" repo="demo" sha="abc123def4567" onClose={() => {}} />)
        expect(screen.getByLabelText(/Mark as reviewed/i)).toBeChecked()
    })
})
```

- [ ] **Step 2: Run the tests, confirm failure**

Run: `npx vitest run tests/components/RepoDetail/CommitDetailPanel.test.jsx`

- [ ] **Step 3: Rewrite `CommitDetailPanel.jsx`**

Replace the file body with:

```jsx
// SPDX-License-Identifier: AGPL-3.0-only
import { GitCommit, ExternalLink, Copy, Check } from 'lucide-react'
import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'
import { StaleDataBadge } from '../ui/StaleDataBadge'
import { useResilientFetch } from '../../hooks/useResilientFetch'
import { CodeReviewSurface } from '../diff/CodeReviewSurface'
import { formatRelativeTime } from '../../utils/format'

function CommitMessageBody({ description }) {
    if (!description) return null
    return (
        <div className="px-4 py-3 mx-4 my-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40">
            <pre className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300 font-sans leading-relaxed">{description}</pre>
        </div>
    )
}

function CopyButton({ value, label }) {
    const [copied, setCopied] = useState(false)
    const onClick = async () => {
        try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
        } catch { /* clipboard denied; ignore */ }
    }
    return (
        <button type="button" onClick={onClick}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            aria-label={`Copy ${label}`}>
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            {value}
        </button>
    )
}

export function CommitDetailPanel({ owner, repo, sha, onClose }) {
    const { data, loading, error, stale, fetchedAt, reload } = useResilientFetch(
        `/api/v1/repos/${owner}/${repo}/commits/${sha}`,
    )

    const message = data?.commit?.message || ''
    const subject = message.split('\n')[0]
    const description = message.split('\n').slice(1).join('\n').trim()
    const files = data?.files || []
    const stats = data?.stats || { additions: 0, deletions: 0 }
    const author = data?.commit?.author

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={subject || `Commit ${sha?.slice(0, 7)}`}
            subtitle={author?.name ? `by ${author.name}` : undefined}
            icon={GitCommit}
            iconGradient="primary"
            size="full"
            closeOnBackdrop={false}
            mobileVariant="sheet"
            isBusy={loading}
            bodyClassName="!p-0 flex flex-col"
        >
            <div className="flex flex-col h-full min-h-0">
                <div className="flex items-center gap-3 flex-wrap text-xs px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800">
                    <CopyButton value={sha?.slice(0, 12) || ''} label="commit SHA" />
                    {author?.date && <span className="text-slate-500 dark:text-slate-400">{formatRelativeTime(author.date)}</span>}
                    <span className="text-emerald-600 dark:text-emerald-400">+{stats.additions}</span>
                    <span className="text-rose-600 dark:text-rose-400">−{stats.deletions}</span>
                    {data?.html_url && (
                        <a href={data.html_url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline">
                            View on GitHub <ExternalLink className="w-3 h-3" />
                        </a>
                    )}
                    {stale && <StaleDataBadge fetchedAt={fetchedAt} onRetry={reload} />}
                </div>

                {loading && (
                    <div className="flex items-center justify-center py-12 flex-1">
                        <Spinner size="lg" />
                    </div>
                )}

                {error && !data && (
                    <div className="m-4 px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400">
                        Couldn&apos;t load commit. Please retry.
                    </div>
                )}

                {data && (
                    <CodeReviewSurface
                        files={files}
                        storageKey={`commit-reviewed:${owner}/${repo}#${sha}`}
                        headerSlot={<CommitMessageBody description={description} />}
                        rightSlot={null}
                    />
                )}
            </div>
        </Modal>
    )
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/components/RepoDetail/CommitDetailPanel.test.jsx`
Expected: PASS.

- [ ] **Step 5: Smoke-test manually**

Run: `npm run dev:all`
Open Repo Detail → Commits tab → click any commit. Confirm:
- Modal opens nearly full-bleed
- File tree on the left
- Diff is syntax-highlighted (Shiki)
- Mark a file as reviewed → close → reopen the same commit → still marked
- Toggle split / unified → re-open another commit → preference persists
- "Copy SHA" button copies and shows a check icon

- [ ] **Step 6: Commit**

```
git add src/components/RepoDetail/CommitDetailPanel.jsx tests/components/RepoDetail/CommitDetailPanel.test.jsx
git commit -m "feat(commits): rebuild CommitDetailPanel as full-bleed Codex-style review"
```

---

## Task 15: Branches — collapsed protection panel for free-plan-private

**Files:**
- Modify: `src/components/RepoDetail/BranchProtectionPanel.jsx`
- Test: `tests/components/RepoDetail/BranchProtectionPanel.test.jsx` (extend / create)

- [ ] **Step 1: Write the failing test**

Add to `tests/components/RepoDetail/BranchProtectionPanel.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BranchProtectionPanel } from '../../../src/components/RepoDetail/BranchProtectionPanel'

const proAPI = (overrides = {}) => ({
    fetchBranchProtection: vi.fn().mockRejectedValue(Object.assign(new Error('Upgrade'), { code: 'GITHUB_PRO_REQUIRED', status: 403 })),
    updateBranchProtection: vi.fn(),
    deleteBranchProtection: vi.fn(),
    ...overrides,
})

describe('BranchProtectionPanel — free plan private', () => {
    it('renders an inline upgrade strip variant when prop variant="inline" is set', async () => {
        render(<BranchProtectionPanel api={proAPI()} branch="main" archived={false} variant="inline" />)
        await waitFor(() => {
            // Inline variant: no large card, just one strip
            expect(screen.queryByRole('heading', { name: /Branch protection requires GitHub Pro/i })).toBeNull()
            expect(screen.getByText(/Pro to protect/i)).toBeInTheDocument()
        })
    })

    it('renders the existing full card when variant is unset', async () => {
        render(<BranchProtectionPanel api={proAPI()} branch="main" archived={false} />)
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: /Branch protection requires GitHub Pro/i })).toBeInTheDocument()
        })
    })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/components/RepoDetail/BranchProtectionPanel.test.jsx`
Expected: fail — no `variant` prop yet.

- [ ] **Step 3: Add the `variant` branch**

In `BranchProtectionPanel.jsx`, accept a new prop:

```jsx
export function BranchProtectionPanel({ api, branch, archived, variant = 'card' }) {
```

When `variant === 'inline'`, render only the inline summary instead of the full card. Insert near the top of the JSX return (before the existing `loading` guard):

```jsx
if (variant === 'inline') {
    if (loading) return <span className="text-xs text-slate-400">Checking protection…</span>
    if (upgradeRequired) {
        return (
            <a href="https://github.com/pricing" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/50 hover:underline">
                ⚠ Pro to protect
            </a>
        )
    }
    if (!savedRules) {
        return <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">unprotected</span>
    }
    return <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">protected</span>
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/components/RepoDetail/BranchProtectionPanel.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/components/RepoDetail/BranchProtectionPanel.jsx tests/components/RepoDetail/BranchProtectionPanel.test.jsx
git commit -m "feat(branches): inline variant for BranchProtectionPanel"
```

---

## Task 16: Branches tab — search, sort, filter chips, branch row enrichment

**Files:**
- Modify: `src/components/RepoDetail/BranchesTab.jsx`
- Test: `tests/components/RepoDetail/BranchesTab.test.jsx` (extend / create)

- [ ] **Step 1: Write the failing tests**

Add to `tests/components/RepoDetail/BranchesTab.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BranchesTab } from '../../../src/components/RepoDetail/BranchesTab'

const BRANCHES = [
    { name: 'main', commit: { sha: 'aaaaaaa1234567', author: { date: '2026-05-08T10:00:00Z' } }, protected: true },
    { name: 'feat/active', commit: { sha: 'bbbbbbb1234567', author: { date: '2026-05-07T10:00:00Z' } }, protected: false },
    { name: 'old/stale-branch', commit: { sha: 'cccccccc234567', author: { date: '2025-01-01T10:00:00Z' } }, protected: false },
]

const api = {
    fetchBranches: vi.fn().mockResolvedValue(BRANCHES),
    fetchBranchProtection: vi.fn().mockResolvedValue({ protected: false }),
    createBranch: vi.fn(),
    deleteBranch: vi.fn(),
}
const repoData = { default_branch: 'main', archived: false }

describe('BranchesTab — search / sort / filter', () => {
    it('filters by search term', async () => {
        render(<BranchesTab api={api} repoData={repoData} />)
        await waitFor(() => screen.getByText('feat/active'))
        fireEvent.change(screen.getByPlaceholderText(/search branches/i), { target: { value: 'feat' } })
        expect(screen.queryByText('old/stale-branch')).toBeNull()
        expect(screen.getByText('feat/active')).toBeInTheDocument()
    })

    it('Stale chip narrows to branches with no commits in 90+ days', async () => {
        render(<BranchesTab api={api} repoData={repoData} />)
        await waitFor(() => screen.getByText('old/stale-branch'))
        fireEvent.click(screen.getByRole('button', { name: /^Stale$/ }))
        expect(screen.getByText('old/stale-branch')).toBeInTheDocument()
        expect(screen.queryByText('feat/active')).toBeNull()
    })

    it('pins the default branch at the top regardless of sort', async () => {
        render(<BranchesTab api={api} repoData={repoData} />)
        await waitFor(() => screen.getByText('main'))
        const rows = screen.getAllByRole('listitem')
        expect(rows[0]).toHaveTextContent('main')
    })
})
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/components/RepoDetail/BranchesTab.test.jsx`
Expected: fail — UI doesn't have search/chips/listitem semantics yet.

- [ ] **Step 3: Update `BranchesTab.jsx`**

Replace the relevant sections of `BranchesTab.jsx`. Key changes:

a) Add filter state above the existing `useState` calls:
```jsx
const [search, setSearch] = useState('')
const [chip, setChip] = useState('all') // 'all' | 'active' | 'stale' | 'protected'
const [sort, setSort] = useState('recent') // 'recent' | 'name'
```

b) Replace the static `branches` mapping with filtered + sorted derivation:
```jsx
const STALE_DAYS = 90

const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000
    let out = branches.filter(b => !term || b.name.toLowerCase().includes(term))
    if (chip === 'protected') out = out.filter(b => b.protected)
    else if (chip === 'stale') out = out.filter(b => {
        const date = new Date(b.commit?.author?.date || b.commit?.committer?.date || 0).getTime()
        return date && date < cutoff
    })
    else if (chip === 'active') out = out.filter(b => {
        const date = new Date(b.commit?.author?.date || b.commit?.committer?.date || 0).getTime()
        return date && date >= cutoff
    })

    out.sort((a, b) => {
        // Default branch always first
        if (a.name === repoData?.default_branch) return -1
        if (b.name === repoData?.default_branch) return 1
        if (sort === 'name') return a.name.localeCompare(b.name)
        const da = new Date(a.commit?.author?.date || 0).getTime()
        const db = new Date(b.commit?.author?.date || 0).getTime()
        return db - da
    })
    return out
}, [branches, search, chip, sort, repoData?.default_branch])
```

c) Render a header row with the search box, chips, and sort dropdown above the existing list:
```jsx
<div className="flex flex-wrap gap-2 items-center pb-2">
    <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search branches…"
        className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
    />
    <div className="flex gap-1">
        {['all', 'active', 'stale', 'protected'].map(k => (
            <button key={k} type="button" onClick={() => setChip(k)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    chip === k
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}>
                {k.charAt(0).toUpperCase() + k.slice(1)}
            </button>
        ))}
    </div>
    <select value={sort} onChange={e => setSort(e.target.value)}
        className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs">
        <option value="recent">Recently active</option>
        <option value="name">Name A-Z</option>
    </select>
</div>
```

d) Change the list container to `<ul>` and rows to `<li role="listitem">` so the test can target them:
```jsx
<ul className="space-y-2" role="list">
    {filtered.map(b => (
        <li role="listitem" key={b.name}>
            <Card className={`p-3 flex items-center gap-3 group ${
                b.name === repoData?.default_branch ? 'ring-1 ring-indigo-200/60 dark:ring-indigo-800/50 bg-gradient-to-r from-indigo-50/40 to-transparent dark:from-indigo-950/20' : ''
            }`}>
                <GitBranch className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{b.name}</span>
                    {b.name === repoData?.default_branch && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide bg-indigo-600 text-white">default</span>
                    )}
                    {b.commit?.sha && (
                        <span className="text-xs text-slate-500 dark:text-slate-400 ml-2 font-mono">{b.commit.sha.substring(0, 7)}</span>
                    )}
                    {b.commit?.author?.date && (
                        <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">{formatRelativeTime(b.commit.author.date)}</span>
                    )}
                </div>
                {b.name === repoData?.default_branch ? (
                    <BranchProtectionPanel api={api} branch={b.name} archived={!!repoData.archived} variant="inline" />
                ) : b.protected && (
                    <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                        <Shield className="w-3 h-3" /> Protected
                    </span>
                )}
                <Button variant="ghost" size="sm" onClick={() => handleDelete(b)}
                    className="text-red-500 hover:text-red-700 dark:hover:text-red-400 md:opacity-0 md:group-hover:opacity-100"
                    title="Delete branch" aria-label={`Delete branch ${b.name}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                </Button>
            </Card>
        </li>
    ))}
</ul>
```

e) Drop the standalone large `<BranchProtectionPanel ... />` block above the list — the inline variant on the default-branch row replaces it. Add the `formatRelativeTime` import:
```jsx
import { formatRelativeTime } from '../../utils/format'
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/components/RepoDetail/BranchesTab.test.jsx`
Expected: PASS.

- [ ] **Step 5: Smoke test**

Run: `npm run dev:all`
Open Branches tab. Confirm:
- Search narrows the list
- Chips work (Active / Stale / Protected)
- Default branch pinned with gradient strip
- For free-plan-private repos: ONE inline `⚠ Pro to protect` chip on the default branch row, no large card
- DevTools console clean (no "unmapped error" warnings)

- [ ] **Step 6: Commit**

```
git add src/components/RepoDetail/BranchesTab.jsx tests/components/RepoDetail/BranchesTab.test.jsx
git commit -m "feat(branches): search, filter chips, sort, default-branch pinning"
```

---

## Task 17: E2E — repo README renders as markdown

**Files:**
- Create: `e2e/repo-readme.spec.js`

- [ ] **Step 1: Write the spec**

```js
import { test, expect } from '@playwright/test'

test('repo overview renders the README as real markdown', async ({ page }) => {
    // Reuse whichever fixture/seed your other e2e specs use to land logged-in
    // on a repo with a known markdown README. Substitute owner/repo accordingly.
    await page.goto('/repos/test-owner/test-readme')
    await page.getByRole('link', { name: /Overview/i }).click()

    // Table from the seeded README must render
    const table = page.getByRole('table')
    await expect(table).toBeVisible()

    // Banner image src must resolve to raw.githubusercontent.com
    const banner = page.locator('img').first()
    await expect(banner).toHaveAttribute('src', /raw\.githubusercontent\.com/)

    // Raw markdown source must NOT be visible as text
    await expect(page.getByText('| h1 | h2 |')).toHaveCount(0)
})
```

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/repo-readme.spec.js`
Expected: PASS. If the test fixture for `test-owner/test-readme` doesn't exist, **fix the fixture, don't loosen the test**.

- [ ] **Step 3: Commit**

```
git add e2e/repo-readme.spec.js
git commit -m "test(e2e): repo overview renders README as markdown"
```

---

## Task 18: E2E — commit diff viewer

**Files:**
- Create: `e2e/commit-diff-viewer.spec.js`

- [ ] **Step 1: Write the spec**

```js
import { test, expect } from '@playwright/test'

test('commit detail opens a Codex-style review surface that persists view state', async ({ page }) => {
    await page.goto('/repos/test-owner/test-commits')
    await page.getByRole('link', { name: /Commits/i }).click()

    // Open the first commit
    const firstCommit = page.getByRole('button', { name: /commit/i }).first()
    await firstCommit.click()

    // Expect file tree + diff
    await expect(page.getByRole('button', { name: /Previous file/i })).toBeVisible()
    const treeItem = page.locator('[data-testid="file-tree-item"]').first()
    await expect(treeItem).toBeVisible()

    // Toggle split/unified
    const modeBtn = page.getByRole('button', { name: /Split|Unified/ })
    const labelBefore = await modeBtn.textContent()
    await modeBtn.click()
    const labelAfter = await modeBtn.textContent()
    expect(labelBefore).not.toBe(labelAfter)

    // Mark as reviewed
    await page.getByLabel('Mark as reviewed').check()

    // Close modal and reopen — checkbox state must persist
    await page.keyboard.press('Escape')
    await firstCommit.click()
    await expect(page.getByLabel('Mark as reviewed')).toBeChecked()
})
```

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/commit-diff-viewer.spec.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add e2e/commit-diff-viewer.spec.js
git commit -m "test(e2e): commit diff viewer parity with PR review"
```

---

## Task 19: E2E — branches free-plan-private renders cleanly

**Files:**
- Create: `e2e/branches-free-plan.spec.js`

- [ ] **Step 1: Write the spec**

```js
import { test, expect } from '@playwright/test'

test('branches tab on a free-plan private repo shows one inline Pro chip and no console noise', async ({ page }) => {
    const consoleNoise = []
    page.on('console', msg => {
        if (msg.type() === 'warn' && /\[formatUserError\] unmapped/i.test(msg.text())) {
            consoleNoise.push(msg.text())
        }
    })

    await page.goto('/repos/free-owner/private-repo')
    await page.getByRole('link', { name: /Branches/i }).click()

    // The big upgrade card must not exist
    await expect(page.getByRole('heading', { name: /Branch protection requires GitHub Pro/i })).toHaveCount(0)
    // The inline chip on the default branch must exist
    await expect(page.getByText(/Pro to protect/i)).toBeVisible()

    // No unmapped-error warnings
    expect(consoleNoise).toEqual([])
})
```

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/branches-free-plan.spec.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add e2e/branches-free-plan.spec.js
git commit -m "test(e2e): branches tab clean on free-plan-private repos"
```

---

## Task 20: Final regression sweep + manual smoke

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run`
Expected: all PASS. Investigate any failure; do not skip.

- [ ] **Step 2: Run the full e2e suite**

Run: `npx playwright test`
Expected: all PASS.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean build. Note bundle-size delta from `scripts/check-bundle-size.mjs` output. If size grew by more than ~30KB gzipped, investigate (likely culprit: rehype-raw + rehype-sanitize on the README path; ensure they're tree-shaken when the README isn't shown).

- [ ] **Step 5: Manual smoke (repeat the user's flow)**

`npm run dev:all` and walk through:
1. Open BolaLabs/MainSite → Overview → README renders with table, banner image, headings (no raw markdown text).
2. Switch to Branches → DevTools console clean, ONE chip on `main`, search/filter/sort visible.
3. Switch to Commits → click first commit → full-bleed modal, file tree, syntax-highlighted diff, working split/unified, working "Mark as reviewed", "Copy SHA" works.
4. Switch to Pull Requests → open a PR → Files tab UX is unchanged (regression check).

- [ ] **Step 6: Final commit if anything was tweaked during smoke**

```
git status
# only commit if there are uncommitted fixes from smoke testing
```

---

## Self-review (planner pass)

**Spec coverage check:**
- README rendering → Tasks 3, 4, 5, 6, 7 ✓
- Branches bug fix → Tasks 1, 2 ✓
- Branches polish → Tasks 15, 16 ✓
- Codex-style commit viewer → Tasks 8, 9, 10, 11, 12, 13, 14 ✓
- Diff viewer enhancements (wrap, tab-width) → Tasks 9, 10, 11 ✓
- Tests (unit + e2e) → integrated per task + dedicated 17/18/19 ✓

**Placeholder scan:** clean — no TBDs remain that aren't covered by step instructions ("if PASSES, skip to Step 6" is structured branching, not a placeholder).

**Type/method consistency:**
- `RepoMarkdown` props: `source, owner, repo, branch, className` — used identically in OverviewTab call site.
- `CodeReviewSurface` props: `files, storageKey, sortFiles, fileMeta, headerSlot, rightSlot, emptyState, initialActiveIndex` — referenced consistently in PRFilesTab + CommitDetailPanel + tests.
- `useDiffPreferences()` returns `{ prefs: { mode, wrap, tabWidth }, setMode, setWrap, setTabWidth }` — same names in CodeReviewSurface and CodeReviewToolbar.
- `KNOWN_ERRORS.GITHUB_PRO_REQUIRED` shape `{ title, body, severity, isRetryable }` matches adjacent entries (per "copy from a neighbour like RATE_LIMITED").
- Modal `size="full"` token used in CommitDetailPanel matches the value declared in Modal.jsx Task 8.

Plan is internally consistent.
