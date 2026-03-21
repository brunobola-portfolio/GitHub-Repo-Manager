# Transfer Conflict Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect name conflicts before transferring repos and let the user resolve each conflict (replace, rename, or skip) with a side-by-side comparison.

**Architecture:** New `POST /api/transfer/check-conflicts` endpoint checks repo existence in the target org via GitHub API. The TransferModal gains conflict state management — when a target org is selected, it fires the check and renders inline conflict panels with resolution buttons. The existing `/api/transfer` endpoint accepts an optional `strategies` map to handle replace (delete target first), rename (pass `new_name`), and skip.

**Tech Stack:** React 19, Express, Zod, GitHub REST API, Tailwind CSS, Vitest

**Spec:** `docs/specs/2026-03-21-transfer-conflict-resolution.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/lib/validators.js` | Modify | Add `checkConflictsSchema`, update `bulkTransferSchema` |
| `server/routes/bulk.js` | Modify | Add `/transfer/check-conflicts` endpoint, update `/transfer` with strategy handling |
| `server/__tests__/validators.test.js` | Modify | Tests for new/updated schemas |
| `server/__tests__/bulk-conflicts.test.js` | Create | Tests for conflict check and strategy-based transfer |
| `src/config.js` | Modify | Add `checkConflicts` endpoint |
| `src/components/TransferModal.jsx` | Modify | Conflict UI: check, compare, resolve |
| `src/components/ConflictPanel.jsx` | Create | Inline comparison panel for a single conflicting repo |
| `src/App.jsx` | Modify | Pass strategies from TransferModal to performAction |
| `tests/components/ConflictPanel.test.jsx` | Create | Unit tests for ConflictPanel |

---

### Task 1: Backend — Validation Schemas

**Files:**
- Modify: `server/lib/validators.js:40-43`
- Modify: `server/__tests__/validators.test.js`

- [ ] **Step 1: Write failing tests for new schemas**

In `server/__tests__/validators.test.js`, add:

```javascript
describe('checkConflictsSchema', () => {
    it('accepts valid data', () => {
        const result = checkConflictsSchema.safeParse({
            repos: ['owner/repo1', 'owner/repo2'],
            targetOrg: 'my-org'
        })
        expect(result.success).toBe(true)
    })

    it('rejects missing targetOrg', () => {
        const result = checkConflictsSchema.safeParse({ repos: ['a/b'] })
        expect(result.success).toBe(false)
    })

    it('rejects empty repos', () => {
        const result = checkConflictsSchema.safeParse({ repos: [], targetOrg: 'org' })
        expect(result.success).toBe(false)
    })
})

describe('bulkTransferSchema with strategies', () => {
    it('accepts transfer without strategies (backward compat)', () => {
        const result = bulkTransferSchema.safeParse({
            repos: ['owner/repo'],
            toOrg: 'target-org'
        })
        expect(result.success).toBe(true)
    })

    it('accepts transfer with strategies', () => {
        const result = bulkTransferSchema.safeParse({
            repos: ['owner/repo'],
            toOrg: 'target-org',
            strategies: {
                'owner/repo': { action: 'replace' }
            }
        })
        expect(result.success).toBe(true)
    })

    it('accepts rename strategy with newName', () => {
        const result = bulkTransferSchema.safeParse({
            repos: ['owner/repo'],
            toOrg: 'target-org',
            strategies: {
                'owner/repo': { action: 'rename', newName: 'repo-2' }
            }
        })
        expect(result.success).toBe(true)
        expect(result.data.strategies['owner/repo'].newName).toBe('repo-2')
    })

    it('rejects invalid strategy action', () => {
        const result = bulkTransferSchema.safeParse({
            repos: ['owner/repo'],
            toOrg: 'target-org',
            strategies: {
                'owner/repo': { action: 'destroy' }
            }
        })
        expect(result.success).toBe(false)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/validators.test.js`
Expected: FAIL — `checkConflictsSchema` not defined, `strategies` not accepted

- [ ] **Step 3: Implement schemas**

In `server/lib/validators.js`, add after line 43:

```javascript
export const checkConflictsSchema = z.object({
    repos: z.array(z.string().min(1).max(200)).min(1).max(100),
    targetOrg: z.string().min(1).max(39)
})
```

