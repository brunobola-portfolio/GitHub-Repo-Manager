# PR Review Premium — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the PR detail Files tab into a 3-column premium code review surface (FileTree + syntax-highlighted diff + AI summary), reusing existing production-ready components with zero duplication.

**Architecture:** New `usePRData` shared hook eliminates double-fetch between PRDetailPanel and PRReviewView. New `PRFilesTab` component composes existing `DiffRenderer`, `FileTree`, and `AISummaryPanel` into a 3-column layout. PRDetailPanel delegates its Files tab to PRFilesTab; PRReviewView reads from the same cache.

**Tech Stack:** React 19, Vite 7, Tailwind CSS v4, Framer Motion, `@git-diff-view/react` (already installed), `@tanstack/react-virtual` (already installed)

**Spec:** `docs/specs/2026-05-03-pr-review-premium.md`

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| CREATE | `src/hooks/usePRData.js` | Shared PR data hook — parallel fetch, module-level cache |
| CREATE | `src/components/RepoDetail/PRFilesTab.jsx` | 3-column premium files view |
| MODIFY | `src/components/RepoDetail/PRDetailPanel.jsx` | Delegate Files tab; use usePRData |
| MODIFY | `src/components/PRReview/PRReviewView.jsx` | Read from usePRData cache |
| MODIFY | `src/__mocks__/mockRepoDetail.js` | Richer mock patches (multi-hunk diffs) |
| CREATE | `tests/hooks/usePRData.test.js` | Unit tests for shared hook |

**Read before editing:**
- `src/components/RepoDetail/PRDetailPanel.jsx` (650 lines) — understand existing tab structure
- `src/components/PRReview/PRReviewView.jsx` (307 lines) — understand existing fetch pattern
- `src/components/PRReview/DiffPanel/DiffRenderer.jsx` — props interface
- `src/components/PRReview/FileTree/FileTree.jsx` — props interface
- `src/components/PRReview/AIInsights/AISummaryPanel.jsx` — props interface
- `src/components/PRReview/hooks/useReviewAI.js` — hook signature
- `src/__mocks__/mockRepoDetail.js` — existing mock structure

---

## Task 1: `usePRData` shared hook

**Files:**
- Create: `src/hooks/usePRData.js`
- Create: `tests/hooks/usePRData.test.js`

### Step 1.1 — Write the failing tests

```js
// tests/hooks/usePRData.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePRData } from '../../src/hooks/usePRData'

const mockApi = {
  fetchPull: vi.fn(),
  fetchPullFiles: vi.fn(),
  fetchPullReviews: vi.fn(),
  fetchIssueComments: vi.fn(),
}

const DETAIL = { number: 1, title: 'Test PR', state: 'open' }
const FILES   = [{ filename: 'foo.js', additions: 5, deletions: 2, patch: '@@ -1 +1 @@\n-a\n+b' }]
const REVIEWS = [{ id: 1, state: 'APPROVED' }]
const COMMENTS = []

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.fetchPull.mockResolvedValue(DETAIL)
  mockApi.fetchPullFiles.mockResolvedValue(FILES)
  mockApi.fetchPullReviews.mockResolvedValue(REVIEWS)
  mockApi.fetchIssueComments.mockResolvedValue(COMMENTS)
})

describe('usePRData', () => {
  it('starts in loading state', () => {
    const { result } = renderHook(() =>
      usePRData(mockApi, { owner: 'acme', repo: 'backend', number: 1 })
    )
    expect(result.current.loading).toBe(true)
    expect(result.current.detail).toBeNull()
  })

  it('fetches all data in parallel and resolves', async () => {
    const { result } = renderHook(() =>
      usePRData(mockApi, { owner: 'acme', repo: 'backend', number: 1 })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.detail).toEqual(DETAIL)
    expect(result.current.files).toEqual(FILES)
    expect(result.current.reviews).toEqual(REVIEWS)
    expect(mockApi.fetchPull).toHaveBeenCalledWith(1)
    expect(mockApi.fetchPullFiles).toHaveBeenCalledWith(1)
  })

  it('returns cached data without re-fetching', async () => {
    const opts = { owner: 'acme', repo: 'backend', number: 1 }
    const { result: r1 } = renderHook(() => usePRData(mockApi, opts))
    await waitFor(() => expect(r1.current.loading).toBe(false))

    const { result: r2 } = renderHook(() => usePRData(mockApi, opts))
    await waitFor(() => expect(r2.current.loading).toBe(false))

    // fetchPull called only once across two renders (cache hit on second)
    expect(mockApi.fetchPull).toHaveBeenCalledTimes(1)
  })

  it('does not fetch when enabled=false', () => {
    renderHook(() =>
      usePRData(mockApi, { owner: 'acme', repo: 'backend', number: 1, enabled: false })
    )
    expect(mockApi.fetchPull).not.toHaveBeenCalled()
  })

  it('sets error on fetch failure', async () => {
    mockApi.fetchPull.mockRejectedValue(new Error('network error'))
    const { result } = renderHook(() =>
      usePRData(mockApi, { owner: 'acme', repo: 'backend', number: 2 })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('network error')
  })
})
```

