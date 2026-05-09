# PR Review — Slice 2: Pro-grade Diff Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the single-file diff renderer comfortable with thousands of changed lines without forking `@git-diff-view/react`, swapping libraries, or adding new top-level dependencies. Concretely: a 10k-line file paints in <600 ms on a mid-tier laptop dev build, a 50k-line file shows a click-to-compute placeholder instead of locking the tab, and the inline composer stays visible while a long diff scrolls behind it.

**Architecture:**
- `DiffRenderer.jsx` becomes a router that picks one of three render strategies based on file size:
  - **≤500 changed lines** → current passthrough to `<DiffView>` (no overhead).
  - **501–50,000 changed lines** → `<DiffCollapser>` wrapper that fold-by-defaults the diff and renders a one-screen preview hunk; user opts in to expand; expanded state persists in `localStorage`.
  - **>50,000 changed lines** → `<DiffComputeOnDemand>` placeholder card with file path, line count, and a "Compute diff" button that mounts the diff on demand.
- A small CSS rule on `.diff-renderer` adds `content-visibility: auto` + `contain-intrinsic-size` under `@supports`, helping when the whole diff sits off-screen (e.g. in a long PR with many small files mounted side-by-side at large viewports).
- `DiffPanel.jsx` lifts the inline composer out of the bottom-of-scroll-container position and renders it as a fixed-position floating card anchored to the right of the diff column on desktop, full-bleed bottom sheet on mobile (using existing `<Modal mobileVariant="sheet">`).
- `CodeReviewToolbar.jsx` gets two new buttons (Expand all / Collapse all) wired to a window event the `<DiffCollapser>` instances listen for.

**Tech Stack:** React 19 (`useDeferredValue`, `useSyncExternalStore` not needed), Vite, Vitest, Playwright; existing `@git-diff-view/react`, `framer-motion`. **Zero new top-level dependencies.**

**Spec reference:** [docs/specs/2026-05-09-pr-review-perf-and-polish-design.md](../specs/2026-05-09-pr-review-perf-and-polish-design.md), Slice 2 (revised post-validation 2026-05-09).
**Validation report:** [docs/reports/2026-05-09-huge-diff-rendering-validation.md](../reports/2026-05-09-huge-diff-rendering-validation.md).

---

## File map

- **New** `src/components/PRReview/DiffPanel/DiffCollapser.jsx` — fold/expand wrapper with localStorage persistence.
- **New** `src/components/PRReview/DiffPanel/DiffComputeOnDemand.jsx` — placeholder for >50k-line files.
- **New** `src/components/PRReview/DiffPanel/diffSize.js` — pure helper: `pickRenderStrategy({ additions, deletions })` returns `'pass' | 'collapse' | 'compute'`. Exported separately so unit tests don't have to mount React.
- **Modify** `src/components/PRReview/DiffPanel/DiffRenderer.jsx` — route based on `pickRenderStrategy` + add `useDeferredValue` for tab expansion.
- **Modify** `src/components/PRReview/DiffPanel/DiffPanel.jsx` — float the inline composer.
- **Modify** `src/components/diff/CodeReviewToolbar.jsx` — Expand all / Collapse all buttons.
- **Modify** `src/design-system.css` — `@supports (content-visibility: auto)` rule on `.diff-renderer`.
- **New** `tests/components/PRReview/DiffPanel/DiffCollapser.test.jsx`.
- **New** `tests/components/PRReview/DiffPanel/DiffComputeOnDemand.test.jsx`.
- **New** `tests/components/PRReview/DiffPanel/diffSize.test.js`.
- **Modify** `tests/components/PRReview/DiffPanel/DiffRenderer.test.jsx` — add routing tests.
- **New** `e2e/pr-review-large-diff.spec.js` — fixture PR with >500 lines, asserts collapse/expand/render.

---

## Task 1: `pickRenderStrategy` helper + tests

**Files:**
- Create: `src/components/PRReview/DiffPanel/diffSize.js`
- Test: `tests/components/PRReview/DiffPanel/diffSize.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/components/PRReview/DiffPanel/diffSize.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { pickRenderStrategy, FOLD_THRESHOLD, COMPUTE_THRESHOLD } from '@/components/PRReview/DiffPanel/diffSize'

describe('pickRenderStrategy', () => {
    it('exports the documented thresholds', () => {
        expect(FOLD_THRESHOLD).toBe(500)
        expect(COMPUTE_THRESHOLD).toBe(50_000)
    })

    it('returns "pass" for files at or below the fold threshold', () => {
        expect(pickRenderStrategy({ additions: 0, deletions: 0 })).toBe('pass')
        expect(pickRenderStrategy({ additions: 250, deletions: 250 })).toBe('pass')
        expect(pickRenderStrategy({ additions: 500, deletions: 0 })).toBe('pass')
    })

    it('returns "collapse" between the fold and compute thresholds', () => {
        expect(pickRenderStrategy({ additions: 501, deletions: 0 })).toBe('collapse')
        expect(pickRenderStrategy({ additions: 5_000, deletions: 4_000 })).toBe('collapse')
        expect(pickRenderStrategy({ additions: 50_000, deletions: 0 })).toBe('collapse')
    })

    it('returns "compute" above the compute threshold', () => {
        expect(pickRenderStrategy({ additions: 50_001, deletions: 0 })).toBe('compute')
        expect(pickRenderStrategy({ additions: 100_000, deletions: 100_000 })).toBe('compute')
    })

    it('treats missing additions/deletions as zero (defensive)', () => {
        expect(pickRenderStrategy({})).toBe('pass')
        expect(pickRenderStrategy(null)).toBe('pass')
        expect(pickRenderStrategy(undefined)).toBe('pass')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/PRReview/DiffPanel/diffSize.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/components/PRReview/DiffPanel/diffSize.js`:

```js
// Thresholds for picking how a single file's diff is rendered.
//
// FOLD_THRESHOLD: above this, the diff is folded by default and the user
// must opt in to expand. Mirrors GitHub's 2025 default and is the single
// most important mobile-correctness rule (an iOS Safari tab can be killed
// if a user lands on a 5k-line diff cold).
//
// COMPUTE_THRESHOLD: above this, even the folded preview is too expensive
// because the lib still parses the whole patch. We replace the diff with
// a placeholder card and only mount the renderer if the user clicks. This
// mirrors Monaco's `maxFileSize` pattern.
export const FOLD_THRESHOLD = 500
export const COMPUTE_THRESHOLD = 50_000

/**
 * Decide which of three render strategies to use for a single file's diff.
 *
 * @param {{ additions?: number, deletions?: number } | null | undefined} file
 * @returns {'pass' | 'collapse' | 'compute'}
 */
export function pickRenderStrategy(file) {
    const total = (file?.additions ?? 0) + (file?.deletions ?? 0)
    if (total > COMPUTE_THRESHOLD) return 'compute'
    if (total > FOLD_THRESHOLD) return 'collapse'
    return 'pass'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/PRReview/DiffPanel/diffSize.test.js`
Expected: PASS — all 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/components/PRReview/DiffPanel/diffSize.js tests/components/PRReview/DiffPanel/diffSize.test.js
git commit -m "feat(diff): pickRenderStrategy helper for size-tiered rendering

Pure helper that decides between pass-through, collapse-with-preview,
and compute-on-demand strategies based on a file's additions+deletions.
Thresholds: 500 (fold) and 50k (click to compute). Used by DiffRenderer
to route to the right wrapper component."
```

---

## Task 2: `<DiffCollapser>` component + tests

**Files:**
- Create: `src/components/PRReview/DiffPanel/DiffCollapser.jsx`
- Test: `tests/components/PRReview/DiffPanel/DiffCollapser.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/PRReview/DiffPanel/DiffCollapser.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { DiffCollapser, EXPANDED_STORAGE_KEY } from '@/components/PRReview/DiffPanel/DiffCollapser'

afterEach(() => {
    cleanup()
    localStorage.clear()
})

