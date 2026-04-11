# Product Honesty Pass — Wave 2: AI Completeness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire every orphan AI endpoint to a discoverable UI entry point, implement the two remaining context menu vaporware items (Compare with Existing, Security & Secrets Scan), apply consistent rate limiting + audit logging across all `/ai/*` endpoints, and harden the `/ai/readme` endpoint.

**Architecture:** Reuse existing infrastructure — `@git-diff-view/react` for the README Enhance diff, the existing vector embeddings behind `/api/ai/search` for Compare, three GitHub native security alert APIs aggregated via `Promise.allSettled` and the shared `githubApi()` helper for Security. A new `<SidePanel />` primitive is introduced for desktop drawer variants.

**Tech Stack:** React 19, Vite 7, Express 5, `@git-diff-view/react` + `@git-diff-view/shiki` (already installed), shared `githubApi()` helper, Gemini via `aiService`, Vitest, Playwright.

**Source spec:** [docs/specs/2026-04-11-product-honesty-pass.md](../specs/2026-04-11-product-honesty-pass.md)

**Depends on:** Wave 1 is not a strict dependency but is recommended to ship first to avoid merge conflicts in `RepoContextMenu.jsx` and `RepoList.jsx`.

---

## File Structure

### New files
- `src/components/ui/SidePanel.jsx` — desktop right-edge drawer primitive
- `src/components/AI/ReadmeEnhanceDiffPanel.jsx` — side-by-side diff sub-panel
- `src/components/AI/CompareSimilarDrawer.jsx` — top-K similar repos drawer
- `src/components/AI/BatchIndexProgressModal.jsx` — progress feedback for batch indexing
- `src/components/security/SecurityScanModal.jsx` — aggregated security alerts view
- `server/routes/v1/repos-security.js` — security scan endpoint
- `server/__tests__/repos-security.test.js` — unit tests
- `server/__tests__/ai-search-similar-mode.test.js` — unit tests for similar-by-id mode

### Modified files
- `server/routes/ai.js` — add `mode=similar-by-id` branch, wire `checkUsageLimit` + `incrementUsage` on all endpoints, add `sanitizeForPrompt` + model fallback + structured response to `/ai/readme`, add `auditLog` calls
- `server/routes/v1/index.js` — mount new security router
- `src/components/RepoContextMenu.jsx` — remove `disabled: true` from Compare and Security items; add "Generate Commit Message" entry
- `src/components/RepoList.jsx` — handlers for `aiCompare`, `aiSecurity`, `aiCommit`, `aiBatchIndex_selected`
- `src/components/CommitGeneratorModal.jsx` — accept `repo` + `branch` props from modal data
- `src/components/AI/RepoInsightsModal.jsx` — "Enhance README" button on README tab
- `src/components/RepoDetail/BranchesTab.jsx` — per-branch "✨ AI Commit" button
- `src/contexts/ModalContext.jsx` — register `showBatchIndex`, `showSecurityScan` keys if not using existing patterns
- `src/api/ai.js` — ensure `enhanceReadme`, `batchIndex`, `findSimilar` methods are exported

### New test files
- `e2e/ai-completeness-wave-2.spec.js`

---

## Task 1: Introduce `<SidePanel />` primitive

**Files:**
- Create: `src/components/ui/SidePanel.jsx`
- Test: `src/components/ui/__tests__/SidePanel.test.jsx`

- [ ] **Step 1: Write the failing unit test**

Create `tests/components/ui/SidePanel.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SidePanel } from '../../../src/components/ui/SidePanel'

describe('SidePanel', () => {
  it('renders title and children when open', () => {
    render(
      <SidePanel isOpen={true} onClose={() => {}} title="Similar Repos">
        <p>content</p>
      </SidePanel>
    )
    expect(screen.getByText('Similar Repos')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    render(
      <SidePanel isOpen={false} onClose={() => {}} title="Hidden">
        <p>content</p>
      </SidePanel>
    )
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })

  it('calls onClose when backdrop clicked', () => {
    const onClose = vi.fn()
    render(
      <SidePanel isOpen={true} onClose={onClose} title="X">
        <p>content</p>
      </SidePanel>
    )
    fireEvent.click(screen.getByTestId('sidepanel-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx vitest run tests/components/ui/SidePanel.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the primitive**

Create `src/components/ui/SidePanel.jsx`:

```jsx
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'