Update `bulkTransferSchema` (replace lines 40-43):

```javascript
const strategySchema = z.object({
    action: z.enum(['transfer', 'replace', 'rename', 'skip']),
    newName: z.string().min(1).max(100).optional()
})

export const bulkTransferSchema = z.object({
    repos: z.array(z.string().min(1).max(200)).min(1).max(100),
    toOrg: z.string().min(1).max(39),
    strategies: z.record(z.string(), strategySchema).optional()
})
```

Add `checkConflictsSchema` to the import in `server/routes/bulk.js` (line 18).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/validators.test.js`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/validators.js server/__tests__/validators.test.js
git commit -m "feat(api): add conflict check and transfer strategy schemas"
```

---

### Task 2: Backend — Check Conflicts Endpoint

**Files:**
- Modify: `server/routes/bulk.js`

- [ ] **Step 1: Add the `/transfer/check-conflicts` endpoint**

In `server/routes/bulk.js`, add before the existing `/transfer` route (before line 69):

```javascript
// Check for name conflicts before transfer
router.post('/transfer/check-conflicts', requireAuth, validate(checkConflictsSchema), async (req, res) => {
    const { repos, targetOrg } = req.body

    if (!isValidGitHubUsername(targetOrg))
        return errorResponse(res, 400, 'Invalid target organization name', 'INVALID_ORG')

    const conflicts = {}

    await Promise.all(repos.map(async (repoFullName) => {
        const repoName = repoFullName.split('/').pop()
        try {
            // Check if repo with same name exists in target org
            const { data: targetRepo } = await githubApi(
                `/repos/${encodeURIComponent(targetOrg)}/${encodeURIComponent(repoName)}`,
                req.session.accessToken
            )
            // Also fetch source repo metadata for comparison
            const { data: sourceRepo } = await githubApi(
                `/repos/${repoFullName}`,
                req.session.accessToken
            )

            const pick = (r) => ({
                full_name: r.full_name,
                updated_at: r.updated_at,
                pushed_at: r.pushed_at,
                size: r.size,
                default_branch: r.default_branch,
                stargazers_count: r.stargazers_count,
                forks_count: r.forks_count,
                language: r.language,
                description: r.description,
                open_issues_count: r.open_issues_count
            })

            conflicts[repoName] = {
                exists: true,
                source: pick(sourceRepo),
                target: pick(targetRepo)
            }
        } catch (error) {
            if (error.status === 404) {
                // No conflict — target repo doesn't exist
                conflicts[repoName] = { exists: false }
            } else {
                // API error — report it but don't block
                conflicts[repoName] = { exists: false, error: safeError(error, 'Check failed') }
            }
        }
    }))

    res.json({ conflicts })
})
```

Update the import on line 18 to include `checkConflictsSchema`.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS (no regressions)

- [ ] **Step 3: Commit**

```bash
git add server/routes/bulk.js
git commit -m "feat(api): add /transfer/check-conflicts endpoint"
```

---

### Task 3: Backend — Strategy-Based Transfer

**Files:**
- Modify: `server/routes/bulk.js:70-113`

- [ ] **Step 1: Update the `/transfer` handler to support strategies**

Replace the transfer route's processing loop (lines 78-93) with:

```javascript
    const { repos, toOrg, strategies } = req.body

    // ... existing validation (lines 73-76) ...

    const results = []

    for (const repoFullName of repos) {
        const strategy = strategies?.[repoFullName]
        const action = strategy?.action || 'transfer'

        // Skip repos marked as skip
        if (action === 'skip') {
            results.push({ repo: repoFullName, success: true, skipped: true })
            continue
        }

        try {
            // Replace: delete target repo first
            if (action === 'replace') {
                const repoName = repoFullName.split('/').pop()
                try {
                    await githubApi(`/repos/${toOrg}/${repoName}`, req.session.accessToken, {
                        method: 'DELETE'
                    })
                } catch (delError) {
                    if (delError.status !== 404) {
                        results.push({ repo: repoFullName, success: false, error: `Failed to delete target: ${safeError(delError)}` })
                        continue
                    }
                    // 404 means target already gone — proceed with transfer
                }
            }

            // Build transfer body
            const transferBody = { new_owner: toOrg }
            if (action === 'rename' && strategy?.newName) {
                transferBody.new_name = strategy.newName
            }

            await githubApi(`/repos/${repoFullName}/transfer`, req.session.accessToken, {
                method: 'POST',
                body: JSON.stringify(transferBody)
            })
            results.push({ repo: repoFullName, success: true })
        } catch (error) {
            const ghErrors = error.data?.errors?.map(e => e.message).join('; ')
            const detail = ghErrors || safeError(error, 'Operation failed')
            results.push({ repo: repoFullName, success: false, error: detail })
        }
    }
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add server/routes/bulk.js
git commit -m "feat(api): support replace/rename/skip strategies in transfer"
```

