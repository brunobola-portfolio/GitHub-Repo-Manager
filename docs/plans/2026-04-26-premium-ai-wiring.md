# Premium AI — Wiring & Auto-Tag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface four already-built AI capabilities to the user — gate Commit/PR generation on `useAIStatus().configured`, make `RepoHealthBadge` open the AI Insights Quality tab, and add an "AI-suggested topics" section to RepoDetail Settings.

**Architecture:** Pure frontend wiring + ~20 lines of new component code. Reuses `aiApi.getMetadata()`, `PUT /api/repos/:owner/:repo/topics`, and the `showRepoInsights` modal already registered in `ModalContext`. No new backend endpoints. No new dependencies.

**Tech Stack:** React 19, Vite, Tailwind v4, framer-motion, lucide-react, Vitest + RTL.

**Spec:** [docs/specs/2026-04-26-premium-ai-wiring.md](../specs/2026-04-26-premium-ai-wiring.md)

---

## File Structure

**Modify:**
- `src/components/DevToolkit/CommitTab/CommitTab.jsx` — gate Generate button on `useAIStatus().configured`
- `src/components/RepoDetail/PRDetailPanel.jsx:234-242` — gate Generate Description button
- `src/components/AI/RepoHealthBadge.jsx` — convert `<span>` to `<button>`, accept `onClick` prop
- `src/components/RepoList/RepoCard.jsx` — accept new `onExplainHealth` prop, pass to badge
- `src/components/RepoList/RepoGrid.jsx` — propagate `onExplainHealth`
- `src/components/RepoList/index.jsx:139-141` — wire `onExplainHealth={(repo) => openModalWithData('showRepoInsights', { repo, initialTab: 'quality' })}`
- `src/components/RepoDetail/SettingsTab.jsx` — add "AI-suggested topics" section

**Test (create or extend):**
- `tests/components/DevToolkit/CommitTab.test.jsx`
- `tests/components/RepoDetail/PRDetailPanel.test.jsx`
- `tests/components/AI/RepoHealthBadge.test.jsx`
- `tests/components/RepoDetail/SettingsTab.aiTopics.test.jsx`

---

## Slice 2.1 — Commit AI fail-silent gate

### Task 1: Gate Generate button on useAIStatus

**Files:**
- Modify: `src/components/DevToolkit/CommitTab/CommitTab.jsx`
- Test: `tests/components/DevToolkit/CommitTab.test.jsx` (extend or create)

- [ ] **Step 1: Read the file to find the Generate button**

Run: `Grep -n "Generate\|startStream\|handleGenerate" src/components/DevToolkit/CommitTab/CommitTab.jsx`

Expected: identify the JSX `<button>` (or `<Button>`) element that triggers `handleGenerate` / starts the stream. Note its current props.

- [ ] **Step 2: Write the failing test**

```jsx
// tests/components/DevToolkit/CommitTab.test.jsx — extend or create
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CommitTab } from '@/components/DevToolkit/CommitTab/CommitTab'

vi.mock('@/hooks/useAIStatus', () => ({ useAIStatus: vi.fn() }))
import { useAIStatus } from '@/hooks/useAIStatus'

const baseToolkit = {
  selectedRepo: { name: 'r', full_name: 'o/r' },
  headBranch: 'feature',
  baseBranch: 'main',
  branches: [],
  compareData: { diff_summary: { additions: 5, deletions: 2 } },
  compareLoading: false,
  handleBranchChange: vi.fn(),
  getDiffText: () => 'diff --git a/x b/x',
  repoOwner: 'o',
  history: [],
  addToHistory: vi.fn(),
  setGeneratedCommit: vi.fn(),
}

describe('CommitTab — AI not configured', () => {
  it('disables the Generate button with a tooltip when AI is off', () => {
    useAIStatus.mockReturnValue({ configured: false, loading: false })
    render(<CommitTab toolkit={baseToolkit} />)
    const btn = screen.getByRole('button', { name: /generate/i })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', expect.stringContaining('Settings'))
  })

  it('enables the Generate button when AI is configured', () => {
    useAIStatus.mockReturnValue({ configured: true, loading: false })
    render(<CommitTab toolkit={baseToolkit} />)
    const btn = screen.getByRole('button', { name: /generate/i })
    expect(btn).not.toBeDisabled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd "s:/Git Hub Repo Manager" && npx vitest run tests/components/DevToolkit/CommitTab`