export function SidePanel({ isOpen, onClose, title, subtitle, children, width = 480, side = 'right' }) {
  useFocusTrap(isOpen, onClose)
  useBodyScrollLock(isOpen)

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            data-testid="sidepanel-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            aria-hidden="true"
          />
          <motion.aside
            initial={{ x: side === 'right' ? '100%' : '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: side === 'right' ? '100%' : '-100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className={`fixed ${side === 'right' ? 'right-0' : 'left-0'} top-0 bottom-0 bg-white dark:bg-slate-950 z-50 shadow-2xl flex flex-col ds-hover-lift`}
            style={{ width: `min(${width}px, 100vw)` }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <header className="flex items-start justify-between p-6 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-semibold ds-gradient-text">{title}</h2>
                {subtitle && <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                aria-label="Close panel"
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition ds-focus-ring"
              >
                <X className="w-5 h-5" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {children}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
```

Verify the imports `useFocusTrap` and `useBodyScrollLock` paths match the actual hook locations in the project. Adjust if they live under `src/hooks/` with different filenames.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run tests/components/ui/SidePanel.test.jsx`
Expected: PASS all three cases.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/SidePanel.jsx tests/components/ui/SidePanel.test.jsx
git commit -m "feat(ui): add SidePanel primitive for desktop-side drawers"
```

---

## Task 2: Wire CommitGeneratorModal to contextual entry points

**Files:**
- Modify: `src/components/CommitGeneratorModal.jsx` — accept `repo` + `branch` props
- Modify: `src/components/RepoContextMenu.jsx` — add "Generate Commit Message" to AI submenu
- Modify: `src/components/RepoList.jsx` — handler for `aiCommit`
- Modify: `src/components/RepoDetail/BranchesTab.jsx` — per-branch AI commit button
- Modify: `src/App.jsx` — forward `repo` and `branch` props from modal data
- Test: `e2e/ai-completeness-wave-2.spec.js`

- [ ] **Step 1: Create e2e test file with failing test**

Create `e2e/ai-completeness-wave-2.spec.js`:

```js
import { test, expect } from '@playwright/test'

test.describe('Wave 2 — AI Completeness', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=1')
    await page.waitForSelector('[data-testid="repo-card"]')
  })

  test('Generate Commit Message opens CommitGen modal with repo context', async ({ page }) => {
    const card = page.locator('[data-testid="repo-card"]').first()
    await card.click({ button: 'right' })
    await page.locator('text=AI').hover()
    await page.locator('text=Generate Commit Message').click()
    await expect(page.locator('[data-testid="commit-gen-modal"]')).toBeVisible()
    await expect(page.locator('[data-testid="commit-gen-subtitle"]')).toContainText('For ')
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx playwright test e2e/ai-completeness-wave-2.spec.js -g "Commit Message"`
Expected: FAIL — menu item does not exist yet.

- [ ] **Step 3: Extend CommitGeneratorModal to accept context**

In `src/components/CommitGeneratorModal.jsx`, update the signature:

```jsx
export function CommitGeneratorModal({ isOpen, onClose, askAI, repo = null, branch = null }) {
  // ... existing state ...
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="AI Commit Generator"
      subtitle={repo ? `For ${repo.full_name}${branch ? ` → ${branch}` : ''}` : undefined}
      data-testid="commit-gen-modal"
    >
      {/* subtitle span with testid */}
      {repo && <span data-testid="commit-gen-subtitle" className="sr-only">For {repo.full_name}</span>}
      {/* existing body */}
    </Modal>
  )
}
```

Ensure the component uses the shared `Modal` primitive. If it currently hand-rolls its own wrapper, replace with `<Modal>` — this is in scope for Wave 2 since it unifies modal behaviour.

- [ ] **Step 4: Add menu item to AI submenu**

In `src/components/RepoContextMenu.jsx`, around the existing AI submenu block (lines ~61-85), add a new entry at the top of the AI submenu array:

```jsx
{ label: 'Generate Commit Message', icon: Wand2, onClick: () => onAction('aiCommit', repo) },
```

Import `Wand2` from `lucide-react` at the top.

- [ ] **Step 5: Wire the `aiCommit` handler in RepoList**

In `src/components/RepoList.jsx`:

```jsx
case 'aiCommit':
  openModalWithData('showCommitGen', { repo: data, branch: null })
  break
```

- [ ] **Step 6: Forward repo/branch props from App.jsx**

In `src/App.jsx` where `<CommitGeneratorModal>` is rendered (around line 869), extend:

```jsx
<CommitGeneratorModal
  isOpen={modalStates.showCommitGen}
  onClose={() => closeModal('showCommitGen')}
  askAI={askAI}
  repo={getModalData('showCommitGen')?.repo}
  branch={getModalData('showCommitGen')?.branch}
/>
```

- [ ] **Step 7: Add per-branch button in BranchesTab**

In `src/components/RepoDetail/BranchesTab.jsx`, inside the branch row rendering loop, add a button:

```jsx
<button
  onClick={() => openModalWithData('showCommitGen', { repo, branch: branch.name })}
  className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 ds-hover-scale"
  aria-label={`Generate AI commit message for ${branch.name}`}
  title="AI Commit Message"
>
  <Wand2 className="w-4 h-4" />
</button>
```

Import `Wand2` and ensure `openModalWithData` is available via hook context.

- [ ] **Step 8: Run the test, confirm it passes**

Run: `npx playwright test e2e/ai-completeness-wave-2.spec.js -g "Commit Message"`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/CommitGeneratorModal.jsx src/components/RepoContextMenu.jsx src/components/RepoList.jsx src/App.jsx src/components/RepoDetail/BranchesTab.jsx e2e/ai-completeness-wave-2.spec.js
git commit -m "feat(ai): add contextual Generate Commit Message entry points"
```

---

## Task 3: Wire README Enhance UI

**Files:**
- Create: `src/components/AI/ReadmeEnhanceDiffPanel.jsx`
- Modify: `src/components/AI/RepoInsightsModal.jsx` — add "Enhance README" button
- Modify: `src/api/ai.js` — verify `enhanceReadme()` method is exported
- Test: append to `e2e/ai-completeness-wave-2.spec.js`

- [ ] **Step 1: Append the failing test**

```js
test('Enhance README button shows diff panel', async ({ page }) => {
  const card = page.locator('[data-testid="repo-card"]').first()
  await card.click({ button: 'right' })
  await page.locator('text=AI').hover()
  await page.locator('text=Quality Report').click()
  await page.waitForSelector('[data-testid="repo-insights-modal"]')
  await page.locator('text=README').click()  // README tab
  await page.locator('text=Enhance with AI').click()
  await expect(page.locator('[data-testid="readme-enhance-diff"]')).toBeVisible()
})
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npx playwright test e2e/ai-completeness-wave-2.spec.js -g "Enhance README"`
Expected: FAIL — button does not exist.

- [ ] **Step 3: Create the diff panel component**

Create `src/components/AI/ReadmeEnhanceDiffPanel.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { DiffView, DiffModeEnum } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view.css'
import { aiApi } from '../../api/ai'
import { Loader2, Sparkles, Copy, Check } from 'lucide-react'

export function ReadmeEnhanceDiffPanel({ repo, currentReadme, onClose }) {
  const [loading, setLoading] = useState(true)
  const [enhanced, setEnhanced] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    aiApi.enhanceReadme(repo)
      .then(result => {
        if (!cancelled) {
          setEnhanced(result.enhancement || result.readme)
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message)
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [repo])

  const handleCopy = () => {
    navigator.clipboard.writeText(enhanced)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <p className="text-sm text-slate-600 dark:text-slate-400">Generating AI enhancement…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
        <p className="text-sm text-red-900 dark:text-red-300">Could not generate enhancement: {error}</p>
      </div>
    )
  }

  return (
    <div data-testid="readme-enhance-diff" className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-500" />
          AI README Enhancement
        </h3>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-700 ds-btn-shimmer"
        >
          {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy enhanced</>}
        </button>
      </div>
      <DiffView
        data={{
          oldFile: { fileName: 'README.md', content: currentReadme || '' },
          newFile: { fileName: 'README.md (enhanced)', content: enhanced || '' },
          hunks: []  // library computes
        }}
        diffViewMode={DiffModeEnum.Split}
        diffViewHighlight
      />
    </div>
  )
}
```

- [ ] **Step 4: Add the Enhance button to RepoInsightsModal README tab**

In `src/components/AI/RepoInsightsModal.jsx`, locate the README tab content. Add at the top of the tab body:

```jsx
const [showEnhance, setShowEnhance] = useState(false)

// inside README tab:
{!showEnhance ? (
  <button
    onClick={() => setShowEnhance(true)}
    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 ds-btn-shimmer"
  >
    <Sparkles className="w-4 h-4" />
    Enhance with AI
  </button>
) : (
  <ReadmeEnhanceDiffPanel
    repo={repo}
    currentReadme={currentReadme}
    onClose={() => setShowEnhance(false)}
  />
)}
```

Import `ReadmeEnhanceDiffPanel` and `Sparkles`.

- [ ] **Step 5: Run the test, confirm it passes**

Run: `npx playwright test e2e/ai-completeness-wave-2.spec.js -g "Enhance README"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/AI/ReadmeEnhanceDiffPanel.jsx src/components/AI/RepoInsightsModal.jsx e2e/ai-completeness-wave-2.spec.js
git commit -m "feat(ai): wire README Enhance button with diff panel"
```

---

## Task 4: Wire Batch Index UI

**Files:**
- Create: `src/components/AI/BatchIndexProgressModal.jsx`
- Modify: `src/components/RepoContextMenu.jsx` — add "Batch Index with AI" to batch actions
- Modify: `src/components/RepoList.jsx` — handler for `aiBatchIndex_selected`
- Modify: `src/contexts/ModalContext.jsx` — register `showBatchIndex` key
- Modify: `src/App.jsx` — render modal

- [ ] **Step 1: Create the progress modal component**

Create `src/components/AI/BatchIndexProgressModal.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { aiApi } from '../../api/ai'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'

export function BatchIndexProgressModal({ isOpen, onClose, repos = [] }) {
  const [processed, setProcessed] = useState(0)
  const [results, setResults] = useState([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isOpen || !repos.length) return
    let cancelled = false
    setProcessed(0)
    setResults([])
    setError(null)
    setRunning(true)
    ;(async () => {
      try {
        const chunkSize = 10
        const acc = []
        for (let i = 0; i < repos.length; i += chunkSize) {
          if (cancelled) return
          const chunk = repos.slice(i, i + chunkSize)
          const res = await aiApi.batchIndex(chunk)
          acc.push(...(res.results || []))
          setResults([...acc])
          setProcessed(Math.min(i + chunkSize, repos.length))
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setRunning(false)
      }
    })()
    return () => { cancelled = true }
  }, [isOpen, repos])

  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Batch Index Progress" data-testid="batch-index-modal">
      <div className="space-y-4">
        <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2">
          <div
            className="bg-indigo-500 h-2 rounded-full transition-all"
            style={{ width: `${repos.length ? (processed / repos.length) * 100 : 0}%` }}
          />
        </div>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Processed {processed} of {repos.length} repositories
        </p>
        {running && <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />}
        <div className="flex gap-4 text-sm">
          <span className="inline-flex items-center gap-1.5 text-emerald-600">
            <CheckCircle2 className="w-4 h-4" /> {successCount} indexed
          </span>
          {failCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-red-600">
              <XCircle className="w-4 h-4" /> {failCount} failed
            </span>
          )}
        </div>
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 text-red-900 dark:text-red-300 text-sm">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Register the modal in ModalContext**

In `src/contexts/ModalContext.jsx`, add `'showBatchIndex'` to the MODAL_KEYS array (following the existing pattern).

- [ ] **Step 3: Render the modal in App.jsx**

In `src/App.jsx`:

```jsx
<Suspense fallback={null}>
  <BatchIndexProgressModal
    isOpen={modalStates.showBatchIndex}
    onClose={() => closeModal('showBatchIndex')}
    repos={getModalData('showBatchIndex')?.repos || []}
  />
</Suspense>
```

Import at the top with lazy: `const BatchIndexProgressModal = lazy(() => import('./components/AI/BatchIndexProgressModal').then(m => ({ default: m.BatchIndexProgressModal })))`.

- [ ] **Step 4: Add the batch menu item**

In `src/components/RepoContextMenu.jsx`, find the batch actions section (around line 117+ where `_selected` actions are defined). Add:

```jsx
{ label: 'Batch Index with AI', icon: Sparkles, onClick: () => onAction('aiBatchIndex_selected', selectedRepos) },
```

- [ ] **Step 5: Wire the handler in RepoList**

```jsx
case 'aiBatchIndex_selected':
  openModalWithData('showBatchIndex', { repos: data })
  break
```

- [ ] **Step 6: Append e2e test**

```js
test('Batch Index opens progress modal for selected repos', async ({ page }) => {
  // Select two repos
  await page.locator('[data-testid="repo-card"]').nth(0).locator('[data-testid="select-checkbox"]').click()
  await page.locator('[data-testid="repo-card"]').nth(1).locator('[data-testid="select-checkbox"]').click()
  // Open bulk actions
  await page.locator('[data-testid="bulk-actions-button"]').click()
  await page.locator('text=Batch Index with AI').click()
  await expect(page.locator('[data-testid="batch-index-modal"]')).toBeVisible()
})
```

- [ ] **Step 7: Run the test, confirm it passes**

Run: `npx playwright test e2e/ai-completeness-wave-2.spec.js -g "Batch Index"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/AI/BatchIndexProgressModal.jsx src/contexts/ModalContext.jsx src/App.jsx src/components/RepoContextMenu.jsx src/components/RepoList.jsx e2e/ai-completeness-wave-2.spec.js
git commit -m "feat(ai): wire Batch Index bulk action with progress modal"
```

---

## Task 5: Compare with Existing — backend `mode=similar-by-id`

**Files:**
- Modify: `server/routes/ai.js` — add new branch to `/ai/search` handler
- Create: `server/__tests__/ai-search-similar-mode.test.js`

- [ ] **Step 1: Write the failing unit test**

Create `server/__tests__/ai-search-similar-mode.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockDbAll = vi.fn()
vi.mock('../db.js', () => ({
  default: { prepare: vi.fn(() => ({ all: mockDbAll, get: vi.fn() })) }
}))
vi.mock('../ai-service.js', () => ({
  aiService: { findSimilarById: vi.fn() }
}))
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../middleware/require-tier.js', () => ({
  requireTier: () => (req, _res, next) => next()
}))
vi.mock('../middleware/require-ai.js', () => ({
  requireAI: (req, _res, next) => next()
}))

import { aiService } from '../ai-service.js'

describe('GET /api/ai/search?mode=similar-by-id', () => {
  let app
  beforeEach(async () => {
    vi.clearAllMocks()
    app = express()
    app.use((req, _res, next) => {
      req.session = { accessToken: 'tok', user: { id: 1, login: 'alice' } }
      req.log = { error: vi.fn() }
      next()
    })
    const aiRouter = (await import('../routes/ai.js')).default
    app.use('/api', aiRouter)
  })

  it('returns top 5 similar repos with scores', async () => {
    aiService.findSimilarById.mockResolvedValue([
      { repoId: 'alice/other', score: 0.91, languages: { JavaScript: 900 } },
      { repoId: 'alice/third', score: 0.77, languages: { TypeScript: 500 } }
    ])
    const res = await request(app).get('/api/ai/search?mode=similar-by-id&repoId=alice/hello')
    expect(res.status).toBe(200)
    expect(res.body.similar).toHaveLength(2)
    expect(res.body.similar[0].score).toBe(0.91)
  })

  it('returns 404 when repo is not indexed', async () => {
    aiService.findSimilarById.mockResolvedValue(null)
    const res = await request(app).get('/api/ai/search?mode=similar-by-id&repoId=alice/hello')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not indexed/i)
  })
})
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npx vitest run server/__tests__/ai-search-similar-mode.test.js`
Expected: FAIL — `aiService.findSimilarById is not a function`.

- [ ] **Step 3: Extend `/ai/search` handler**

In `server/routes/ai.js`, find the existing `GET /ai/search` handler and add a branch at the top of the handler body:

```js
if (req.query.mode === 'similar-by-id') {
  const repoId = req.query.repoId
  if (!repoId) return res.status(400).json({ error: 'repoId required' })
  try {
    const similar = await aiService.findSimilarById(repoId, { topK: 5, excludeSelf: true })
    if (!similar) return res.status(404).json({ error: 'Repository not indexed' })
    await auditLog(req, 'ai.compare', 'repo', repoId, { resultCount: similar.length })
    return res.json({ mode: 'similar-by-id', similar })
  } catch (err) {
    req.log.error({ err }, 'similar-by-id lookup failed')
    return res.status(500).json({ error: err.message })
  }
}
```

- [ ] **Step 4: Implement `findSimilarById` in `server/ai-service.js`**

In `server/ai-service.js`, add a method:

```js
async findSimilarById(repoId, { topK = 5, excludeSelf = true } = {}) {
  // Look up this repo's embedding
  const row = db.prepare('SELECT embedding, metadata FROM repo_embeddings WHERE repo_id = ?').get(repoId)
  if (!row) return null
  const targetVec = JSON.parse(row.embedding)
  // Fetch all other embeddings
  const others = db.prepare('SELECT repo_id, embedding, metadata FROM repo_embeddings WHERE repo_id != ?').all(repoId)
  const scored = others.map(o => {
    const vec = JSON.parse(o.embedding)
    const meta = JSON.parse(o.metadata || '{}')
    return {
      repoId: o.repo_id,
      score: cosineSimilarity(targetVec, vec),
      languages: meta.languages || {},
      description: meta.description || ''
    }
  })
  return scored.sort((a, b) => b.score - a.score).slice(0, topK)
}
```

Add a small helper at the top of the file if `cosineSimilarity` does not already exist:

```js
function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}
```

- [ ] **Step 5: Run the test, confirm it passes**

Run: `npx vitest run server/__tests__/ai-search-similar-mode.test.js`
Expected: PASS both cases.

- [ ] **Step 6: Commit**

```bash
git add server/routes/ai.js server/ai-service.js server/__tests__/ai-search-similar-mode.test.js
git commit -m "feat(ai): add mode=similar-by-id to /ai/search endpoint"
```

---

## Task 6: Compare with Existing — frontend drawer

**Files:**
- Create: `src/components/AI/CompareSimilarDrawer.jsx`
- Modify: `src/components/RepoContextMenu.jsx` — re-enable Compare menu item
- Modify: `src/components/RepoList.jsx` — handler for `aiCompare`
- Modify: `src/contexts/ModalContext.jsx` — register `showCompare`
- Modify: `src/App.jsx` — render drawer
- Modify: `src/api/ai.js` — add `findSimilar()` method

- [ ] **Step 1: Add `findSimilar` API method**

In `src/api/ai.js`, add:

```js
findSimilar: async (repoId) => {
  const res = await fetch(`/api/ai/search?mode=similar-by-id&repoId=${encodeURIComponent(repoId)}`, {
    credentials: 'include'
  })
  if (res.status === 404) return { notIndexed: true }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
```

- [ ] **Step 2: Create the drawer component**

Create `src/components/AI/CompareSimilarDrawer.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { SidePanel } from '../ui/SidePanel'
import { aiApi } from '../../api/ai'
import { Loader2, Sparkles } from 'lucide-react'
import { EmptyState } from '../ui/EmptyState'

export function CompareSimilarDrawer({ isOpen, onClose, repo }) {
  const [loading, setLoading] = useState(true)
  const [results, setResults] = useState([])
  const [notIndexed, setNotIndexed] = useState(false)
  const [indexing, setIndexing] = useState(false)

  const loadResults = async () => {
    setLoading(true)
    setNotIndexed(false)
    try {
      const data = await aiApi.findSimilar(repo.full_name)
      if (data.notIndexed) {
        setNotIndexed(true)
      } else {
        setResults(data.similar || [])
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen && repo) loadResults()
  }, [isOpen, repo?.full_name])

  const handleIndex = async () => {
    setIndexing(true)
    try {
      await aiApi.indexRepo(repo)
      await loadResults()
    } finally {
      setIndexing(false)
    }
  }

  return (
    <SidePanel isOpen={isOpen} onClose={onClose} title="Similar Repositories" subtitle={repo?.full_name}>
      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-sm text-slate-600 dark:text-slate-400">Finding similar repos…</p>
        </div>
      ) : notIndexed ? (
        <EmptyState
          icon={Sparkles}
          title="Not indexed yet"
          description="This repository has not been indexed for semantic search. Indexing takes a few seconds."
          action={{
            label: indexing ? 'Indexing…' : 'Index now',
            onClick: handleIndex,
            disabled: indexing
          }}
        />
      ) : results.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No similar repositories"
          description="No repos above 50% similarity found in your indexed set."
        />
      ) : (
        <div className="space-y-3" data-testid="compare-results">
          {results.map(r => (
            <div key={r.repoId} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 ds-card-shimmer ds-hover-lift">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold">{r.repoId}</p>
                  {r.description && <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{r.description}</p>}
                </div>
                <span className="text-xs font-mono px-2 py-1 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                  {Math.round(r.score * 100)}%
                </span>
              </div>
              <div className="mt-2 flex gap-2 flex-wrap">
                {Object.keys(r.languages || {}).slice(0, 3).map(lang => (
                  <span key={lang} className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{lang}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </SidePanel>
  )
}
```

- [ ] **Step 3: Re-enable Compare menu item**

In `src/components/RepoContextMenu.jsx` around line 74-79, replace the disabled entry with:

```jsx
{ label: 'Compare with Existing', icon: GitCompare, onClick: () => onAction('aiCompare', repo) },
```

Import `GitCompare` from `lucide-react`.

- [ ] **Step 4: Register modal key, wire handler, render in App.jsx**

In ModalContext: add `'showCompare'` to keys.

In RepoList.jsx:

```jsx
case 'aiCompare':
  openModalWithData('showCompare', { repo: data })
  break
```

In App.jsx:

```jsx
<Suspense fallback={null}>
  <CompareSimilarDrawer
    isOpen={modalStates.showCompare}
    onClose={() => closeModal('showCompare')}
    repo={getModalData('showCompare')?.repo}
  />
</Suspense>
```

With a lazy import.

- [ ] **Step 5: Append e2e test**

```js
test('Compare with Existing opens drawer', async ({ page }) => {
  const card = page.locator('[data-testid="repo-card"]').first()
  await card.click({ button: 'right' })
  await page.locator('text=AI').hover()
  await page.locator('text=Compare with Existing').click()
  // Either results or not-indexed CTA appears
  await expect(page.locator('[data-testid="compare-results"], text=Not indexed yet')).toBeVisible()
})
```

- [ ] **Step 6: Run the test, confirm it passes**

Run: `npx playwright test e2e/ai-completeness-wave-2.spec.js -g "Compare"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/api/ai.js src/components/AI/CompareSimilarDrawer.jsx src/components/RepoContextMenu.jsx src/components/RepoList.jsx src/contexts/ModalContext.jsx src/App.jsx e2e/ai-completeness-wave-2.spec.js
git commit -m "feat(ai): wire Compare with Existing drawer with semantic similarity"
```

---

## Task 7: Security & Secrets Scan — backend endpoint

**Files:**
- Create: `server/routes/v1/repos-security.js`
- Modify: `server/routes/v1/index.js` — mount router
- Create: `server/__tests__/repos-security.test.js`

- [ ] **Step 1: Write the failing unit test**

Create `server/__tests__/repos-security.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn() }))
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../middleware/require-tier.js', () => ({ requireTier: () => (req, _res, next) => next() }))

import { githubApi } from '../lib/github-api.js'

describe('GET /api/v1/repos/:owner/:repo/security', () => {
  let app
  beforeEach(async () => {
    vi.clearAllMocks()
    app = express()
    app.use((req, _res, next) => {
      req.session = { accessToken: 'tok', user: { login: 'alice' } }
      req.log = { error: vi.fn() }
      next()
    })
    const { default: router } = await import('../routes/v1/repos-security.js')
    app.use('/api/v1', router)
  })

  it('aggregates alerts from all three sources', async () => {
    githubApi.mockImplementation(async (path) => {
      if (path.includes('/secret-scanning/alerts')) return { data: [{ number: 1, state: 'open' }] }
      if (path.includes('/code-scanning/alerts')) return { data: [{ number: 10, rule: { severity: 'warning' } }] }
      if (path.includes('/dependabot/alerts')) return { data: [{ number: 20, security_advisory: { severity: 'high' } }] }
      return { data: [] }
    })
    const res = await request(app).get('/api/v1/repos/alice/hello/security')
    expect(res.status).toBe(200)
    expect(res.body.secretScanning.available).toBe(true)
    expect(res.body.secretScanning.alerts).toHaveLength(1)
    expect(res.body.summary.total).toBe(3)
  })

  it('marks a source as unavailable on 403', async () => {
    githubApi.mockImplementation(async (path) => {
      if (path.includes('/secret-scanning/alerts')) {
        const err = new Error('Forbidden'); err.status = 403; throw err
      }
      return { data: [] }
    })
    const res = await request(app).get('/api/v1/repos/alice/hello/security')
    expect(res.status).toBe(200)
    expect(res.body.secretScanning.available).toBe(false)
    expect(res.body.secretScanning.reason).toMatch(/token scope/)
  })
})
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npx vitest run server/__tests__/repos-security.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the endpoint**

Create `server/routes/v1/repos-security.js`:

```js
import { Router } from 'express'
import { githubApi } from '../../lib/github-api.js'
import { auditLog } from '../../lib/audit.js'
import { requireTier } from '../../middleware/require-tier.js'

const router = Router()

function parseSettled(settled) {
  if (settled.status === 'fulfilled') {
    return { available: true, alerts: settled.value.data || [] }
  }
  const status = settled.reason?.status
  if (status === 403 || status === 404) {
    return { available: false, reason: 'Unavailable or insufficient token scope (security_events)' }
  }
  return { available: false, reason: settled.reason?.message || 'Unknown error' }
}

function bumpSeverity(summary, sev) {
  const key = (sev || '').toLowerCase()
  if (key === 'critical') summary.critical++
  else if (key === 'high' || key === 'error') summary.high++
  else if (key === 'medium' || key === 'warning') summary.medium++
  else if (key === 'low' || key === 'note') summary.low++
  else summary.medium++
  summary.total++
}

function computeSummary(result) {
  const summary = { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
  if (result.secretScanning.available) {
    for (const _ of result.secretScanning.alerts) bumpSeverity(summary, 'high')
  }
  if (result.codeScanning.available) {
    for (const a of result.codeScanning.alerts) bumpSeverity(summary, a.rule?.severity)
  }
  if (result.dependabot.available) {
    for (const a of result.dependabot.alerts) bumpSeverity(summary, a.security_advisory?.severity)
  }
  result.summary = summary
}

router.get('/repos/:owner/:repo/security', requireTier('pro'), async (req, res) => {
  const { owner, repo } = req.params
  const token = req.session?.accessToken
  if (!token) return res.status(401).json({ error: 'Not authenticated' })

  const [secretScanning, codeScanning, dependabot] = await Promise.allSettled([
    githubApi(`/repos/${owner}/${repo}/secret-scanning/alerts?state=open&per_page=100`, token),
    githubApi(`/repos/${owner}/${repo}/code-scanning/alerts?state=open&per_page=100`, token),
    githubApi(`/repos/${owner}/${repo}/dependabot/alerts?state=open&per_page=100`, token)
  ])

  const result = {
    secretScanning: parseSettled(secretScanning),
    codeScanning: parseSettled(codeScanning),
    dependabot: parseSettled(dependabot),
    summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
  }
  computeSummary(result)
  await auditLog(req, 'repo.security-scan', 'repo', `${owner}/${repo}`, { total: result.summary.total })
  res.json(result)
})

export default router
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run server/__tests__/repos-security.test.js`
Expected: PASS both cases.

- [ ] **Step 5: Mount the router**

In `server/routes/v1/index.js`:

```js
import reposSecurityRouter from './repos-security.js'
router.use(reposSecurityRouter)
```

- [ ] **Step 6: Commit**

```bash
git add server/routes/v1/repos-security.js server/routes/v1/index.js server/__tests__/repos-security.test.js
git commit -m "feat(api): add GET /api/v1/repos/:owner/:repo/security aggregation"
```

---

## Task 8: Security & Secrets Scan — frontend modal

**Files:**
- Create: `src/components/security/SecurityScanModal.jsx`
- Modify: `src/components/RepoContextMenu.jsx` — re-enable Security Scan menu item
- Modify: `src/components/RepoList.jsx` — handler for `aiSecurity`
- Modify: `src/contexts/ModalContext.jsx` — register `showSecurityScan`
- Modify: `src/App.jsx` — render modal
- Modify: `src/api/repos.js` — add `getSecurityScan()` method

- [ ] **Step 1: Add the API method**

In `src/api/repos.js`:

```js
getSecurityScan: async (owner, repo) => {
  const res = await fetch(`/api/v1/repos/${owner}/${repo}/security`, { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
```

- [ ] **Step 2: Create the modal component**

Create `src/components/security/SecurityScanModal.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { reposApi } from '../../api/repos'
import { Loader2, Shield, ShieldAlert, ShieldCheck } from 'lucide-react'
import { EmptyState } from '../ui/EmptyState'

function SeverityBadge({ level, count }) {
  const colors = {
    critical: 'bg-red-600 text-white',
    high: 'bg-orange-500 text-white',
    medium: 'bg-yellow-400 text-yellow-900',
    low: 'bg-slate-300 text-slate-800'
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`inline-flex items-center justify-center w-12 h-12 rounded-full font-bold ${colors[level]}`}>
        {count}
      </span>
      <span className="text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400">{level}</span>
    </div>
  )
}

function SourceSection({ title, source }) {
  if (!source.available) {
    return (
      <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-slate-500 mt-1">{source.reason}</p>
      </div>
    )
  }
  return (
    <details className="group rounded-lg border border-slate-200 dark:border-slate-800 ds-card-shimmer">
      <summary className="p-4 cursor-pointer flex justify-between items-center">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
          {source.alerts.length} open
        </span>
      </summary>
      <ul className="px-4 pb-4 space-y-2">
        {source.alerts.slice(0, 20).map(a => (
          <li key={a.number} className="text-xs p-2 rounded bg-slate-50 dark:bg-slate-900">
            #{a.number} — {a.rule?.description || a.security_advisory?.summary || a.state || 'Open'}
          </li>
        ))}
      </ul>
    </details>
  )
}

export function SecurityScanModal({ isOpen, onClose, repo }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isOpen || !repo) return
    let cancelled = false
    setLoading(true)
    setError(null)
    reposApi.getSecurityScan(repo.owner.login, repo.name)
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(err => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [isOpen, repo])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Security & Secrets Scan" subtitle={repo?.full_name} data-testid="security-scan-modal">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-sm">Scanning…</p>
        </div>
      ) : error ? (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-300 text-sm">{error}</div>
      ) : data && data.summary.total === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No open security alerts"
          description="This repository has no active security alerts from secret scanning, code scanning, or Dependabot."
        />
      ) : data && (
        <div className="space-y-6">
          <div className="flex justify-center gap-6">
            <SeverityBadge level="critical" count={data.summary.critical} />
            <SeverityBadge level="high" count={data.summary.high} />
            <SeverityBadge level="medium" count={data.summary.medium} />
            <SeverityBadge level="low" count={data.summary.low} />
          </div>
          <div className="space-y-3">
            <SourceSection title="Secret Scanning" source={data.secretScanning} />
            <SourceSection title="Code Scanning" source={data.codeScanning} />
            <SourceSection title="Dependabot" source={data.dependabot} />
          </div>
        </div>
      )}
    </Modal>
  )
}
```

- [ ] **Step 3: Re-enable Security menu item**

In `src/components/RepoContextMenu.jsx` around line 80-85, replace the disabled entry with:

```jsx
{ label: 'Security / Secrets Scan', icon: Shield, onClick: () => onAction('aiSecurity', repo) },
```

Import `Shield` from `lucide-react`.

- [ ] **Step 4: Register modal, wire handler, render in App.jsx**

In ModalContext: add `'showSecurityScan'` to keys.

In RepoList:
```jsx
case 'aiSecurity':
  openModalWithData('showSecurityScan', { repo: data })
  break
```

In App.jsx:
```jsx
<Suspense fallback={null}>
  <SecurityScanModal
    isOpen={modalStates.showSecurityScan}
    onClose={() => closeModal('showSecurityScan')}
    repo={getModalData('showSecurityScan')?.repo}
  />
</Suspense>
```

With lazy import.

- [ ] **Step 5: Append e2e test**

```js
test('Security Scan opens modal with severity breakdown', async ({ page }) => {
  const card = page.locator('[data-testid="repo-card"]').first()
  await card.click({ button: 'right' })
  await page.locator('text=AI').hover()
  await page.locator('text=Security / Secrets Scan').click()
  await expect(page.locator('[data-testid="security-scan-modal"]')).toBeVisible()
})
```

- [ ] **Step 6: Run the test, confirm it passes**

Run: `npx playwright test e2e/ai-completeness-wave-2.spec.js -g "Security Scan"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/security/SecurityScanModal.jsx src/components/RepoContextMenu.jsx src/components/RepoList.jsx src/contexts/ModalContext.jsx src/App.jsx src/api/repos.js e2e/ai-completeness-wave-2.spec.js
git commit -m "feat(security): wire Security and Secrets Scan modal with aggregated alerts"
```

---

## Task 9: Rate limiting + audit logging sweep on `/ai/*`

**Files:**
- Modify: `server/routes/ai.js` — apply `checkUsageLimit` + `incrementUsage` + `auditLog` to all handlers

- [ ] **Step 1: Write a test covering rate limit behavior on `/ai/suggest`**

Create `server/__tests__/ai-rate-limits.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockCheckUsage = vi.fn()
const mockIncrementUsage = vi.fn()
vi.mock('../lib/usage-meter.js', () => ({
  checkUsageLimit: mockCheckUsage,
  incrementUsage: mockIncrementUsage
}))
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../ai-service.js', () => ({
  aiService: { suggest: vi.fn().mockResolvedValue({ topics: ['web'] }), model: {} }
}))
vi.mock('../middleware/require-ai.js', () => ({ requireAI: (req, _res, next) => next() }))

describe('AI endpoints rate limiting', () => {
  let app
  beforeEach(async () => {
    vi.clearAllMocks()
    app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      req.session = { user: { id: 1, login: 'alice' } }
      req.log = { error: vi.fn() }
      next()
    })
    const router = (await import('../routes/ai.js')).default
    app.use('/api', router)
  })

  it('returns 429 when AI query limit exceeded', async () => {
    mockCheckUsage.mockReturnValue({ allowed: false, current: 100, limit: 100, remaining: 0 })
    const res = await request(app).post('/api/ai/suggest').send({ repo: { name: 'hello' } })
    expect(res.status).toBe(429)
    expect(mockIncrementUsage).not.toHaveBeenCalled()
  })

  it('increments usage on successful call', async () => {
    mockCheckUsage.mockReturnValue({ allowed: true, current: 5, limit: 100, remaining: 95 })
    const res = await request(app).post('/api/ai/suggest').send({ repo: { name: 'hello' } })
    expect(res.status).toBe(200)
    expect(mockIncrementUsage).toHaveBeenCalledWith(1, 'ai_queries')
  })
})
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npx vitest run server/__tests__/ai-rate-limits.test.js`
Expected: FAIL — `/ai/suggest` currently does not rate-limit.

- [ ] **Step 3: Apply the sweep to every /ai/* handler in `server/routes/ai.js`**

For each of these handlers, add the same pattern as `/ai/chat` already has:
- `/ai/suggest`
- `/ai/readme`
- `/ai/readme/enhance`
- `/ai/quality-report`
- `/ai/batch-index`
- `/ai/search` (only for `mode=similar-by-id`)

The pattern:

```js
router.post('/ai/suggest', requireAuth, requireAI, async (req, res) => {
  const userId = req.session.user.id
  const check = checkUsageLimit(userId, 'ai_queries')
  if (!check.allowed) {
    return res.status(429).json({
      error: 'AI query limit exceeded',
      limit: check.limit,
      current: check.current,
      upgradeUrl: '/pricing'
    })
  }
  try {
    // ... existing handler body ...
    incrementUsage(userId, 'ai_queries')
    await auditLog(req, 'ai.suggest', 'ai', null, { repoName: req.body.repo?.name })
    res.json(result)
  } catch (err) {
    req.log.error({ err }, 'ai.suggest failed')
    res.status(500).json({ error: err.message })
  }
})
```

For `batch-index`, the increment count should be `req.body.repos.length`, not 1.

Ensure `checkUsageLimit`, `incrementUsage`, and `auditLog` are imported at the top of `server/routes/ai.js` if not already.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run server/__tests__/ai-rate-limits.test.js`
Expected: PASS both cases.

- [ ] **Step 5: Commit**

```bash
git add server/routes/ai.js server/__tests__/ai-rate-limits.test.js
git commit -m "feat(ai): apply rate limiting and audit logging to all AI endpoints"
```

---

## Task 10: Harden `/ai/readme`

**Files:**
- Modify: `server/routes/ai.js` — `/ai/readme` handler

- [ ] **Step 1: Update the test to verify new behavior**

Add to `server/__tests__/ai-rate-limits.test.js`:

```js
it('/ai/readme returns structured JSON with model info', async () => {
  mockCheckUsage.mockReturnValue({ allowed: true, current: 5, limit: 100, remaining: 95 })
  // Mock aiService.model with a generateContent stub
  const res = await request(app).post('/api/ai/readme').send({ repo: { name: 'hello', description: 'test' } })
  expect(res.status).toBe(200)
  expect(res.body.success).toBe(true)
  expect(res.body.readme).toBeDefined()
  expect(res.body.model).toBeDefined()
})
```

- [ ] **Step 2: Update the `/ai/readme` handler**

In `server/routes/ai.js`, replace the existing `/ai/readme` body with:

```js
router.post('/ai/readme', requireAuth, requireAI, async (req, res) => {
  const userId = req.session.user.id
  const check = checkUsageLimit(userId, 'ai_queries')
  if (!check.allowed) {
    return res.status(429).json({ error: 'AI query limit exceeded', upgradeUrl: '/pricing' })
  }
  try {
    const repo = req.body.repo
    if (!repo || !repo.name) return res.status(400).json({ error: 'repo required' })
    const cleanName = sanitizeForPrompt(repo.name)
    const cleanDescription = sanitizeForPrompt(repo.description || '')
    const prompt = `Generate a comprehensive README for a repository named "${cleanName}" described as "${cleanDescription}". Use conventional sections: title, description, installation, usage, license.`

    let model = aiService.model
    let modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
    let result
    try {
      result = await model.generateContent(prompt)
    } catch (err) {
      if (err.status === 404) {
        // Fallback to flash-lite
        modelName = 'gemini-2.5-flash-lite'
        const { getModel } = await import('../ai-service.js')
        model = getModel(modelName)
        result = await model.generateContent(prompt)
      } else {
        throw err
      }
    }

    const text = result.response.text()
    incrementUsage(userId, 'ai_queries')
    await auditLog(req, 'ai.readme', 'ai', null, { repoName: repo.name, model: modelName })
    res.json({ success: true, readme: text, model: modelName })
  } catch (err) {
    req.log.error({ err }, 'AI README generation failed')
    res.status(500).json({ error: err.message || 'Failed to generate README' })
  }
})
```

Ensure `sanitizeForPrompt` is imported (it is used by `/ai/chat` — copy that import).

- [ ] **Step 3: Run the test, confirm it passes**

Run: `npx vitest run server/__tests__/ai-rate-limits.test.js -t readme`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/routes/ai.js server/__tests__/ai-rate-limits.test.js
git commit -m "feat(ai): harden /ai/readme with sanitization, model fallback, structured response"
```

---

## Self-review checklist

- [ ] CommitGeneratorModal reachable from RepoContextMenu AI submenu and BranchesTab
- [ ] RepoInsightsModal README tab has working "Enhance with AI" button with diff view
- [ ] Bulk menu has "Batch Index with AI" that opens progress modal
- [ ] Compare with Existing drawer renders top-5 similar or index-first CTA
- [ ] Security Scan modal shows severity donut + 3 expandable source sections
- [ ] Zero menu items in RepoContextMenu have `disabled: true` with "Coming Soon"
- [ ] All `/ai/*` endpoints enforce `ai_queries` rate limit and log audit events
- [ ] `/ai/readme` sanitizes prompt, falls back to flash-lite on 404, returns structured JSON
- [ ] `npx vitest run server/__tests__/ai-search-similar-mode.test.js server/__tests__/repos-security.test.js server/__tests__/ai-rate-limits.test.js` passes
- [ ] `npx playwright test e2e/ai-completeness-wave-2.spec.js` passes all 5 scenarios
- [ ] `npm run build` succeeds
- [ ] Manual smoke: exercise each new entry point end-to-end