---

### Task 4: Frontend — Config & API Wiring

**Files:**
- Modify: `src/config.js:21-29`
- Modify: `src/App.jsx:694-721`

- [ ] **Step 1: Add checkConflicts endpoint to config**

In `src/config.js`, add to `API_ENDPOINTS`:

```javascript
export const API_ENDPOINTS = {
    user: `${API_BASE_URL}/api/user`,
    repos: `${API_BASE_URL}/api/repos`,
    visibility: `${API_BASE_URL}/api/visibility`,
    transfer: `${API_BASE_URL}/api/transfer`,
    checkConflicts: `${API_BASE_URL}/api/transfer/check-conflicts`,
    mirror: `${API_BASE_URL}/api/mirror`,
    archive: `${API_BASE_URL}/api/archive`,
    delete: `${API_BASE_URL}/api/delete`,
}
```

- [ ] **Step 2: Update App.jsx onTransfer to pass strategies**

Update the `onTransfer` callback in `src/App.jsx` (around line 694):

```jsx
onTransfer={async (repoNames, targetOrg, strategies) => {
    try {
        const body = strategies && Object.keys(strategies).length > 0
            ? { repos: repoNames, toOrg: targetOrg, strategies }
            : undefined
        const result = await performAction('transfer', repoNames, targetOrg, body)
        if (result?.success) {
            toast.success(`Transferred ${repoNames.length} repo(s) to ${targetOrg}`)
            closeModal('showTransfer')
            refresh()
        } else {
            toast.error(result?.message || 'Transfer failed')
        }
    } catch (err) {
        toast.error(`Transfer failed: ${err.message}`)
    }
}}
```

Also update the `onTransfer` call in `TransferModal.jsx` `handleSubmit` (line 56) to pass strategies:

```javascript
onTransfer?.(repos.map(r => r.full_name), targetOrg, strategies)
```

Where `strategies` is built from the conflict resolution state (implemented in Task 5).

- [ ] **Step 3: Commit**

```bash
git add src/config.js src/App.jsx
git commit -m "feat(frontend): wire checkConflicts endpoint and strategy passing"
```

---

### Task 5: Frontend — ConflictPanel Component

**Files:**
- Create: `src/components/ConflictPanel.jsx`
- Create: `tests/components/ConflictPanel.test.jsx`

- [ ] **Step 1: Write failing test**