- [ ] Save the test file above to `tests/hooks/usePRData.test.js`

### Step 1.2 — Run tests to confirm they fail

```bash
npx vitest run tests/hooks/usePRData.test.js
```

Expected: `Cannot find module '../../src/hooks/usePRData'`

- [ ] Confirm failure

### Step 1.3 — Implement `usePRData`

```js
// src/hooks/usePRData.js
import { useState, useEffect, useCallback, useRef } from 'react'
import { MOCK_MODE } from '../config'

// Module-level cache so PRDetailPanel and PRReviewView share the same data.
// Key: "owner/repo/number"
const _cache = new Map()

function cacheKey(owner, repo, number) {
  return `${owner}/${repo}/${number}`
}

const EMPTY = { detail: null, files: [], reviews: [], comments: [], loading: true, error: null }

export function usePRData(api, { owner, repo, number, enabled = true } = {}) {
  const key = cacheKey(owner, repo, number)
  const [state, setState] = useState(() => _cache.get(key) ?? EMPTY)
  // Keep ref in sync so `reload` closure always reads latest key without re-creating
  const keyRef = useRef(key)
  keyRef.current = key

  const load = useCallback(async () => {
    if (!enabled || !owner || !repo || !number) return
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      const [detail, files, reviews, comments] = await Promise.all([
        api.fetchPull(number),
        api.fetchPullFiles(number),
        api.fetchPullReviews(number),
        api.fetchIssueComments(number),
      ])
      const next = { detail, files, reviews, comments, loading: false, error: null }
      _cache.set(keyRef.current, next)
      setState(next)
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: e?.message ?? 'Failed to load PR' }))
    }
  }, [api, owner, repo, number, enabled])

  useEffect(() => {
    // If cache already has fresh data, skip the fetch
    if (_cache.has(key) && !MOCK_MODE) {
      setState(_cache.get(key))
      return
    }
    load()
  }, [key, load])

  return { ...state, reload: load }
}

/** Call this after a merge/close/update to force a fresh fetch next time. */
export function invalidatePRData(owner, repo, number) {
  _cache.delete(cacheKey(owner, repo, number))
}
```

- [ ] Save the implementation above to `src/hooks/usePRData.js`

### Step 1.4 — Run tests to confirm they pass

```bash
npx vitest run tests/hooks/usePRData.test.js
```

Expected: 5 passing

- [ ] Confirm all 5 pass

### Step 1.5 — Commit

```bash
git add src/hooks/usePRData.js tests/hooks/usePRData.test.js
git commit -m "feat(pr-review): add usePRData shared hook with module-level cache"
```

---

## Task 2: Enhance mock patches for realistic diffs

**Files:**
- Modify: `src/__mocks__/mockRepoDetail.js`

The current mock patches are single-line stubs. `DiffRenderer` needs realistic multi-hunk unified diff format to render properly.

### Step 2.1 — Read the current `generateMockPRFiles` function

Open `src/__mocks__/mockRepoDetail.js` and find `generateMockPRFiles`. Note the current patch format.

- [ ] Read the file

### Step 2.2 — Replace with richer mock patches

Find and replace the `generateMockPRFiles` function. The exact location will vary — search for `generateMockPRFiles`:

```js
const RICH_PATCHES = [
  // client.js patch
  `@@ -1,12 +1,15 @@\n import axios from 'axios'\n \n-const BASE_URL = 'http://localhost:3000'\n+const BASE_URL = process.env.VITE_API_BASE || 'http://localhost:3000'\n+const PAGE_SIZE = 20\n \n export async function fetchRepos(page = 1) {\n-  const res = await axios.get(\`\${BASE_URL}/repos?page=\${page}\`)\n+  const res = await axios.get(\`\${BASE_URL}/repos\`, {\n+    params: { page, per_page: PAGE_SIZE },\n+  })\n   return res.data\n }\n \n+export async function fetchRepo(owner, name) {\n+  const res = await axios.get(\`\${BASE_URL}/repos/\${owner}/\${name}\`)\n+  return res.data\n+}\n`,
  // Button.jsx patch
  `@@ -1,8 +1,10 @@\n import { clsx } from 'clsx'\n \n-export function Button({ children, onClick, disabled }) {\n+export function Button({ children, onClick, disabled, variant = 'primary', size = 'md' }) {\n+  const sizes = { sm: 'px-2 py-1 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-base' }\n   return (\n     <button\n       onClick={onClick}\n       disabled={disabled}\n-      className="px-4 py-2 bg-indigo-600 text-white rounded-lg"\n+      className={clsx(sizes[size], variant === 'primary' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800', 'rounded-lg transition-colors')}\n     >\n       {children}\n     </button>\n   )\n }`,
  // useAuth.js patch
  `@@ -12,7 +12,12 @@ import { useState, useEffect } from 'react'\n \n export function useAuth() {\n   const [user, setUser] = useState(null)\n+  const [loading, setLoading] = useState(true)\n \n   useEffect(() => {\n-    fetch('/api/user').then(r => r.json()).then(setUser)\n-  }, [])\n+    fetch('/api/user')\n+      .then(r => r.ok ? r.json() : Promise.reject(r.status))\n+      .then(setUser)\n+      .catch(() => setUser(null))\n+      .finally(() => setLoading(false))\n+  }, [])\n \n-  return { user }\n+  return { user, loading }\n }`,
  // formatters.js patch
  `@@ -1,6 +1,20 @@\n+/** Format a number with locale-aware thousands separators */\n export function formatNumber(n) {\n-  return n.toLocaleString()\n+  if (n == null) return '—'\n+  if (n >= 1_000_000) return \`\${(n / 1_000_000).toFixed(1)}M\`\n+  if (n >= 1_000) return \`\${(n / 1_000).toFixed(1)}k\`\n+  return n.toLocaleString()\n }\n \n+/** Format an ISO date string as a relative time label */\n+export function formatRelativeTime(isoString) {\n+  if (!isoString) return ''\n+  const diff = Date.now() - new Date(isoString).getTime()\n+  const mins = Math.round(diff / 60_000)\n+  if (mins < 1) return 'just now'\n+  if (mins < 60) return \`\${mins}m ago\`\n+  const hrs = Math.round(mins / 60)\n+  if (hrs < 24) return \`\${hrs}h ago\`\n+  return \`\${Math.round(hrs / 24)}d ago\`\n+}`,
]
```

Then update `generateMockPRFiles` to use these patches:

```js
export function generateMockPRFiles(prNumber) {
  const s = seed(String(prNumber))
  const fileNames = [
    'src/api/client.js',
    'src/components/Button/Button.jsx',
    'src/hooks/useAuth.js',
    'src/utils/formatters.js',
  ]
  const statuses = ['modified', 'modified', 'modified', 'modified']
  return fileNames.map((filename, i) => ({
    sha: SHAS[(s + i) % SHAS.length],
    filename,
    status: statuses[i],
    additions: [39, 40, 41, 42][i],
    deletions: [21, 2, 3, 4][i],
    changes: [60, 42, 44, 46][i],
    patch: RICH_PATCHES[i % RICH_PATCHES.length],
  }))
}
```

- [ ] Add `RICH_PATCHES` constant before `generateMockPRFiles` in the file
- [ ] Replace the body of `generateMockPRFiles` with the code above

### Step 2.3 — Commit

```bash
git add src/__mocks__/mockRepoDetail.js
git commit -m "feat(mock): richer multi-hunk PR diff patches for demo mode"
```

---

## Task 3: `PRFilesTab` — 3-column premium component

**Files:**
- Create: `src/components/RepoDetail/PRFilesTab.jsx`

### Step 3.1 — Read the existing component interfaces

Before writing, confirm the exact props each reused component accepts:

```bash
# DiffRenderer props: { filename, patch, mode ('unified'|'split') }
grep -n "export function DiffRenderer\|function DiffRenderer" src/components/PRReview/DiffPanel/DiffRenderer.jsx

# FileTree props: { files, activeFile, reviewedFiles, aiFileRisks, onFileClick, sortByRisk }
grep -n "export function FileTree\|function FileTree" src/components/PRReview/FileTree/FileTree.jsx

# AISummaryPanel props: { summary, loading, error, collapsed, onToggle, onRetry, onFileClick }
grep -n "export function AISummaryPanel" src/components/PRReview/AIInsights/AISummaryPanel.jsx
```

- [ ] Run the commands and confirm props match what's used in Task 3.3

### Step 3.2 — Verify DiffRenderer prop names by reading it

```bash
head -30 src/components/PRReview/DiffPanel/DiffRenderer.jsx
```

Note the exact prop names. If they differ from `{ filename, patch, mode }`, adjust Task 3.3 accordingly.

- [ ] Read and note prop names

### Step 3.3 — Implement `PRFilesTab`

```jsx
// src/components/RepoDetail/PRFilesTab.jsx
import { useState, useMemo } from 'react'
import { Columns2, AlignLeft, PanelRightClose, PanelRightOpen, ChevronLeft, ChevronRight } from 'lucide-react'
import { FileTree } from '../PRReview/FileTree/FileTree'
import { DiffRenderer } from '../PRReview/DiffPanel/DiffRenderer'
import { AISummaryPanel } from '../PRReview/AIInsights/AISummaryPanel'
import { useReviewAI, sortFilesByRisk } from '../PRReview/hooks/useReviewAI'
import { Spinner } from '../ui/Spinner'
import { MOCK_MODE } from '../../config'

/**
 * PRFilesTab — premium 3-column code review surface.
 *
 * Left:   FileTree (navigation, progress tracking)
 * Centre: DiffRenderer (syntax-highlighted diff of active file)
 * Right:  AISummaryPanel (PR-level AI analysis, collapsible)
 *
 * @param {{ files: Array, owner: string, repo: string, pr: object }} props
 */
export function PRFilesTab({ files = [], owner, repo, pr }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [reviewed, setReviewed] = useState(() => new Set())
  const [diffMode, setDiffMode] = useState('unified')
  const [aiCollapsed, setAiCollapsed] = useState(false)
  const [treeCollapsed, setTreeCollapsed] = useState(false)

  // Suppress AI fetch in mock mode — useReviewAI uses !headSha to skip the request
  const headSha = MOCK_MODE ? '' : (pr?.head?.sha ?? '')
  const prNumber = pr?.number ?? 0

  const sortedFiles = useMemo(() => sortFilesByRisk(files, {}), [files])

  const {
    summary: aiSummary,
    loading: aiLoading,
    error: aiError,
    retry: retryAI,
  } = useReviewAI(owner, repo, prNumber, headSha, files)

  const activeFile = sortedFiles[activeIndex] ?? null

  function toggleReviewed(filename) {
    setReviewed(prev => {
      const next = new Set(prev)
      next.has(filename) ? next.delete(filename) : next.add(filename)
      return next
    })
  }

  function handleFileClick(filename) {
    const idx = sortedFiles.findIndex(f => f.filename === filename)
    if (idx !== -1) setActiveIndex(idx)
  }

  function handlePrev() {
    setActiveIndex(i => Math.max(0, i - 1))
  }
  function handleNext() {
    setActiveIndex(i => Math.min(sortedFiles.length - 1, i + 1))
  }

  if (!files.length) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-slate-500 dark:text-slate-400">
        No files changed in this PR.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 flex-shrink-0">
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <button
            onClick={() => setTreeCollapsed(c => !c)}
            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            aria-label={treeCollapsed ? 'Show file tree' : 'Hide file tree'}
          >
            {treeCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
          <span>
            <span className="font-semibold text-slate-700 dark:text-slate-200">{files.length}</span> files changed
            {' · '}
            <span className="text-green-600 dark:text-green-400">
              +{files.reduce((s, f) => s + (f.additions || 0), 0)}
            </span>
            {' '}
            <span className="text-red-600 dark:text-red-400">
              −{files.reduce((s, f) => s + (f.deletions || 0), 0)}
            </span>
          </span>
          <span className="text-slate-400">·</span>
          <span>
            <span className="font-semibold text-indigo-600 dark:text-indigo-400">{reviewed.size}</span>/{files.length} reviewed
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Prev / Next file */}
          <button
            onClick={handlePrev}
            disabled={activeIndex === 0}
            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            aria-label="Previous file"
          >
            <ChevronLeft className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400 w-14 text-center tabular-nums">
            {activeIndex + 1} / {sortedFiles.length}
          </span>
          <button
            onClick={handleNext}
            disabled={activeIndex === sortedFiles.length - 1}
            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            aria-label="Next file"
          >
            <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          </button>

          <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

          {/* Diff mode toggle */}
          <button
            onClick={() => setDiffMode(m => m === 'unified' ? 'split' : 'unified')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
          >
            {diffMode === 'unified'
              ? <><Columns2 className="w-3.5 h-3.5" /> Split</>
              : <><AlignLeft className="w-3.5 h-3.5" /> Unified</>
            }
          </button>

          {/* AI sidebar toggle */}
          <button
            onClick={() => setAiCollapsed(c => !c)}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
            aria-label={aiCollapsed ? 'Show AI insights' : 'Hide AI insights'}
          >
            {aiCollapsed
              ? <PanelRightOpen className="w-3.5 h-3.5" />
              : <PanelRightClose className="w-3.5 h-3.5" />
            }
          </button>
        </div>
      </div>

      {/* Main 3-column layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: File Tree */}
        {!treeCollapsed && (
          <div className="w-[220px] flex-shrink-0 border-r border-slate-200 dark:border-slate-700 overflow-y-auto bg-slate-50/40 dark:bg-slate-800/20">
            <FileTree
              files={sortedFiles}
              activeFile={activeFile?.filename ?? ''}
              reviewedFiles={[...reviewed]}
              aiFileRisks={aiSummary?.fileRisks ?? []}
              onFileSelect={handleFileClick}
            />
            {/* Reviewed checkbox for active file */}
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

        {/* Centre: Diff */}
        <div className="flex-1 min-w-0 overflow-auto">
          {activeFile ? (
            <div className="min-w-0">
              {/* Sticky file header */}
              <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-100 dark:border-slate-800 text-xs">
                <span className="font-mono text-slate-700 dark:text-slate-200 font-medium truncate">
                  {activeFile.filename}
                </span>
                <span className="flex-shrink-0 text-green-600 dark:text-green-400">+{activeFile.additions}</span>
                <span className="flex-shrink-0 text-red-600 dark:text-red-400">−{activeFile.deletions}</span>
              </div>
              {activeFile.patch ? (
                <DiffRenderer
                  filename={activeFile.filename}
                  patch={activeFile.patch}
                  mode={diffMode}
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

        {/* Right: AI Insights */}
        {!aiCollapsed && (
          <div className="w-[280px] flex-shrink-0 border-l border-slate-200 dark:border-slate-700 overflow-y-auto bg-slate-50/40 dark:bg-slate-800/20 p-3">
            {MOCK_MODE && !aiSummary && !aiLoading ? (
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
                onFileClick={handleFileClick}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] Save the file to `src/components/RepoDetail/PRFilesTab.jsx`

### Step 3.4 — Verify DiffRenderer import path is correct

```bash
ls src/components/PRReview/DiffPanel/
```

Confirm `DiffRenderer.jsx` exists. If the path differs, update the import in `PRFilesTab.jsx`.

- [ ] Confirm path

### Step 3.5 — Commit

```bash
git add src/components/RepoDetail/PRFilesTab.jsx
git commit -m "feat(pr-review): add PRFilesTab 3-column premium files view"
```

---

## Task 4: Wire `PRDetailPanel` to use `PRFilesTab` and `usePRData`

**Files:**
- Modify: `src/components/RepoDetail/PRDetailPanel.jsx`

### Step 4.1 — Read the current PRDetailPanel structure

```bash
wc -l src/components/RepoDetail/PRDetailPanel.jsx
head -80 src/components/RepoDetail/PRDetailPanel.jsx
grep -n "activeTab\|Files\|fetchPull\|Promise.all\|fetchPullFiles" src/components/RepoDetail/PRDetailPanel.jsx | head -30
```

Note:
1. How the component fetches data (look for `useEffect` + `Promise.all`)
2. How the "Files" tab is rendered (look for `activeTab === 'files'` or similar)
3. What props the component accepts
4. Where `owner` and `repo` come from (likely from `pr.base.repo.owner.login` or passed as props)

- [ ] Read and note the above

### Step 4.2 — Add imports to PRDetailPanel

At the top of `PRDetailPanel.jsx`, add these two imports after the existing imports:

```jsx
import { PRFilesTab } from './PRFilesTab'
import { usePRData, invalidatePRData } from '../../hooks/usePRData'
```

- [ ] Add imports

### Step 4.3 — Extract `owner` and `repo` from the PR object

Inside `PRDetailPanel`, before any `useEffect`, ensure `owner` and `repo` are extracted:

```jsx
const owner = pr?.base?.repo?.owner?.login ?? pr?.user?.login ?? ''
const repo  = pr?.base?.repo?.name ?? ''
```

If these variables already exist under different names, use those names in the next step.

- [ ] Add or verify `owner` and `repo` extraction

### Step 4.4 — Replace the Files tab JSX with `<PRFilesTab>`

Find the block that renders the Files tab content (it will contain the old `<pre>` / `PRFileDiff` rendering). Replace only that inner content with:

```jsx
{activeTab === 'files' && (
  <div className="flex flex-col" style={{ height: 'calc(100vh - 280px)', minHeight: '400px' }}>
    <PRFilesTab
      files={files}
      owner={owner}
      repo={repo}
      pr={pr}
    />
  </div>
)}
```

The `files` variable should already be in scope from the existing data fetch. If the tab conditional uses a different string (e.g., `'Files'`), match it exactly.

- [ ] Replace Files tab content

### Step 4.5 — Call `invalidatePRData` on close/update

Find where `onUpdate` or `onClose` is called (merge, close PR actions). After each call, add:

```jsx
invalidatePRData(owner, repo, pr.number)
```

This ensures the next open gets fresh data after a state-changing action.

- [ ] Add invalidation calls

### Step 4.6 — Test in the browser

Start the dev server and navigate to a PR's Files tab:

```bash
npm run dev
```

1. Open the app in demo mode (`VITE_MOCK_MODE=true`)
2. Go to Repositories → any repo → Pull Requests tab → click a PR
3. Click the "Files" tab
4. Verify: file tree on the left, syntax-highlighted diff in the centre, AI panel on the right
5. Click a file in the tree — verify diff changes
6. Toggle Unified/Split — verify diff mode changes
7. Check console for errors — should be zero 401/404s

- [ ] Visual verification complete

### Step 4.7 — Commit

```bash
git add src/components/RepoDetail/PRDetailPanel.jsx
git commit -m "feat(pr-review): wire PRDetailPanel Files tab to PRFilesTab 3-column layout"
```

---

## Task 5: Wire `PRReviewView` to use `usePRData` cache

**Files:**
- Modify: `src/components/PRReview/PRReviewView.jsx`

### Step 5.1 — Read the current PRReviewView data fetching

```bash
grep -n "useEffect\|fetchPull\|Promise.all\|useState" src/components/PRReview/PRReviewView.jsx | head -30
```

Identify how it currently fetches data (likely via `useReviewData` hook or direct API calls).

- [ ] Read and note

### Step 5.2 — Check `useReviewData` hook

```bash
cat src/components/PRReview/hooks/useReviewData.js
```

Note what it returns and how it fetches.

- [ ] Read `useReviewData.js`

### Step 5.3 — Add `usePRData` as initial data source

In `PRReviewView.jsx`, add at the top of the component (after existing hooks):

```jsx
import { usePRData } from '../../hooks/usePRData'

// Inside component, before useReviewData:
// Read from shared cache — if user came from PRDetailPanel, data is already there
const cached = usePRData(api, {
  owner,
  repo,
  number: prNumber,
  enabled: false, // don't trigger fetch — just read cache
})
```

Then pass `cached.files` as `initialFiles` to `useReviewData` if it supports an initial value, **or** use `cached.files` as the files array when `useReviewData` hasn't loaded yet:

```jsx
const files = reviewData.files?.length ? reviewData.files : cached.files
```

The exact integration depends on `useReviewData`'s API. The goal: if `cached.files` is non-empty, the review opens without a loading state.

- [ ] Add cache read to PRReviewView

### Step 5.4 — Test the transition

1. Open a PR in PRDetailPanel, click Files tab (loads data into cache)
2. Click "Deep Review →" or "Start Review" button
3. PRReviewView should open with **no loading spinner** — data already in cache
4. Verify in DevTools Network tab: no duplicate fetch for the same PR number

- [ ] Verify instant open from cached state

### Step 5.5 — Commit

```bash
git add src/components/PRReview/PRReviewView.jsx
git commit -m "perf(pr-review): PRReviewView reads from usePRData cache — instant open"
```

---

## Task 6: Final validation

### Step 6.1 — Run full unit test suite

```bash
npx vitest run
```

Expected: all existing tests pass, plus the 5 new usePRData tests.

- [ ] All tests pass

### Step 6.2 — Console error check

Open the app in mock mode. Navigate through:
- Dashboard
- Work Board
- Repositories → any repo → Pull Requests → any PR → Files tab

Open DevTools Console. Verify:
- Zero `401 (Unauthorized)` errors
- Zero `404 (Not Found)` errors
- No React key prop warnings
- No nested `<button>` warnings

- [ ] Console is clean

### Step 6.3 — Dark mode check

Toggle dark mode and repeat the PR Files tab check. Verify:
- Diff renderer uses dark theme
- File tree, AI panel, top bar all render correctly in dark

- [ ] Dark mode verified

### Step 6.4 — Final commit

```bash
git add -A
git status  # verify no untracked artifacts (coverage/, dist/, .vite/)
git commit -m "feat(pr-review): premium 3-column PR review experience — syntax highlight, file tree, AI insights"
```

---

## Quick Reference — Existing Component Props

### `DiffRenderer`
```jsx
<DiffRenderer
  filename="src/api/client.js"   // string — used for language detection
  patch="@@ -1 +1 @@\n..."       // string — unified diff patch
  mode="unified"                  // 'unified' | 'split'
/>
```

### `FileTree`
```jsx
<FileTree
  files={sortedFiles}            // Array<{ filename, additions, deletions, status }>
  activeFile="src/api/client.js" // string — currently viewed file
  reviewedFiles={[...reviewed]}  // string[] — filenames marked reviewed (NOT a Set)
  aiFileRisks={aiSummary?.fileRisks ?? []}  // Array<{ file|filename, level|risk }> from AI
  heuristicScores={hMap}         // optional { [filename]: number } precomputed map
  onFileSelect={fn}              // (filename: string) => void  ← NOT onFileClick
  sortMode="risk"                // 'risk' | 'az' — controls sort toggle UI
  onSortChange={fn}              // (mode: string) => void
/>
```

### `AISummaryPanel`
```jsx
<AISummaryPanel
  summary={aiSummary}    // object | null — from useReviewAI
  loading={aiLoading}    // boolean
  error={aiError}        // string | null
  collapsed={false}      // boolean
  onToggle={() => {}}    // () => void
  onRetry={retryFn}      // () => void
  onFileClick={fn}       // (filename: string) => void
/>
```

### `useReviewAI`
```jsx
const { summary, loading, error, retry } = useReviewAI(
  owner,      // string
  repo,       // string
  prNumber,   // number
  headSha,    // string — PR head commit SHA (cache key)
  files,      // Array<file objects>
)
```