Expected: FAIL — current button is always enabled OR test file doesn't exist yet.

- [ ] **Step 4: Add the gate to CommitTab.jsx**

```jsx
// At the top of CommitTab.jsx, near the other imports:
import { useAIStatus } from '../../../hooks/useAIStatus'

// Inside the CommitTab component body, after destructuring `toolkit`:
const aiStatus = useAIStatus()
const aiOff = !aiStatus.loading && !aiStatus.configured

// Find the Generate button (around the handleGenerate handler) and replace its
// disabled/title props:
<Button
    variant="primary"
    onClick={handleGenerate}
    disabled={aiOff || isStreaming || !diff?.trim()}
    title={aiOff ? 'Configure AI in Settings → AI to enable generation' : undefined}
>
    Generate
</Button>
```

If the button was a `<button>` (not the `Button` component), preserve its original element but apply the same `disabled` + `title` updates.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd "s:/Git Hub Repo Manager" && npx vitest run tests/components/DevToolkit/CommitTab`
Expected: PASS (both cases).

- [ ] **Step 6: Run the unit suite to confirm no regression**

Run: `cd "s:/Git Hub Repo Manager" && npx vitest run`
Expected: 2700+ tests pass.

- [ ] **Step 7: Commit**

```bash
cd "s:/Git Hub Repo Manager"
git add src/components/DevToolkit/CommitTab/CommitTab.jsx tests/components/DevToolkit/CommitTab.test.jsx
git commit -m "feat(ai): gate CommitTab Generate button on AI configured"
```

---

## Slice 2.2 — PR description fail-silent gate + verify

### Task 2: Gate PRDetailPanel Generate Description button

**Files:**
- Modify: `src/components/RepoDetail/PRDetailPanel.jsx:234-242`
- Test: `tests/components/RepoDetail/PRDetailPanel.test.jsx` (extend or create)

- [ ] **Step 1: Read the current button block**

Run: `Read src/components/RepoDetail/PRDetailPanel.jsx 230 16`

Expected output: see lines 234-242 with the `{onGenerateDescription && (...)}` block, the `<button>` rendering "Generate Description".

- [ ] **Step 2: Write the failing test**

```jsx
// tests/components/RepoDetail/PRDetailPanel.test.jsx — extend or create
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PRDetailPanel } from '@/components/RepoDetail/PRDetailPanel'

vi.mock('@/hooks/useAIStatus', () => ({ useAIStatus: vi.fn() }))
import { useAIStatus } from '@/hooks/useAIStatus'

const stubPR = {
    number: 7,
    title: 'Add caching',
    user: { login: 'alice', avatar_url: '' },
    body: '',
    head: { ref: 'feat/cache' },
    base: { ref: 'main' },
    state: 'open',
    additions: 5,
    deletions: 2,
    changed_files: 1,
}
const stubApi = {
    getPRFiles: vi.fn().mockResolvedValue([]),
    getPRComments: vi.fn().mockResolvedValue([]),
    getPRReviews: vi.fn().mockResolvedValue([]),
}