Create `tests/components/ConflictPanel.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConflictPanel } from '../../src/components/ConflictPanel'

const mockConflict = {
    exists: true,
    source: {
        full_name: 'user/repo',
        updated_at: '2026-01-16T00:00:00Z',
        pushed_at: '2026-01-16T00:00:00Z',
        size: 2400,
        language: 'JavaScript',
        stargazers_count: 5,
        forks_count: 2
    },
    target: {
        full_name: 'org/repo',
        updated_at: '2025-12-01T00:00:00Z',
        pushed_at: '2025-12-01T00:00:00Z',
        size: 2100,
        language: 'JavaScript',
        stargazers_count: 0,
        forks_count: 0
    }
}

describe('ConflictPanel', () => {
    it('renders source and target metadata', () => {
        render(<ConflictPanel conflict={mockConflict} repoName="repo" onResolve={() => {}} />)
        expect(screen.getByText('Source')).toBeInTheDocument()
        expect(screen.getByText('Target')).toBeInTheDocument()
    })

    it('shows source is newer when source updated_at > target', () => {
        render(<ConflictPanel conflict={mockConflict} repoName="repo" onResolve={() => {}} />)
        expect(screen.getByText(/newer/i)).toBeInTheDocument()
    })

    it('calls onResolve with replace action', () => {
        const onResolve = vi.fn()
        render(<ConflictPanel conflict={mockConflict} repoName="repo" onResolve={onResolve} />)
        fireEvent.click(screen.getByRole('button', { name: /replace/i }))
        // Replace requires confirmation click
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
        expect(onResolve).toHaveBeenCalledWith({ action: 'replace' })
    })

    it('calls onResolve with skip action', () => {
        const onResolve = vi.fn()
        render(<ConflictPanel conflict={mockConflict} repoName="repo" onResolve={onResolve} />)
        fireEvent.click(screen.getByRole('button', { name: /skip/i }))
        expect(onResolve).toHaveBeenCalledWith({ action: 'skip' })
    })

    it('calls onResolve with rename action and new name', () => {
        const onResolve = vi.fn()
        render(<ConflictPanel conflict={mockConflict} repoName="repo" onResolve={onResolve} />)
        fireEvent.click(screen.getByRole('button', { name: /rename/i }))
        const input = screen.getByDisplayValue('repo-2')
        fireEvent.change(input, { target: { value: 'repo-new' } })
        fireEvent.click(screen.getByRole('button', { name: /confirm rename/i }))
        expect(onResolve).toHaveBeenCalledWith({ action: 'rename', newName: 'repo-new' })
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/ConflictPanel.test.jsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ConflictPanel**

Create `src/components/ConflictPanel.jsx`:

```jsx
import { useState } from 'react'
import { AlertTriangle, ArrowRight, Check, Edit3, SkipForward, Trash2 } from 'lucide-react'

function formatSize(kb) {
    if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
    return `${kb} KB`
}

function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function compareSummary(source, target) {
    const srcDate = new Date(source.pushed_at || source.updated_at)
    const tgtDate = new Date(target.pushed_at || target.updated_at)
    const diffDays = Math.round((srcDate - tgtDate) / (1000 * 60 * 60 * 24))

    if (Math.abs(diffDays) < 1 && source.size === target.size) return { text: 'Repos appear identical', type: 'neutral' }
    if (diffDays > 0) return { text: `Source is newer (updated ${diffDays}d later)`, type: 'source' }
    return { text: `Target is newer (updated ${Math.abs(diffDays)}d later)`, type: 'target' }
}