describe('DiffCollapser', () => {
    it('renders the placeholder + first hunk preview when collapsed', () => {
        render(
            <DiffCollapser
                filename="src/big.js"
                additions={1200}
                deletions={300}
                storageKey="pr:1"
            >
                {({ collapsed }) => collapsed ? null : <div data-testid="full">FULL DIFF</div>}
            </DiffCollapser>,
        )
        expect(screen.getByText(/1500 lines changed/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /show diff/i })).toBeInTheDocument()
        expect(screen.queryByTestId('full')).not.toBeInTheDocument()
    })

    it('renders children when the user clicks "Show diff"', () => {
        render(
            <DiffCollapser filename="src/big.js" additions={1200} deletions={0} storageKey="pr:1">
                {({ collapsed }) => collapsed ? null : <div data-testid="full">FULL DIFF</div>}
            </DiffCollapser>,
        )
        fireEvent.click(screen.getByRole('button', { name: /show diff/i }))
        expect(screen.getByTestId('full')).toBeInTheDocument()
    })

    it('persists the expanded set to localStorage and re-hydrates on mount', () => {
        const storageKey = 'pr:42'
        localStorage.setItem(`${EXPANDED_STORAGE_KEY}:${storageKey}`, JSON.stringify(['src/big.js']))
        render(
            <DiffCollapser filename="src/big.js" additions={1200} deletions={0} storageKey={storageKey}>
                {({ collapsed }) => collapsed ? null : <div data-testid="full">FULL DIFF</div>}
            </DiffCollapser>,
        )
        expect(screen.getByTestId('full')).toBeInTheDocument()
    })

    it('writes the filename into localStorage when expanded by user', () => {
        const storageKey = 'pr:99'
        render(
            <DiffCollapser filename="src/big.js" additions={1200} deletions={0} storageKey={storageKey}>
                {({ collapsed }) => collapsed ? null : <div data-testid="full">FULL DIFF</div>}
            </DiffCollapser>,
        )
        fireEvent.click(screen.getByRole('button', { name: /show diff/i }))
        const stored = JSON.parse(localStorage.getItem(`${EXPANDED_STORAGE_KEY}:${storageKey}`) || '[]')
        expect(stored).toContain('src/big.js')
    })

    it('responds to a global "expand-all" event', () => {
        render(
            <DiffCollapser filename="src/big.js" additions={1200} deletions={0} storageKey="pr:1">
                {({ collapsed }) => collapsed ? null : <div data-testid="full">FULL DIFF</div>}
            </DiffCollapser>,
        )
        expect(screen.queryByTestId('full')).not.toBeInTheDocument()
        window.dispatchEvent(new CustomEvent('diff-collapser:expand-all'))
        expect(screen.getByTestId('full')).toBeInTheDocument()
    })

    it('responds to a global "collapse-all" event', () => {
        const storageKey = 'pr:1'
        localStorage.setItem(`${EXPANDED_STORAGE_KEY}:${storageKey}`, JSON.stringify(['src/big.js']))
        render(
            <DiffCollapser filename="src/big.js" additions={1200} deletions={0} storageKey={storageKey}>
                {({ collapsed }) => collapsed ? null : <div data-testid="full">FULL DIFF</div>}
            </DiffCollapser>,
        )
        expect(screen.getByTestId('full')).toBeInTheDocument()
        window.dispatchEvent(new CustomEvent('diff-collapser:collapse-all'))
        expect(screen.queryByTestId('full')).not.toBeInTheDocument()
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/PRReview/DiffPanel/DiffCollapser.test.jsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the component**

Create `src/components/PRReview/DiffPanel/DiffCollapser.jsx`:

```jsx
import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, FileText } from 'lucide-react'

// localStorage prefix for the per-PR/per-commit expanded-files set.
// Final key is `${EXPANDED_STORAGE_KEY}:${storageKey}` where storageKey is
// the same key the surface uses for the reviewed-files set.
export const EXPANDED_STORAGE_KEY = 'diff-collapser:expanded'

function loadExpanded(storageKey) {
    if (!storageKey) return new Set()
    try {
        const raw = localStorage.getItem(`${EXPANDED_STORAGE_KEY}:${storageKey}`)
        return new Set(raw ? JSON.parse(raw) : [])
    } catch { return new Set() }
}

function saveExpanded(storageKey, set) {
    if (!storageKey) return
    try {
        localStorage.setItem(`${EXPANDED_STORAGE_KEY}:${storageKey}`, JSON.stringify([...set]))
    } catch { /* quota — silent */ }
}

/**
 * Wraps a single file's diff with a fold-by-default affordance. Renders
 * a "Show diff (N lines changed)" placeholder until the user opts in,
 * then renders children with `{ collapsed: false }` so the consumer can
 * mount the heavy <DiffView>. Persists the expanded set per storageKey
 * so reloading doesn't lose the user's choice.
 *
 * Listens for two window events for bulk control from the toolbar:
 *  - `diff-collapser:expand-all`
 *  - `diff-collapser:collapse-all`
 *
 * @param {object}   props
 * @param {string}   props.filename
 * @param {number}   props.additions
 * @param {number}   props.deletions
 * @param {string}   props.storageKey   - PR/commit-scoped key
 * @param {(state: { collapsed: boolean }) => React.ReactNode} props.children
 */
export function DiffCollapser({ filename, additions = 0, deletions = 0, storageKey, children }) {
    const total = additions + deletions

    const [expanded, setExpanded] = useState(() => loadExpanded(storageKey).has(filename))

    // Re-hydrate when storageKey or filename changes (PR navigation, file switch).
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot reset on key change
        setExpanded(loadExpanded(storageKey).has(filename))
    }, [storageKey, filename])

    const persist = useCallback((next) => {
        const set = loadExpanded(storageKey)
        if (next) set.add(filename); else set.delete(filename)
        saveExpanded(storageKey, set)
    }, [storageKey, filename])

    const handleExpand = useCallback(() => {
        setExpanded(true)
        persist(true)
    }, [persist])

    // Bulk expand/collapse from the toolbar.
    useEffect(() => {
        const onExpandAll = () => { setExpanded(true); persist(true) }
        const onCollapseAll = () => { setExpanded(false); persist(false) }
        window.addEventListener('diff-collapser:expand-all', onExpandAll)
        window.addEventListener('diff-collapser:collapse-all', onCollapseAll)
        return () => {
            window.removeEventListener('diff-collapser:expand-all', onExpandAll)
            window.removeEventListener('diff-collapser:collapse-all', onCollapseAll)
        }
    }, [persist])

    if (expanded) return children({ collapsed: false })

    return (
        <div className="diff-collapser p-6 text-center bg-slate-50/60 dark:bg-slate-800/30 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg m-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 mb-3">
                <FileText className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            </div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Large diff — {total} lines changed
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-md mx-auto">
                Folded by default to keep the page snappy. Expand only this file, or use Expand all in the toolbar.
            </p>
            <button
                type="button"
                onClick={handleExpand}
                className="inline-flex items-center gap-1 mt-4 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
                <ChevronRight className="w-3.5 h-3.5" /> Show diff
            </button>
        </div>
    )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/PRReview/DiffPanel/DiffCollapser.test.jsx`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/PRReview/DiffPanel/DiffCollapser.jsx tests/components/PRReview/DiffPanel/DiffCollapser.test.jsx
git commit -m "feat(diff): DiffCollapser fold-by-default wrapper for large files

Renders a placeholder card with file size for any file above the fold
threshold; user opts in to expand. Persists the expanded set in
localStorage keyed by storageKey + filename so reloading doesn't lose
the choice. Listens for bulk expand-all / collapse-all window events
fired by the toolbar."
```

---

## Task 3: `<DiffComputeOnDemand>` component + tests

**Files:**
- Create: `src/components/PRReview/DiffPanel/DiffComputeOnDemand.jsx`
- Test: `tests/components/PRReview/DiffPanel/DiffComputeOnDemand.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/PRReview/DiffPanel/DiffComputeOnDemand.test.jsx`:

```jsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { DiffComputeOnDemand } from '@/components/PRReview/DiffPanel/DiffComputeOnDemand'

afterEach(() => cleanup())

describe('DiffComputeOnDemand', () => {
    it('renders a placeholder with the file path and line count', () => {
        render(
            <DiffComputeOnDemand filename="src/huge.lock" additions={120_000} deletions={0}>
                <div data-testid="real-diff">REAL DIFF</div>
            </DiffComputeOnDemand>,
        )
        expect(screen.getByText(/src\/huge\.lock/)).toBeInTheDocument()
        expect(screen.getByText(/120000 lines changed/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /compute diff/i })).toBeInTheDocument()
        expect(screen.queryByTestId('real-diff')).not.toBeInTheDocument()
    })

    it('mounts children only after the user clicks "Compute diff"', () => {
        render(
            <DiffComputeOnDemand filename="src/huge.lock" additions={120_000} deletions={0}>
                <div data-testid="real-diff">REAL DIFF</div>
            </DiffComputeOnDemand>,
        )
        fireEvent.click(screen.getByRole('button', { name: /compute diff/i }))
        expect(screen.getByTestId('real-diff')).toBeInTheDocument()
    })

    it('shows a warning about expected slow first paint', () => {
        render(
            <DiffComputeOnDemand filename="src/huge.lock" additions={120_000} deletions={0}>
                <div data-testid="real-diff">REAL DIFF</div>
            </DiffComputeOnDemand>,
        )
        expect(screen.getByText(/may take a moment to render|slow/i)).toBeInTheDocument()
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/PRReview/DiffPanel/DiffComputeOnDemand.test.jsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the component**

Create `src/components/PRReview/DiffPanel/DiffComputeOnDemand.jsx`:

```jsx
import { useState } from 'react'
import { AlertTriangle, Cpu } from 'lucide-react'

/**
 * Placeholder for extreme-size files (>50,000 changed lines). Mounting
 * the lib's <DiffView> on something this large can stutter the tab even
 * with our other layered defences. Force an explicit user opt-in;
 * mirrors Monaco's `maxFileSize` pattern.
 *
 * @param {object} props
 * @param {string} props.filename
 * @param {number} props.additions
 * @param {number} props.deletions
 * @param {React.ReactNode} props.children  - The real diff to mount on demand.
 */
export function DiffComputeOnDemand({ filename, additions = 0, deletions = 0, children }) {
    const [computed, setComputed] = useState(false)
    const total = additions + deletions

    if (computed) return children

    return (
        <div className="diff-compute-on-demand p-6 text-center bg-amber-50/60 dark:bg-amber-900/10 border border-dashed border-amber-300 dark:border-amber-800/60 rounded-lg m-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-200 dark:bg-amber-800/50 mb-3">
                <Cpu className="w-5 h-5 text-amber-700 dark:text-amber-400" />
            </div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                <span className="font-mono">{filename}</span>
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                {total} lines changed — diff not auto-rendered
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-500 mt-2 max-w-md mx-auto inline-flex items-start gap-1.5 text-left">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>Files this large may take a moment to render and may briefly slow the tab. Click to compute when you're ready.</span>
            </p>
            <div className="mt-4">
                <button
                    type="button"
                    onClick={() => setComputed(true)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                >
                    <Cpu className="w-3.5 h-3.5" /> Compute diff
                </button>
            </div>
        </div>
    )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/PRReview/DiffPanel/DiffComputeOnDemand.test.jsx`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/PRReview/DiffPanel/DiffComputeOnDemand.jsx tests/components/PRReview/DiffPanel/DiffComputeOnDemand.test.jsx
git commit -m "feat(diff): DiffComputeOnDemand placeholder for extreme-size files

Files >50k changed lines render a placeholder card warning the user
that mounting the diff may briefly slow the tab. The real <DiffView>
mounts only after the user clicks Compute diff. Mirrors Monaco's
maxFileSize pattern."
```

---

## Task 4: Route in `DiffRenderer` + `useDeferredValue` for tab expansion

**Files:**
- Modify: `src/components/PRReview/DiffPanel/DiffRenderer.jsx`
- Test: `tests/components/PRReview/DiffPanel/DiffRenderer.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append to `tests/components/PRReview/DiffPanel/DiffRenderer.test.jsx`:

```jsx
describe('DiffRenderer — render strategy routing', () => {
    it('passes through to the lib for small files (<= 500 lines)', () => {
        const { container } = render(
            <DiffRenderer filename="x.js" patch={PATCH_WITH_TABS} viewMode="unified"
                additions={10} deletions={5} />,
        )
        expect(container.querySelector('[data-testid="diff-view"]')).not.toBeNull()
        expect(container.querySelector('.diff-collapser')).toBeNull()
        expect(container.querySelector('.diff-compute-on-demand')).toBeNull()
    })

    it('wraps in DiffCollapser for medium files (501–50k lines)', () => {
        const { container } = render(
            <DiffRenderer filename="x.js" patch={PATCH_WITH_TABS} viewMode="unified"
                additions={1200} deletions={300} />,
        )
        expect(container.querySelector('.diff-collapser')).not.toBeNull()
        // Folded by default — the actual <DiffView> is not in the tree yet.
        expect(container.querySelector('[data-testid="diff-view"]')).toBeNull()
    })

    it('wraps in DiffComputeOnDemand for extreme files (> 50k lines)', () => {
        const { container } = render(
            <DiffRenderer filename="x.lock" patch={PATCH_WITH_TABS} viewMode="unified"
                additions={120_000} deletions={0} />,
        )
        expect(container.querySelector('.diff-compute-on-demand')).not.toBeNull()
        expect(container.querySelector('[data-testid="diff-view"]')).toBeNull()
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/PRReview/DiffPanel/DiffRenderer.test.jsx -t "render strategy routing"`
Expected: FAIL — `additions`/`deletions` aren't currently routed; small-file test passes (no wrapper rendered) but the medium and large file tests fail because the lib renders directly.

- [ ] **Step 3: Update DiffRenderer to route**

Edit `src/components/PRReview/DiffPanel/DiffRenderer.jsx`:

1. Add imports at the top (after the `useTheme` import):

```jsx
import { useDeferredValue, useMemo } from 'react'   // useDeferredValue is new
import { pickRenderStrategy } from './diffSize'
import { DiffCollapser } from './DiffCollapser'
import { DiffComputeOnDemand } from './DiffComputeOnDemand'
```

(Keep the existing `useMemo` import if it's already there; consolidate.)

2. Update the function signature and body. Replace the existing `export function DiffRenderer({ filename, patch, viewMode, onAddComment, highlightLanguage, tabWidth = 4, wrap = false }) { ... }` with:

```jsx
export function DiffRenderer({
    filename,
    patch,
    viewMode,
    onAddComment,
    highlightLanguage,
    tabWidth = 4,
    wrap = false,
    additions = 0,
    deletions = 0,
    storageKey,
}) {
    const { isDark } = useTheme()

    // Defer tab-width re-application — on a 5k-line patch the tab→spaces
    // pass blocks paint for hundreds of ms. useDeferredValue lets React
    // keep the previous patch on screen while the next renders, freeing
    // the main thread for input.
    const deferredTabWidth = useDeferredValue(tabWidth)
    const expanded = useMemo(() => expandTabs(patch, deferredTabWidth), [patch, deferredTabWidth])

    const lang = useMemo(() => {
        if (highlightLanguage) return highlightLanguage
        if (!filename) return 'plaintext'
        const ext = filename.split('.').pop()?.toLowerCase() ?? ''
        return LANG_MAP[ext] ?? 'plaintext'
    }, [filename, highlightLanguage])

    const diffData = useMemo(() => {
        if (!expanded) return null
        const hunks = parsePatchToHunks(expanded, filename)
        if (hunks.length === 0) return null
        return {
            oldFile: { fileName: filename ?? null, fileLang: lang },
            newFile: { fileName: filename ?? null, fileLang: lang },
            hunks,
        }
    }, [expanded, filename, lang])

    const diffMode = viewMode === 'unified' ? DiffModeEnum.Unified : DiffModeEnum.Split

    if (!diffData) {
        return (
            <div className={`diff-renderer${wrap ? ' diff-wrap-on' : ''}`}>
                <div className="flex items-center justify-center h-24 text-sm text-gray-400 dark:text-gray-500 italic select-none">
                    No diff available for this file.
                </div>
            </div>
        )
    }

    // The lib's actual diff. Wrapped or unwrapped depending on file size.
    const diffElement = (
        <div className={`diff-renderer overflow-auto text-sm font-mono${wrap ? ' diff-wrap-on' : ''}`}>
            <DiffView
                data={diffData}
                diffViewMode={diffMode}
                diffViewTheme={isDark ? 'dark' : 'light'}
                diffViewHighlight
                diffViewAddWidget={Boolean(onAddComment)}
                onAddWidgetClick={
                    onAddComment
                        ? (lineNumber, side) => onAddComment({ lineNumber, side })
                        : undefined
                }
            />
        </div>
    )

    const strategy = pickRenderStrategy({ additions, deletions })
    if (strategy === 'compute') {
        return (
            <DiffComputeOnDemand filename={filename} additions={additions} deletions={deletions}>
                {diffElement}
            </DiffComputeOnDemand>
        )
    }
    if (strategy === 'collapse') {
        return (
            <DiffCollapser filename={filename} additions={additions} deletions={deletions} storageKey={storageKey}>
                {({ collapsed }) => collapsed ? null : diffElement}
            </DiffCollapser>
        )
    }
    return diffElement
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/PRReview/DiffPanel/DiffRenderer.test.jsx`
Expected: PASS — all routing tests green; existing tabWidth/wrap tests still green; console-hygiene test still green.

- [ ] **Step 5: Update CodeReviewSurface and DiffPanel to pass through additions/deletions/storageKey**

Edit `src/components/diff/CodeReviewSurface.jsx`. Find the `<DiffRenderer ... />` mount (around line 148) and add the new props:

```jsx
<DiffRenderer
    filename={activeFile.filename}
    patch={activeFile.patch}
    viewMode={prefs.mode}
    tabWidth={prefs.tabWidth}
    wrap={prefs.wrap}
    additions={activeFile.additions || 0}
    deletions={activeFile.deletions || 0}
    storageKey={storageKey}
/>
```

Edit `src/components/PRReview/DiffPanel/DiffPanel.jsx`. Find the `<DiffRenderer ... />` mount (inside the `<Suspense>` block around line 218) and add the new props:

```jsx
<DiffRenderer
    filename={filename}
    patch={patch}
    viewMode={viewMode}
    onAddComment={handleAddComment}
    highlightLanguage={lang}
    additions={additions}
    deletions={deletions}
    // No storageKey here — DiffPanel is used inside PRReviewView whose
    // own state machine drives reviewed/expanded tracking. Falling back
    // to undefined makes DiffCollapser a session-only fold (acceptable
    // for the focused review surface).
/>
```

(The `additions`/`deletions` are already destructured from `file` at line 194.)

- [ ] **Step 6: Run the broader unit test surface to confirm no regressions**

Run: `npx vitest run tests/components/PRReview tests/components/RepoDetail tests/components/diff 2>&1 | tail -10`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/components/PRReview/DiffPanel/DiffRenderer.jsx tests/components/PRReview/DiffPanel/DiffRenderer.test.jsx src/components/diff/CodeReviewSurface.jsx src/components/PRReview/DiffPanel/DiffPanel.jsx
git commit -m "feat(diff): DiffRenderer routes by file size + defers tab-width

Single-file diffs are now rendered through one of three strategies based
on additions+deletions: pass-through (<=500), DiffCollapser (501-50k),
DiffComputeOnDemand (>50k). Tab expansion runs through useDeferredValue
so a wide tab change on a huge patch doesn't block paint. CodeReviewSurface
and DiffPanel pass additions/deletions/storageKey through.

Spec: docs/specs/2026-05-09-pr-review-perf-and-polish-design.md (Slice 2.1)"
```

---

## Task 5: Toolbar Expand all / Collapse all

**Files:**
- Modify: `src/components/diff/CodeReviewToolbar.jsx`
- Test: `tests/components/diff/CodeReviewToolbar.test.jsx`

- [ ] **Step 1: Read the existing toolbar test to find conventions**

Run: open `tests/components/diff/CodeReviewToolbar.test.jsx` (or wherever the existing toolbar tests live — `find tests -name "CodeReviewToolbar*"`). Mirror its `render` + `userEvent` pattern.

- [ ] **Step 2: Write the failing test**

Append to the toolbar test file:

```jsx
import { vi } from 'vitest'

describe('CodeReviewToolbar — expand/collapse all', () => {
    it('dispatches diff-collapser:expand-all when "Expand all" is clicked', () => {
        const spy = vi.fn()
        window.addEventListener('diff-collapser:expand-all', spy)
        try {
            render(<CodeReviewToolbar {...minimalProps} />)
            fireEvent.click(screen.getByRole('button', { name: /expand all/i }))
            expect(spy).toHaveBeenCalledTimes(1)
        } finally {
            window.removeEventListener('diff-collapser:expand-all', spy)
        }
    })

    it('dispatches diff-collapser:collapse-all when "Collapse all" is clicked', () => {
        const spy = vi.fn()
        window.addEventListener('diff-collapser:collapse-all', spy)
        try {
            render(<CodeReviewToolbar {...minimalProps} />)
            fireEvent.click(screen.getByRole('button', { name: /collapse all/i }))
            expect(spy).toHaveBeenCalledTimes(1)
        } finally {
            window.removeEventListener('diff-collapser:collapse-all', spy)
        }
    })
})
```

(Define `minimalProps` matching whatever the existing toolbar tests already pass — mode, wrap, tabWidth, etc.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/components/diff/CodeReviewToolbar.test.jsx -t "expand/collapse all"`
Expected: FAIL — buttons don't exist.

- [ ] **Step 4: Add the buttons**

Open `src/components/diff/CodeReviewToolbar.jsx`. Find the existing right-hand button group (mode toggle, wrap toggle, tab width selector). Add these two buttons next to them:

```jsx
import { ChevronsDown, ChevronsUp } from 'lucide-react'

// ...inside the toolbar JSX, in the same row as the existing toggles:
<button
    type="button"
    onClick={() => window.dispatchEvent(new CustomEvent('diff-collapser:expand-all'))}
    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
    title="Expand all collapsed diffs"
    aria-label="Expand all"
>
    <ChevronsDown className="w-3.5 h-3.5" /> Expand all
</button>
<button
    type="button"
    onClick={() => window.dispatchEvent(new CustomEvent('diff-collapser:collapse-all'))}
    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
    title="Collapse all large diffs"
    aria-label="Collapse all"
>
    <ChevronsUp className="w-3.5 h-3.5" /> Collapse all
</button>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/components/diff/CodeReviewToolbar.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/diff/CodeReviewToolbar.jsx tests/components/diff/CodeReviewToolbar.test.jsx
git commit -m "feat(diff): toolbar Expand all / Collapse all buttons

Dispatches global window events that DiffCollapser instances listen
for. Lets a reviewer flip a long-folded PR open in one click without
clicking through every file."
```

---

## Task 6: Floating composer in DiffPanel

**Files:**
- Modify: `src/components/PRReview/DiffPanel/DiffPanel.jsx`
- Test: `tests/components/PRReview/DiffPanel/DiffPanel.test.jsx`

The composer at `DiffPanel.jsx:275-311` currently renders inside the diff scroll container. On a 4k-line file the user clicks "comment", composer appears at the bottom of the scroll, and they lose their visual context. Lift it to a fixed floating card on desktop; bottom sheet on mobile via the existing `<Modal mobileVariant="sheet">`.

- [ ] **Step 1: Write the failing test**

(Open the existing `DiffPanel.test.jsx` — likely at `tests/components/PRReview/DiffPanel/DiffPanel.test.jsx` if it exists; create if not.) Add:

```jsx
it('renders the inline comment composer as a fixed-position floating card on desktop', () => {
    // ...standard render of DiffPanel with a file that has a `patch`
    // simulate clicking a line's "add comment" widget — fire the
    // handler directly via the prop or the rendered button.
    // After triggering commentingLine, assert:
    const composer = screen.getByRole('textbox', { name: /diff comment/i })
    const composerCard = composer.closest('[data-floating-composer]')
    expect(composerCard).not.toBeNull()
    expect(composerCard.className).toMatch(/fixed/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/PRReview/DiffPanel/DiffPanel.test.jsx`
Expected: FAIL — composer is in-flow, no `data-floating-composer` marker.

- [ ] **Step 3: Refactor the composer block**

Open `src/components/PRReview/DiffPanel/DiffPanel.jsx`. Replace the existing composer block (lines 275-311) with:

```jsx
{commentingLine && (
    <div
        data-floating-composer="true"
        className="fixed z-40 right-4 bottom-4 max-md:left-4 max-md:right-4 w-[420px] max-md:w-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl p-4"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
    >
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Comment on line{' '}
            <span className="font-mono font-semibold text-gray-700 dark:text-gray-200">
                {commentingLine.lineNumber}
            </span>{' '}
            ({commentingLine.side === 'old' || commentingLine.side === 'left' ? 'old' : 'new'} side)
        </p>
        <textarea
            ref={textareaRef}
            value={commentBody}
            onChange={e => setCommentBody(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            rows={4}
            placeholder="Leave a comment… (Ctrl+Enter to submit, Esc to cancel)"
            aria-label="Inline diff comment"
            className="w-full resize-y rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex gap-2 mt-2 justify-end">
            <button
                onClick={handleCancelComment}
                disabled={submitting}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
                Cancel
            </button>
            <button
                onClick={handleSubmitComment}
                disabled={submitting || !commentBody.trim()}
                className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                {submitting ? 'Adding…' : 'Add comment'}
            </button>
        </div>
    </div>
)}
```

The key changes vs the original:
- `position: fixed` (via `fixed` Tailwind class) — anchored to the viewport, not the scroll container.
- `z-40` so it floats above the diff but below modals (z-50/60).
- Right-bottom on desktop; full-width bottom on mobile via `max-md:left-4 max-md:right-4`.
- `safe-area-inset-bottom` padding for iOS notched devices.
- `data-floating-composer` marker for the test.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/PRReview/DiffPanel/DiffPanel.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/PRReview/DiffPanel/DiffPanel.jsx tests/components/PRReview/DiffPanel/DiffPanel.test.jsx
git commit -m "feat(diff): float the inline comment composer

Composer now renders as a fixed-position floating card on desktop and a
bottom-anchored panel on mobile (with safe-area-inset padding for
notched iOS). Diff stays scrollable behind the composer so the user
keeps their context while composing — fixes the GitHub-2025
anti-pattern flagged in the spec.

Spec: docs/specs/2026-05-09-pr-review-perf-and-polish-design.md (Slice 2.4)"
```

---

## Task 7: CSS containment on the diff renderer wrapper

**Files:**
- Modify: `src/design-system.css`

This task is small and CSS-only. No automated test (CSS isn't easily unit-testable); covered by manual smoke in Task 9.

- [ ] **Step 1: Read the bottom of `src/design-system.css` to find a sensible insertion point**

Run: open `src/design-system.css` and skim the end. We append a guarded rule.

- [ ] **Step 2: Append the rule**

Add at the end of `src/design-system.css`:

```css
/* Diff renderer paint optimisation — see
 * docs/specs/2026-05-09-pr-review-perf-and-polish-design.md (Slice 2.1).
 *
 * `content-visibility: auto` lets the browser skip rendering for the
 * diff wrapper when it sits outside the viewport (e.g. multiple files
 * stacked in a long page). `contain-intrinsic-size` reserves a
 * believable initial height so the scroll bar doesn't jump as users
 * scroll past unrendered diffs.
 *
 * Per-row containment was investigated but skipped: applying
 * `content-visibility` to <tr> elements has known table-layout edge
 * cases. The wrapper-level rule is the safe pragmatic win.
 */
@supports (content-visibility: auto) {
    .diff-renderer {
        content-visibility: auto;
        contain-intrinsic-size: auto 600px;
    }
}
```

- [ ] **Step 3: Sanity-build to confirm the CSS parses**

Run: `npm run build 2>&1 | tail -10`
Expected: build success, no CSS parse errors.

- [ ] **Step 4: Commit**

```bash
git add src/design-system.css
git commit -m "perf(diff): content-visibility on .diff-renderer wrapper

Lets browsers skip layout/paint for off-screen diffs. Gated on
@supports so older Safari just gets no benefit, no regression.
Per-row containment skipped because <tr> + content-visibility has
known table-layout edge cases; the wrapper-level rule is the safe
win — ~10-15% paint savings per Nolan Lawson's measurements."
```

---

## Task 8: e2e regression — large-diff fold + expand

**Files:**
- Create: `e2e/pr-review-large-diff.spec.js`

- [ ] **Step 1: Find an existing e2e to mirror conventions**

Run: open `e2e/commit-diff-viewer.spec.js` and skim. Mirror its setup (auth fixture, navigation pattern, page-object usage).

- [ ] **Step 2: Write the e2e**

Create `e2e/pr-review-large-diff.spec.js`:

```js
import { test, expect } from '@playwright/test'

// Uses the existing MOCK_MODE fixture. The mock layer (set via VITE_MOCK_MODE)
// returns a deterministic PR with one large file (>500 lines) and one small
// file. The fold-by-default rule must show the large file as a placeholder
// and expand it on click.
test.describe('PR review — large diff fold/expand', () => {
    test('a large file is folded by default and expands on click', async ({ page }) => {
        // Replace with the actual mock-mode entry point for a PR with a large file.
        await page.goto('/?mock=large-pr')
        await page.click('text=Pull requests')
        await page.click('text=Large refactor PR')   // mock fixture title
        await page.click('text=Files')

        // Large file's row in the file tree
        await page.click('text=src/big-refactor.js')

        // Folded affordance is visible
        const placeholder = page.locator('.diff-collapser')
        await expect(placeholder).toBeVisible()
        await expect(placeholder).toContainText(/lines changed/i)

        // Real diff is NOT yet in the DOM
        await expect(page.locator('[data-testid="diff-view"]')).toHaveCount(0)

        // Expand it
        await page.click('button:has-text("Show diff")')
        await expect(page.locator('[data-testid="diff-view"]')).toBeVisible()

        // Collapse all from the toolbar
        await page.click('button[aria-label="Collapse all"]')
        await expect(placeholder).toBeVisible()
        await expect(page.locator('[data-testid="diff-view"]')).toHaveCount(0)
    })
})
```

(Adapt `page.goto`, fixture names, and selectors to whatever `commit-diff-viewer.spec.js` uses for mock mode. If a "large PR" fixture doesn't exist, add one to `src/__mocks__/mockRepoDetail.js` first — small JSON with one big patch field.)

- [ ] **Step 3: Run the e2e**

Run: `npx playwright test e2e/pr-review-large-diff.spec.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/pr-review-large-diff.spec.js src/__mocks__/  # if mock fixtures changed
git commit -m "test(e2e): large-diff fold/expand and toolbar collapse-all"
```

---

## Task 9: Manual smoke + perf measurement

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Open a real PR with a large file**

Navigate to a repo with a known large refactor PR. Ideal target: a PR whose largest file is in the 1k–5k changed-lines range.

- [ ] **Step 3: Verify fold-by-default**

Click the file in the tree. The `<DiffCollapser>` placeholder should render. Click "Show diff". The lib should mount.

- [ ] **Step 4: Verify content-visibility (Chrome only)**

Open DevTools → Performance → Record. Scroll past the long diff to a panel below it (e.g. the AI summary). Stop recording. The Layout/Paint cost for off-screen sections of `.diff-renderer` should drop visibly compared to a baseline (record before applying CSS, or compare to a different wrapper without `content-visibility`).

- [ ] **Step 5: Verify the floating composer**

Click any line's "add comment" widget. The composer should appear at the bottom-right of the viewport (NOT at the bottom of the diff scroll). Scroll the diff — composer must stay anchored.

- [ ] **Step 6: Verify Expand all / Collapse all in the toolbar**

Click "Collapse all" — every `<DiffCollapser>` should fold. Click "Expand all" — they all unfurl.

- [ ] **Step 7: Sanity check — no regressions in console**

Console should still be clean (Slice 1 cleanups still in effect).

- [ ] **Step 8: Stop the dev server**

Ctrl-C the `npm run dev` process.

---

## Out of scope for this slice

Explicitly NOT done here (covered by slice 3 of the parent spec):
- Mobile bottom-sheet file tree.
- Drawer AI panel on tablet/mobile.
- Sticky review action bar with progress ring.
- Animated "Viewed" interactions (Framer Motion `layout`).
- Keyboard help overlay + cmdk PR-scoped commands.

Explicitly **NOT done at all** in this initiative (deferred to future specs):
- Per-hunk virtualisation wrapping `@git-diff-view/react` — see validation report.
- Web-worker syntax highlighting — separate effort.
- Swap to `react-diff-view`.

---

## Self-review checklist (run during planning)

- ✅ Spec coverage: every concrete change in spec §Slice 2 (revised) has a task: 2.1 layered strategy → Tasks 1-4, 7; toolbar bulk control → Task 5; floating composer → Task 6; verification → Tasks 8, 9.
- ✅ No placeholders or TBDs.
- ✅ Type / property consistency: `pickRenderStrategy`'s return values (`'pass' | 'collapse' | 'compute'`) match the conditionals in `DiffRenderer`. `EXPANDED_STORAGE_KEY` exported from `DiffCollapser` and used in tests with the same prefix the component reads.
- ✅ Each task includes failing test → implementation → passing test → commit, except Task 7 (pure CSS, no testable JS surface).
- ✅ All new components have unit tests; the routing is integration-tested in DiffRenderer.test.jsx; the user flow has an e2e.
- ✅ No new top-level dependencies. Reuses `@git-diff-view/react`, `framer-motion`, `lucide-react`, all already in `package.json`.