describe('PRDetailPanel — Generate Description gate', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('renders the Generate Description button when AI is configured', () => {
        useAIStatus.mockReturnValue({ configured: true, loading: false })
        render(<PRDetailPanel pr={stubPR} api={stubApi} onGenerateDescription={() => {}} />)
        const btn = screen.getByRole('button', { name: /generate description/i })
        expect(btn).toBeEnabled()
    })

    it('disables the button with a tooltip when AI is off', () => {
        useAIStatus.mockReturnValue({ configured: false, loading: false })
        render(<PRDetailPanel pr={stubPR} api={stubApi} onGenerateDescription={() => {}} />)
        const btn = screen.getByRole('button', { name: /generate description/i })
        expect(btn).toBeDisabled()
        expect(btn).toHaveAttribute('title', expect.stringContaining('Settings'))
    })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd "s:/Git Hub Repo Manager" && npx vitest run tests/components/RepoDetail/PRDetailPanel`
Expected: FAIL — button is currently always enabled.

- [ ] **Step 4: Apply the gate**

```jsx
// At the top of PRDetailPanel.jsx near other hook imports:
import { useAIStatus } from '../../hooks/useAIStatus'

// Inside the PRDetailPanel function body, near the top:
const aiStatus = useAIStatus()
const aiOff = !aiStatus.loading && !aiStatus.configured

// Replace the existing block at lines 234-242:
{onGenerateDescription && (
    <button
        type="button"
        onClick={() => onGenerateDescription?.(pr)}
        disabled={aiOff}
        title={aiOff ? 'Configure AI in Settings → AI to enable generation' : undefined}
        className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 transition-colors ${aiOff ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
        <Wand2 className="w-3.5 h-3.5" />
        Generate Description
    </button>
)}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd "s:/Git Hub Repo Manager" && npx vitest run tests/components/RepoDetail/PRDetailPanel`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd "s:/Git Hub Repo Manager"
git add src/components/RepoDetail/PRDetailPanel.jsx tests/components/RepoDetail/PRDetailPanel.test.jsx
git commit -m "feat(ai): gate PRDetailPanel Generate Description on AI configured"
```

---

## Slice 2.3 — RepoHealthBadge → Insights Quality tab

### Task 3: Make RepoHealthBadge clickable

**Files:**
- Modify: `src/components/AI/RepoHealthBadge.jsx`
- Test: `tests/components/AI/RepoHealthBadge.test.jsx` (extend or create)

- [ ] **Step 1: Write the failing test**

```jsx
// tests/components/AI/RepoHealthBadge.test.jsx — extend or create
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RepoHealthBadge } from '@/components/AI/RepoHealthBadge'

describe('RepoHealthBadge', () => {
    it('renders nothing when score is null', () => {
        const { container } = render(<RepoHealthBadge score={null} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders as a span (non-interactive) when no onClick is provided', () => {
        render(<RepoHealthBadge score={75} />)
        const el = screen.getByLabelText(/AI health score 75/i)
        expect(el.tagName).toBe('SPAN')
    })

    it('renders as a button and fires onClick when provided', () => {
        const handler = vi.fn()
        render(<RepoHealthBadge score={75} onClick={handler} />)
        const btn = screen.getByRole('button', { name: /AI health score 75/i })
        fireEvent.click(btn)
        expect(handler).toHaveBeenCalledTimes(1)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "s:/Git Hub Repo Manager" && npx vitest run tests/components/AI/RepoHealthBadge`
Expected: FAIL on the third test — currently always a `<span>` and accepts no `onClick`.

- [ ] **Step 3: Update RepoHealthBadge to support optional onClick**

Replace the entire return statement in `src/components/AI/RepoHealthBadge.jsx`:

```jsx
export function RepoHealthBadge({ score, className = '', onClick }) {
    const tone = pickTone(score)
    if (!tone) return null
    const baseClasses = `inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ring-1 ring-inset ${tone.bg} ${tone.text} ${className}`.trim()
    const content = (
        <>
            <Heart className="w-2.5 h-2.5" aria-hidden="true" />
            {Math.round(score)}
        </>
    )
    if (onClick) {
        return (
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClick() }}
                className={`${baseClasses} cursor-pointer hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
                title={`AI health score: ${score}/100 — click to see details`}
                aria-label={`AI health score ${score} out of 100`}
            >
                {content}
            </button>
        )
    }
    return (
        <span
            className={baseClasses}
            title={`AI health score: ${score}/100`}
            aria-label={`AI health score ${score} out of 100`}
        >
            {content}
        </span>
    )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "s:/Git Hub Repo Manager" && npx vitest run tests/components/AI/RepoHealthBadge`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd "s:/Git Hub Repo Manager"
git add src/components/AI/RepoHealthBadge.jsx tests/components/AI/RepoHealthBadge.test.jsx
git commit -m "feat(ai): make RepoHealthBadge clickable when onClick is provided"
```