export function ConflictPanel({ conflict, repoName, onResolve, resolution }) {
    const [mode, setMode] = useState(null) // null | 'replace-confirm' | 'rename'
    const [newName, setNewName] = useState(`${repoName}-2`)

    const { source, target } = conflict
    const summary = compareSummary(source, target)

    const rows = [
        ['Updated', formatDate(source.pushed_at || source.updated_at), formatDate(target.pushed_at || target.updated_at)],
        ['Size', formatSize(source.size), formatSize(target.size)],
        ['Language', source.language || '—', target.language || '—'],
        ['Stars', source.stargazers_count, target.stargazers_count],
        ['Forks', source.forks_count, target.forks_count],
    ]

    if (resolution) {
        const labels = { replace: 'Will replace target', rename: `Will rename to ${resolution.newName}`, skip: 'Will skip' }
        const colors = { replace: 'text-red-600 dark:text-red-400', rename: 'text-blue-600 dark:text-blue-400', skip: 'text-slate-500' }
        return (
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-700/30">
                <span className={`text-xs font-medium ${colors[resolution.action]}`}>
                    {labels[resolution.action]}
                </span>
                <button
                    onClick={() => onResolve(null)}
                    className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                    Change
                </button>
            </div>
        )
    }

    return (
        <div className="mt-2 p-3 rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-900/10 space-y-3">
            {/* Comparison Table */}
            <div className="grid grid-cols-3 gap-1 text-[11px]">
                <div className="font-semibold text-slate-500 dark:text-slate-400"></div>
                <div className="font-semibold text-emerald-600 dark:text-emerald-400">Source</div>
                <div className="font-semibold text-orange-600 dark:text-orange-400">Target</div>
                {rows.map(([label, src, tgt]) => (
                    <Fragment key={label}>
                        <div className="text-slate-500 dark:text-slate-400">{label}</div>
                        <div className="text-slate-800 dark:text-slate-200">{src}</div>
                        <div className="text-slate-800 dark:text-slate-200">{tgt}</div>
                    </Fragment>
                ))}
            </div>

            {/* Summary */}
            <div className={`text-xs font-medium ${
                summary.type === 'source' ? 'text-emerald-600 dark:text-emerald-400'
                : summary.type === 'target' ? 'text-orange-600 dark:text-orange-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}>
                {summary.text}
            </div>

            {/* Action Buttons or Confirmation */}
            {mode === 'replace-confirm' ? (
                <div className="space-y-2">
                    <p className="text-[11px] text-red-600 dark:text-red-400">
                        This will permanently delete <strong>{target.full_name}</strong> and replace it with your version.
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => { onResolve({ action: 'replace' }); setMode(null) }}
                            className="px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
                            aria-label="Confirm replace"
                        >
                            Confirm Replace
                        </button>
                        <button
                            onClick={() => setMode(null)}
                            className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : mode === 'rename' ? (
                <div className="space-y-2">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            className="flex-1 px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                            placeholder="New repo name"
                        />
                        <button
                            onClick={() => { onResolve({ action: 'rename', newName }); setMode(null) }}
                            disabled={!newName || newName === repoName}
                            className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors disabled:opacity-50"
                            aria-label="Confirm rename"
                        >
                            Confirm Rename
                        </button>
                    </div>
                    <button
                        onClick={() => setMode(null)}
                        className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    >
                        Cancel
                    </button>
                </div>
            ) : (
                <div className="flex gap-2">
                    <button
                        onClick={() => setMode('replace-confirm')}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        aria-label="Replace target"
                    >
                        <Trash2 className="w-3 h-3" /> Replace
                    </button>
                    <button
                        onClick={() => setMode('rename')}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                        aria-label="Rename repo"
                    >
                        <Edit3 className="w-3 h-3" /> Rename
                    </button>
                    <button
                        onClick={() => onResolve({ action: 'skip' })}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                        aria-label="Skip this repo"
                    >
                        <SkipForward className="w-3 h-3" /> Skip
                    </button>
                </div>
            )}
        </div>
    )
}
```

Add `import { Fragment } from 'react'` at the top.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/ConflictPanel.test.jsx`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ConflictPanel.jsx tests/components/ConflictPanel.test.jsx
git commit -m "feat(ui): add ConflictPanel component with compare/replace/rename/skip"
```

---

### Task 6: Frontend — TransferModal Conflict Integration

**Files:**
- Modify: `src/components/TransferModal.jsx`

- [ ] **Step 1: Add conflict state and check logic to TransferModal**

Add imports at top:

```javascript
import { useState, useEffect, useCallback } from 'react'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { ConflictPanel } from './ConflictPanel'
import { API_ENDPOINTS } from '../config'
```

Add state variables after `formError` state (line 19):

```javascript
const [conflicts, setConflicts] = useState(null) // null = unchecked, {} = checked
const [checkingConflicts, setCheckingConflicts] = useState(false)
const [resolutions, setResolutions] = useState({}) // { repoName: { action, newName? } }
```

Add conflict check effect — fires when `targetOrg` changes:

```javascript
useEffect(() => {
    if (!targetOrg || !repos.length || action !== 'transfer') {
        setConflicts(null)
        setResolutions({})
        return
    }

    let cancelled = false
    async function checkConflicts() {
        setCheckingConflicts(true)
        setConflicts(null)
        setResolutions({})
        try {
            const resp = await fetch(API_ENDPOINTS.checkConflicts, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    repos: repos.map(r => r.full_name),
                    targetOrg
                })
            })
            if (!cancelled && resp.ok) {
                const data = await resp.json()
                setConflicts(data.conflicts || {})
            }
        } catch {
            // Silently fail — transfer will still catch conflicts
        } finally {
            if (!cancelled) setCheckingConflicts(false)
        }
    }
    checkConflicts()
    return () => { cancelled = true }
}, [targetOrg, repos, action])
```

- [ ] **Step 2: Update the repo preview section to show conflict status**

Replace the Repository Preview section (lines 204-226) with:

```jsx
{/* Repository Preview with Conflict Status */}
<div>
    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
        Repositories to {action === 'transfer' ? 'Transfer' : 'Mirror'}
    </label>
    <div className="max-h-60 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-700">
        {repos.map(repo => {
            const conflict = conflicts?.[repo.name]
            const hasConflict = conflict?.exists === true
            const resolution = resolutions[repo.name]

            return (
                <div key={repo.id} className="p-3">
                    <div className="flex items-center gap-3">
                        {checkingConflicts ? (
                            <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0" />
                        ) : hasConflict ? (
                            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                        ) : conflicts ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        ) : (
                            <GitFork className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                            <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{repo.name}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{repo.full_name}</div>
                        </div>
                        {targetOrg && !hasConflict && (
                            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                                <ArrowRight className="w-4 h-4" />
                                <span className="text-indigo-600 dark:text-indigo-400 font-medium">{targetOrg}/{repo.name}</span>
                            </div>
                        )}
                        {hasConflict && !resolution && (
                            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Conflict</span>
                        )}
                    </div>
                    {hasConflict && (
                        <ConflictPanel
                            conflict={conflict}
                            repoName={repo.name}
                            resolution={resolution}
                            onResolve={(r) => setResolutions(prev => {
                                const next = { ...prev }
                                if (r === null) { delete next[repo.name] }
                                else { next[repo.name] = r }
                                return next
                            })}
                        />
                    )}
                </div>
            )
        })}
    </div>
</div>
```

- [ ] **Step 3: Update handleSubmit to include strategies**

Replace `handleSubmit` (lines 45-60):

```javascript
const handleSubmit = () => {
    if (!targetOrg) {
        setFormError('Please select a target organization')
        return
    }
    if (isTransferToSelf) {
        setFormError('Cannot transfer repositories to their current owner')
        return
    }

    // Check all conflicts are resolved
    if (conflicts) {
        const unresolvedConflicts = repos.filter(r => conflicts[r.name]?.exists && !resolutions[r.name])
        if (unresolvedConflicts.length > 0) {
            setFormError(`Resolve ${unresolvedConflicts.length} conflict(s) before transferring`)
            return
        }
    }

    setFormError('')

    // Build strategies map from resolutions
    const strategies = {}
    for (const repo of repos) {
        const resolution = resolutions[repo.name]
        if (resolution) {
            strategies[repo.full_name] = resolution
        }
    }

    if (action === 'transfer') {
        onTransfer?.(repos.map(r => r.full_name), targetOrg, strategies)
    } else {
        onMirror?.(repos.map(r => r.full_name), targetOrg)
    }
}
```

- [ ] **Step 4: Update footer to show resolution summary**

Replace the footer text (line 242-243):

```jsx
<span className="text-sm text-slate-500 dark:text-slate-400">
    {(() => {
        const skipped = Object.values(resolutions).filter(r => r.action === 'skip').length
        const replaced = Object.values(resolutions).filter(r => r.action === 'replace').length
        const renamed = Object.values(resolutions).filter(r => r.action === 'rename').length
        const transferCount = repos.length - skipped

        if (replaced || renamed || skipped) {
            const parts = []
            if (transferCount > 0) parts.push(`${transferCount} transfer`)
            if (replaced > 0) parts.push(`${replaced} replace`)
            if (renamed > 0) parts.push(`${renamed} rename`)
            if (skipped > 0) parts.push(`${skipped} skip`)
            return parts.join(', ')
        }
        return `${repos.length} repo${repos.length !== 1 ? 's' : ''} will be ${action === 'transfer' ? 'transferred' : 'mirrored'}`
    })()}
</span>
```

Update Transfer button disabled state:

```jsx
disabled={!targetOrg || isPerforming || checkingConflicts || (conflicts && repos.some(r => conflicts[r.name]?.exists && !resolutions[r.name]))}
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/TransferModal.jsx
git commit -m "feat(ui): integrate conflict detection and resolution into TransferModal"
```

---

### Task 7: Integration Test & Final Verification

**Files:** All modified files

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: Manual verification with Playwright MCP**

1. Start the dev server: `npm run dev:all`
2. Navigate to app, authenticate
3. Select a repo that exists in both personal and an org
4. Click Transfer, select the org that has the conflict
5. Verify: conflict panel appears with comparison data
6. Test Replace: click Replace → confirm → verify transfer succeeds
7. Test Rename: click Rename → enter new name → confirm → verify
8. Test Skip: click Skip → verify repo excluded from transfer
9. Verify Transfer button disabled until all conflicts resolved

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: transfer conflict resolution with compare, replace, rename, skip"
```