---

### Task 4: Wire onExplainHealth from RepoList → RepoCard → Badge

**Files:**
- Modify: `src/components/RepoList/RepoCard.jsx`
- Modify: `src/components/RepoList/RepoGrid.jsx`
- Modify: `src/components/RepoList/index.jsx:139-141`

- [ ] **Step 1: Pass onExplainHealth through RepoCard to the badge**

In `src/components/RepoList/RepoCard.jsx`:

a) Add `onExplainHealth` to the destructured props (alongside `onOpenInsights`, `onOpenHealth`):

```jsx
export const RepoCard = memo(function RepoCard({
    repo,
    viewMode,
    isSelected,
    isContextTarget,
    onToggle,
    onAction,
    onContextMenu,
    onOpenInsights,
    onOpenHealth,
    onExplainHealth,
    onRepoClick,
}) {
```

b) Find every `<RepoHealthBadge ... />` render in the file (likely 1-2 sites — one for grid, one for list). For each, add the `onClick` prop:

```jsx
<RepoHealthBadge
    score={...existing}
    onClick={onExplainHealth ? () => onExplainHealth(repo) : undefined}
/>
```

The `onClick={onExplainHealth ? ... : undefined}` is critical — when no handler is provided, the badge falls back to its non-interactive `<span>` rendering (preserves existing callers that don't supply the prop).

- [ ] **Step 2: Propagate through RepoGrid**

In `src/components/RepoList/RepoGrid.jsx`:

```jsx
// Add to destructured props (line ~21):
onExplainHealth,

// In each <RepoCard ... /> render (line ~58 area), add:
onExplainHealth={(repo) => onExplainHealth?.(repo)}
```

(If RepoGrid uses a `cards.map(...)` pattern, the existing `onOpenHealth={() => onOpenHealth(repo)}` is the template — copy that for `onExplainHealth`.)

- [ ] **Step 3: Wire from RepoList**

In `src/components/RepoList/index.jsx` near line 139-141 where `onOpenInsights` and `onOpenHealth` are passed:

```jsx
<RepoGrid
    {...existingProps}
    onOpenInsights={(repo) => openModalWithData('showRepoInsights', { repo })}
    onOpenHealth={(repo) => openModalWithData('showCommunityHealth', repo)}
    onExplainHealth={(repo) => openModalWithData('showRepoInsights', { repo, initialTab: 'quality' })}
/>
```

- [ ] **Step 4: Manual smoke test (no automated test for the prop drilling — covered by the badge unit test in Task 3)**

Run: `cd "s:/Git Hub Repo Manager" && npx vitest run`
Expected: 2700+ tests still pass.

- [ ] **Step 5: Commit**

```bash
cd "s:/Git Hub Repo Manager"
git add src/components/RepoList/RepoCard.jsx src/components/RepoList/RepoGrid.jsx src/components/RepoList/index.jsx
git commit -m "feat(ai): wire RepoHealthBadge click to open Insights Quality tab"
```

---

## Slice 2.4 — Auto-tag UI in RepoDetail SettingsTab

### Task 5: Add "AI-suggested topics" section to SettingsTab

**Files:**
- Modify: `src/components/RepoDetail/SettingsTab.jsx`
- Test: `tests/components/RepoDetail/SettingsTab.aiTopics.test.jsx` (create)

- [ ] **Step 1: Inspect current SettingsTab structure**

Run: `Read src/components/RepoDetail/SettingsTab.jsx 1 60`

Identify: the component signature (what props it receives, where to insert a new `<section>`), and how it currently calls APIs (so the new section follows the same pattern).

- [ ] **Step 2: Confirm aiApi.getMetadata + topics PUT signatures**

Run: `Grep -n "getMetadata\|topicsApi\|/topics" src/api/`

Expected to confirm:
- `aiApi.getMetadata(repoId)` exists in `src/api/ai.js:177`
- A PUT-topics caller exists somewhere or needs to be added in this task using `fetch('/api/repos/:owner/:repo/topics', { method: 'PUT', body: JSON.stringify({ names }) })` with the standard CSRF + credentials pattern.

If no `setTopics` helper exists, add one at the bottom of `src/api/repos.js` (or wherever the closest module is — read first):

```js
import { getCsrfToken } from '../utils/api'
export async function setRepoTopics(owner, repo, names) {
    const token = await getCsrfToken()
    const res = await fetch(`/api/repos/${owner}/${repo}/topics`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        credentials: 'include',
        body: JSON.stringify({ names }),
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = new Error(body.error || 'Failed to update topics')
        err.status = res.status
        err.code = body.code
        throw err
    }
    return res.json()
}
```

- [ ] **Step 3: Write the failing tests**

```jsx
// tests/components/RepoDetail/SettingsTab.aiTopics.test.jsx — create
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsTab } from '@/components/RepoDetail/SettingsTab'

vi.mock('@/hooks/useAIStatus', () => ({ useAIStatus: vi.fn() }))
vi.mock('@/api/ai', () => ({
    aiApi: { getMetadata: vi.fn() },
}))
import { useAIStatus } from '@/hooks/useAIStatus'
import { aiApi } from '@/api/ai'

const baseRepo = {
    id: 42,
    name: 'r',
    full_name: 'o/r',
    owner: { login: 'o' },
    topics: ['react'],
    archived: false,
}

beforeEach(() => {
    vi.clearAllMocks()
    useAIStatus.mockReturnValue({ configured: true, loading: false })
    global.fetch = vi.fn()
})

describe('SettingsTab — AI-suggested topics', () => {
    it('renders a "Suggest topics" button initially', () => {
        render(<SettingsTab repo={baseRepo} />)
        expect(screen.getByRole('button', { name: /suggest topics/i })).toBeInTheDocument()
    })

    it('shows suggestions filtered against existing topics after Suggest click', async () => {
        aiApi.getMetadata.mockResolvedValue({
            topics: ['react', 'ui-library', 'typescript'],
            health_score: 72,
        })
        render(<SettingsTab repo={baseRepo} />)
        fireEvent.click(screen.getByRole('button', { name: /suggest topics/i }))
        await waitFor(() => {
            expect(screen.getByLabelText(/ui-library/i)).toBeInTheDocument()
            expect(screen.getByLabelText(/typescript/i)).toBeInTheDocument()
            // 'react' is already on the repo and must be filtered out
            expect(screen.queryByLabelText(/^react$/i)).not.toBeInTheDocument()
        })
    })

    it('shows the "Looks good" empty state when no new suggestions remain', async () => {
        aiApi.getMetadata.mockResolvedValue({
            topics: ['react'],
            health_score: 72,
        })
        render(<SettingsTab repo={baseRepo} />)
        fireEvent.click(screen.getByRole('button', { name: /suggest topics/i }))
        await waitFor(() => {
            expect(screen.getByText(/looks good/i)).toBeInTheDocument()
        })
    })

    it('shows the "not indexed" state when metadata returns 404', async () => {
        aiApi.getMetadata.mockRejectedValue(Object.assign(new Error('404'), { status: 404 }))
        render(<SettingsTab repo={baseRepo} />)
        fireEvent.click(screen.getByRole('button', { name: /suggest topics/i }))
        await waitFor(() => {
            expect(screen.getByText(/index this repo/i)).toBeInTheDocument()
        })
    })

    it('disables the Suggest button when AI is not configured', () => {
        useAIStatus.mockReturnValue({ configured: false, loading: false })
        render(<SettingsTab repo={baseRepo} />)
        expect(screen.getByRole('button', { name: /suggest topics/i })).toBeDisabled()
    })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd "s:/Git Hub Repo Manager" && npx vitest run tests/components/RepoDetail/SettingsTab.aiTopics`
Expected: FAIL — section doesn't exist yet.

- [ ] **Step 5: Add the section to SettingsTab.jsx**

At the top of `src/components/RepoDetail/SettingsTab.jsx`, add imports:

```jsx
import { useState } from 'react'
import { useAIStatus } from '../../hooks/useAIStatus'
import { aiApi } from '../../api/ai'
import { setRepoTopics } from '../../api/repos'   // adjust path to wherever you put it in Step 2
import { useToast } from '../../hooks/useToast'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Tag, Sparkles } from 'lucide-react'
```

Inside the component body, just before the existing JSX return, add the section state + handlers:

```jsx
const aiStatus = useAIStatus()
const aiOff = !aiStatus.loading && !aiStatus.configured
const { toast } = useToast()
const [suggestState, setSuggestState] = useState({ kind: 'idle' })
// kind: 'idle' | 'loading' | 'suggestions' | 'empty' | 'not-indexed' | 'applying'
const [selected, setSelected] = useState(new Set())

const loadSuggestions = async () => {
    setSuggestState({ kind: 'loading' })
    try {
        const meta = await aiApi.getMetadata(repo.id)
        const aiTopics = Array.isArray(meta?.topics) ? meta.topics : []
        const existing = new Set(repo.topics || [])
        const newOnes = aiTopics.filter((t) => !existing.has(t))
        if (newOnes.length === 0) {
            setSuggestState({ kind: 'empty' })
            return
        }
        setSelected(new Set())
        setSuggestState({ kind: 'suggestions', items: newOnes })
    } catch (err) {
        if (err.status === 404) {
            setSuggestState({ kind: 'not-indexed' })
            return
        }
        toast.errorFromException(err, { fallbackTitle: 'Failed to load topic suggestions' })
        setSuggestState({ kind: 'idle' })
    }
}

const toggle = (t) => {
    setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(t)) next.delete(t)
        else next.add(t)
        return next
    })
}

const apply = async () => {
    if (selected.size === 0) return
    setSuggestState((s) => ({ ...s, kind: 'applying' }))
    try {
        const union = Array.from(new Set([...(repo.topics || []), ...selected]))
        await setRepoTopics(repo.owner.login, repo.name, union)
        toast.success(`Added ${selected.size} topic${selected.size === 1 ? '' : 's'}`)
        setSuggestState({ kind: 'idle' })
        setSelected(new Set())
    } catch (err) {
        toast.errorFromException(err, { fallbackTitle: 'Failed to update topics' })
        setSuggestState((s) => ({ ...s, kind: 'suggestions' }))
    }
}
```

Inside the JSX, add the new section near the existing settings form (place it sensibly — likely above or below the danger zone):

```jsx
<section data-testid="ai-suggested-topics" className="mt-8 p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
    <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-indigo-500" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">AI-suggested topics</h3>
    </div>

    {suggestState.kind === 'idle' && (
        <>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                See what topics AI would add to this repo based on its README, language, and dependencies.
            </p>
            <Button
                onClick={loadSuggestions}
                disabled={aiOff || repo.archived}
                title={aiOff ? 'Configure AI in Settings → AI to enable suggestions' : (repo.archived ? 'Archived repos cannot be modified' : undefined)}
            >
                <Tag className="w-3.5 h-3.5" /> Suggest topics
            </Button>
        </>
    )}

    {suggestState.kind === 'loading' && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading suggestions…</p>
    )}

    {suggestState.kind === 'empty' && (
        <EmptyState
            icon={Tag}
            title="Looks good"
            description="No new topics suggested. Try re-indexing this repo if it changed recently."
        />
    )}

    {suggestState.kind === 'not-indexed' && (
        <EmptyState
            icon={Sparkles}
            title="Not indexed yet"
            description="Index this repo first to get AI-suggested topics."
        />
    )}

    {(suggestState.kind === 'suggestions' || suggestState.kind === 'applying') && (
        <>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                {suggestState.items.length} suggestion{suggestState.items.length === 1 ? '' : 's'} not already on the repo. Pick which to add.
            </p>
            <ul className="space-y-1.5 mb-3">
                {suggestState.items.map((t) => (
                    <li key={t}>
                        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={selected.has(t)}
                                onChange={() => toggle(t)}
                                aria-label={t}
                                disabled={suggestState.kind === 'applying'}
                            />
                            {t}
                        </label>
                    </li>
                ))}
            </ul>
            <Button
                onClick={apply}
                disabled={selected.size === 0 || suggestState.kind === 'applying' || repo.archived}
            >
                Add {selected.size} topic{selected.size === 1 ? '' : 's'}
            </Button>
        </>
    )}
</section>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd "s:/Git Hub Repo Manager" && npx vitest run tests/components/RepoDetail/SettingsTab.aiTopics`
Expected: PASS (5 tests).

- [ ] **Step 7: Run full unit suite**

Run: `cd "s:/Git Hub Repo Manager" && npx vitest run`
Expected: 2705+ tests pass (existing 2700 + 5 new + others added in earlier tasks).

- [ ] **Step 8: Run build honesty test**

Run: `cd "s:/Git Hub Repo Manager" && RUN_BUILD_TESTS=1 npx vitest run tests/build/`
Expected: 21+ build tests still pass — no mock data leaks introduced.

- [ ] **Step 9: Commit**

```bash
cd "s:/Git Hub Repo Manager"
git add src/components/RepoDetail/SettingsTab.jsx src/api/repos.js tests/components/RepoDetail/SettingsTab.aiTopics.test.jsx
git commit -m "feat(ai): AI-suggested topics section in RepoDetail SettingsTab"
```

(If `setRepoTopics` was added to a different file, swap `src/api/repos.js` for the actual path.)

---

### Task 6: Final push

- [ ] **Step 1: Push to origin/main**

```bash
cd "s:/Git Hub Repo Manager"
git push origin main
```

- [ ] **Step 2: Verify CI**

Watch for the CI run on the latest commit. Lint, test, and build jobs should pass. e2e is pre-existing flaky — match the baseline (~23 failures, none from this slice).

- [ ] **Step 3: Update memory**

If any non-obvious learning surfaced (e.g., useAIStatus shape gotcha, or a wiring quirk in RepoCard prop drilling), add a one-paragraph memory note. Otherwise skip.

---

## Self-review

**Spec coverage:**
- Spec Goal 1 (Commit AI fail-silent) → Task 1 ✅
- Spec Goal 2 (PR description fail-silent + verify) → Task 2 ✅
- Spec Goal 3 (RepoHealthBadge clickable + opens insights) → Tasks 3 + 4 ✅
- Spec Goal 4 (Auto-tag flow in SettingsTab) → Task 5 ✅
- Spec Goal 5 (zero new backend endpoints) → confirmed in Task 5 Step 2 (uses existing `aiApi.getMetadata` + `PUT /:owner/:repo/topics`) ✅

**Type / signature consistency:**
- `useAIStatus()` returns `{ configured, loading, ... }` — used identically in Tasks 1, 2, 5 ✅
- `aiApi.getMetadata(repoId)` returns `{ topics: array, health_score, ... }` — used in Task 5 ✅
- `setRepoTopics(owner, repo, names)` PUTs `{ names }` — defined and used in Task 5 ✅
- `RepoHealthBadge` `onClick` prop fires with no args (caller closes over `repo`) — Tasks 3 + 4 consistent ✅
- `onExplainHealth(repo)` signature — RepoList → RepoGrid → RepoCard chain consistent in Task 4 ✅

**Placeholder scan:** none. Three "Read first / Confirm in implementation" prompts in Task 5 Step 2 are intentional — they handle the case where `setRepoTopics` may already exist or may need to be added. The fallback code is provided inline.

**Risk: `useAIStatus` mock in tests.** The hook mock pattern (`vi.mock('@/hooks/useAIStatus')`) used in Tasks 1, 2, 5 must match the actual import path each component uses. If a component imports via a relative path (e.g. `'../../hooks/useAIStatus'`), the test mock should match — vitest resolves both via the `@` alias defined in vitest.config.js, so either works in tests.
