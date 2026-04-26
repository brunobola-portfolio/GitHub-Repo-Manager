# UX Uniformity & Onboarding Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sweep standalone `Loader2` spinners into `<SectionSpinner />` / `<PageSpinner />`, canonicalize one or two non-conforming modal headers, add a focus trap to the QuotaExceededState backdrop, and ship a 3-step modal-carousel onboarding tour with `localStorage` persistence.

**Architecture:** Three independent slices. Spinner sweep is mechanical replacement using existing `Spinner` primitives. Onboarding tour uses the existing `Modal` primitive (which already has `useFocusTrap`) plus a new `useOnboarding` hook that wraps localStorage. State machine is local React state in `OnboardingTour.jsx`.

**Tech Stack:** React 19, Vite, Tailwind v4, framer-motion, lucide-react, Vitest + RTL.

**Spec:** [docs/specs/2026-04-26-ux-uniformity-and-onboarding.md](../specs/2026-04-26-ux-uniformity-and-onboarding.md)

---

## File Structure

**Create:**
- `src/components/Onboarding/OnboardingTour.jsx` — 3-step modal carousel
- `src/components/Onboarding/onboardingSteps.js` — step definitions (icon + title + body)
- `src/hooks/useOnboarding.js` — localStorage wrapper + 6h re-show throttle
- `tests/components/Onboarding/OnboardingTour.test.jsx`
- `tests/hooks/useOnboarding.test.js`
- `tests/lint/no-standalone-loader2.test.js` — regression guard
- `docs/reports/2026-04-26-ux-audit.md` — dark + mobile findings doc

**Modify:**
- `~20 components` — replace standalone `<Loader2.*animate-spin />` blocks with `<SectionSpinner />` / `<PageSpinner />` / `<Spinner size="..." />` (Task 1 enumerates the procedure)
- `src/App.jsx` — wrap QuotaExceededState backdrop card in `useFocusTrap`; mount `<OnboardingTour />` + listen for `app:show-onboarding` event
- `src/components/Settings/AIConfigSection.jsx` — add small "Re-run onboarding tour" ghost button at the bottom

---

## Slice 3.1 — Spinner uniformity sweep

### Task 1: Enumerate and replace standalone Loader2 sites

**Files:**
- Modify: ~20 files in `src/components/` (procedure below enumerates each)
- Test: existing tests stay green

The sweep is mechanical. The engineer enumerates standalone sites once and applies one of three replacement templates per site.

- [ ] **Step 1: Enumerate sites with full context**

```bash
cd "s:/Git Hub Repo Manager"
mkdir -p .dev
grep -rn -B 2 -A 1 'Loader2.*animate-spin' src/components/ \
  | grep -v 'ui/Spinner.jsx' \
  > .dev/spinner-sites.txt
wc -l .dev/spinner-sites.txt
```

Expected: ~75 occurrences (matches the spec's audit count).

- [ ] **Step 2: Categorize each site**

For each `<Loader2 ... animate-spin ... />` occurrence, determine its category by reading 5-10 lines of context:

- **Category A (button-internal, idiomatic):** the Loader2 is inside a `<button>`, `<Button>`, or `<motion.button>` element — usually a conditional `{loading ? <Loader2 ... /> : <SaveIcon />}` ternary, or a leading icon when `loading=true`. **Skip** these. They're idiomatic.
- **Category B (full-section/page placeholder):** the Loader2 is wrapped in a `<div className="flex flex-col items-center justify-center py-N gap-N">` (or similar) that takes the entire content area while data loads. **Replace** the whole wrapper with `<SectionSpinner label="..." />`.
- **Category C (status indicator inline):** the Loader2 sits next to a small text label ("Saving…", "Indexing…", "Validating…") inside a card or status pill that is NOT the primary loading screen — it's an in-place status. **Replace** the bare `<Loader2 ... animate-spin />` with `<Spinner size="xs|sm" />` (preserve the surrounding layout exactly).

If a site doesn't fit any category, classify it Category B (full-section) and use SectionSpinner — the visual contract matches.

- [ ] **Step 3: Apply Category B replacements (full-section)**

Pattern to find: a `<div className="flex flex-col items-center justify-center py-N gap-N">` (or similar) wrapper containing only the Loader2 + an optional helper paragraph.

For each match:

```jsx
// Before
<div className="flex flex-col items-center justify-center py-12 gap-3">
    <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
    <p className="text-sm text-slate-600 dark:text-slate-400">Finding similar repos…</p>
</div>

// After
import { SectionSpinner } from '../ui/Spinner'   // adjust path
// ...
<SectionSpinner label="Finding similar repos…" />
```

If the existing wrapper has `min-h-[60vh]` (or `h-screen`, `min-h-screen`), use `<PageSpinner label="..." />` instead — it produces a viewport-tall centered spinner.

If the existing wrapper has no helper paragraph (just the spinner alone), use `<SectionSpinner padding="py-N" />` matching the existing padding so the surrounding layout doesn't shift.

Files most likely affected (from the audit):
- `src/components/AI/CompareSimilarDrawer.jsx`
- `src/components/AI/RepoInsightsModal.jsx`
- `src/components/AI/CompareDiffModal.jsx`
- `src/components/AI/ReadmeEnhanceDiffPanel.jsx`
- `src/components/AI/BatchIndexProgressModal.jsx`
- `src/components/CodeownersSuggestModal.jsx` (line ~155)
- `src/components/Dashboard/MigrationActivity.jsx`
- `src/components/Dashboard/OrganizationSelector.jsx`
- `src/components/MigrationHistory.jsx`
- `src/components/RepoDetail/ActionsTab.jsx`
- `src/components/RepoDetail/AIIssuePlanner.jsx`
- `src/components/RepoDetail/OverviewTab.jsx`
- `src/components/RepoDetail/RepoDetail.jsx`
- `src/components/Settings/UsageDashboard.jsx`
- `src/components/Settings/AIConfig/TestButton.jsx`
- `src/components/Setup/SystemSetup.jsx`
- `src/components/Sidebar.jsx`
- `src/components/Admin/AdminDLQPage.jsx`
- `src/components/Admin/DLQDetailPanel.jsx`
- `src/components/MigrationWizard/steps/AIReview/AnalysisLoadingState.jsx`
- `src/components/PRReview/AIInsights/AISummaryPanel.jsx`
- `src/components/RepoList/RepoFilterBar.jsx`
- `src/components/WorkBoard/InlineActions.jsx`
- `src/components/WorkBoard/EmptyStateDiscovery.jsx`
- `src/components/WorkBoard/tabs/StalePRsTab.jsx`
- `src/components/WorkBoard/tabs/MyReviewsTab.jsx`

Open each, find the standalone Loader2, apply the replacement template. Do NOT touch button-internal Loader2 (Category A).

- [ ] **Step 4: Apply Category C replacements (inline status)**

Pattern to find: `<Loader2 className="w-X h-X animate-spin" />` next to text inside a card/pill (not a button, not a full-section spinner).

```jsx
// Before
<div className="inline-flex items-center gap-2 text-sm text-slate-500">
    <Loader2 className="w-3.5 h-3.5 animate-spin" />
    Indexing…
</div>

// After
import { Spinner } from '../ui/Spinner'   // adjust path
// ...
<div className="inline-flex items-center gap-2 text-sm text-slate-500">
    <Spinner size="sm" tone="muted" />
    Indexing…
</div>
```

The visual is equivalent. The benefit is consistent role + aria-label (Spinner sets `role="status" aria-label="Loading"` automatically).

- [ ] **Step 5: Run the suite to confirm no regression**

```bash
cd "s:/Git Hub Repo Manager"
npx vitest run
```

Expected: ≥ 2712 tests pass. Visual changes should not affect test logic.

- [ ] **Step 6: Write the regression-guard test**

```js
// tests/lint/no-standalone-loader2.test.js
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// Sites that legitimately use a raw Loader2 outside of a button.
// Add an entry only with a comment explaining the exception.
const ALLOWED = new Set([
    'src/components/ui/Spinner.jsx',           // the source primitive itself
])

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry)
        const st = statSync(p)
        if (st.isDirectory()) yield* walk(p)
        else if (p.endsWith('.jsx') || p.endsWith('.js')) yield p
    }
}

describe('no standalone Loader2 outside buttons', () => {
    it('every <Loader2 ... animate-spin> in src/components/ is inside a button or in the allow-list', () => {
        const offenders = []
        for (const file of walk('src/components')) {
            const rel = file.replace(/\\/g, '/')
            if (ALLOWED.has(rel)) continue
            const content = readFileSync(file, 'utf8')
            // Match <Loader2 ... animate-spin> on a single logical line.
            // Approximation: find each occurrence and check 200 chars of preceding
            // context for an enclosing <button or <Button or <motion.button.
            const re = /<Loader2[^>]*animate-spin[^>]*\/?>/g
            let m
            while ((m = re.exec(content))) {
                const before = content.slice(Math.max(0, m.index - 400), m.index)
                const inButton = /<(button|Button|motion\.button)[^>]*>(?:(?!<\/(button|Button|motion\.button)>).)*$/s.test(before)
                if (!inButton) offenders.push(`${rel}: index ${m.index}`)
            }
        }
        expect(offenders, `Found standalone Loader2 outside buttons:\n${offenders.join('\n')}`).toEqual([])
    })
})
```

- [ ] **Step 7: Run the regression test**

```bash
cd "s:/Git Hub Repo Manager"
npx vitest run tests/lint/no-standalone-loader2
```

Expected: PASS. If any offenders surface, the engineer either replaces them per Step 3/4 or — only with justification — adds them to the `ALLOWED` set with a comment.

- [ ] **Step 8: Commit**

```bash
cd "s:/Git Hub Repo Manager"
git add src/components tests/lint/no-standalone-loader2.test.js
git commit -m "refactor(ui): sweep standalone Loader2 into Spinner / SectionSpinner / PageSpinner"
```

---

## Slice 3.2 — Modal-header canonicalization + a11y patches + UX audit doc

### Task 2: Wrap QuotaExceededState backdrop with focus trap

**Files:**
- Modify: `src/App.jsx` (the QuotaExceededState backdrop block added in slice 1)

- [ ] **Step 1: Locate the backdrop block**

```bash
cd "s:/Git Hub Repo Manager"
grep -n 'quota-exceeded\|QuotaExceededState' src/App.jsx
```

Find the JSX block conditioned on `{quotaModal && (...)}` — the outer `<div role="dialog" aria-modal="true" ... onClick={...} onKeyDown={...}>` and the inner `<div onClick={(e) => e.stopPropagation()}>` containing `<QuotaExceededState />`.

- [ ] **Step 2: Apply useFocusTrap to the inner card**

In `src/App.jsx`, near the other hook imports:

```jsx
import { useFocusTrap } from './hooks/useFocusTrap'
```

Inside the App component body, near the existing `quotaModal` state:

```jsx
const quotaCardRef = useFocusTrap(!!quotaModal, () => setQuotaModal(null))
```

Then update the inner div in the JSX block to attach the ref:

```jsx
{/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
<div
    role="dialog"
    aria-modal="true"
    aria-label="Quota exceeded"
    tabIndex={-1}
    className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
    onClick={() => setQuotaModal(null)}
    onKeyDown={(e) => { if (e.key === 'Escape') setQuotaModal(null) }}
>
    <div ref={quotaCardRef} onClick={(e) => e.stopPropagation()}>
        <Suspense fallback={null}>
            <QuotaExceededState
                feature={quotaModal.feature || 'AI'}
                currentTier={quotaModal.tier || quotaModal.currentTier}
                used={quotaModal.used}
                limit={quotaModal.limit}
                resetAt={quotaModal.resetAt}
                upgradeTo={quotaModal.upgradeTo}
                onClose={() => setQuotaModal(null)}
            />
        </Suspense>
    </div>
</div>
/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
```

- [ ] **Step 3: Run lint to confirm no warnings**

```bash
cd "s:/Git Hub Repo Manager"
npx eslint src/App.jsx
```

Expected: no errors (existing warnings unchanged).

- [ ] **Step 4: Run the suite**

```bash
npx vitest run
```

Expected: still green.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(a11y): focus trap on QuotaExceededState backdrop"
```

---

### Task 3: Modal-header audit + UX audit doc

**Files:**
- Modify: 0-2 modals (most modals already use the Modal primitive's title slot which is canonical)
- Create: `docs/reports/2026-04-26-ux-audit.md`

- [ ] **Step 1: Run the audit grep**

```bash
cd "s:/Git Hub Repo Manager"
grep -rln 'isOpen.*onClose' src/components --include='*.jsx' \
  | xargs -n1 grep -l '<h1\|<h2[^>]*text-xl\|<h2[^>]*text-2xl' 2>/dev/null \
  | grep -v 'PageHeader.jsx' \
  > .dev/modal-header-candidates.txt
cat .dev/modal-header-candidates.txt
```

This produces a candidate list of files containing both an `isOpen/onClose` pattern (likely a modal) AND a hand-rolled h1/h2 header with explicit text size. Most matches will be false positives (the hand-rolled h2 belongs to a section inside the modal, not the modal's header itself).

- [ ] **Step 2: For each candidate, read the file and confirm**

For each file in the list, open it and check whether the modal's TOP-LEVEL header (the title that visually identifies the modal) is hand-rolled or uses Modal's `title`/`description` props.

- If the modal already passes `title=` / `description=` to the `Modal` primitive: **skip** (already canonical).
- If the modal hand-rolls a `<header>` with `<h2 className="text-xl/2xl ...">`: **migrate** to use `<PageHeader />` inside the body, OR move the hand-rolled header to the Modal `title` slot.

Realistic expected outcome: 0-2 actual migrations. Most modals in this codebase already use the Modal primitive's title slot.

- [ ] **Step 3: Apply migrations (if any)**

If a migration is needed:

```jsx
// Before (hand-rolled)
<Modal isOpen={open} onClose={close}>
    <div className="px-6 py-4 border-b">
        <h2 className="text-xl font-bold">Some Title</h2>
        <p className="text-sm text-slate-500">Some description</p>
    </div>
    <div className="px-6 py-4">{/* body */}</div>
</Modal>

// After (canonical)
<Modal isOpen={open} onClose={close} title="Some Title" description="Some description">
    {/* body */}
</Modal>
```

If the Modal primitive doesn't yet support a `description` prop the way the example shows, fall back to using `<PageHeader />` inside the modal body:

```jsx
<Modal isOpen={open} onClose={close}>
    <PageHeader title="Some Title" description="Some description" />
    {/* body */}
</Modal>
```

- [ ] **Step 4: Write the UX audit doc**

Manual visual smoke against four surfaces. Open the app at `npm run dev` (or against deployed) and navigate to each:

```bash
mkdir -p docs/reports
```

Create `docs/reports/2026-04-26-ux-audit.md`:

```markdown
# UX Audit — Dark Mode + Mobile Smoke (2026-04-26)

Surfaces audited at desktop (1920×1080) and mobile (390×844), in light and dark modes.

## ProbeStatsSection (Settings → AI → Probe stats)

- **Light desktop:** ✅ pass
- **Dark desktop:** ✅ pass
- **Light mobile:** ✅ pass
- **Dark mobile:** ✅ pass

### Findings
- (Add bullet here for each finding, e.g. "[ ] Stat tile gradient washes out in dark — low")

## NotificationsDropdown (Header bell)

- **Light desktop:** ✅ pass
- **Dark desktop:** ✅ pass
- **Light mobile:** ✅ pass
- **Dark mobile:** ✅ pass

### Findings
- (...)

## Cmd+K Ask mode (Command palette ?-prefix)

- **Light desktop:** ✅ pass
- **Dark desktop:** ✅ pass
- **Light mobile:** ✅ pass
- **Dark mobile:** ✅ pass

### Findings
- (...)

## AttentionFeed top-3 narratives (Header digest)

- **Light desktop:** ✅ pass
- **Dark desktop:** ✅ pass
- **Light mobile:** ✅ pass
- **Dark mobile:** ✅ pass

### Findings
- (...)
```

The doc starts with all-green and the engineer fills in real findings during smoke. 1-line fixes get committed in this slice; bigger findings link to follow-up issues.

- [ ] **Step 5: Commit**

```bash
git add docs/reports/2026-04-26-ux-audit.md src/components/  # any modal migration files
git commit -m "docs(ux): UX audit + modal header canonicalization sweep"
```

---

## Slice 3.3 — Onboarding tour

### Task 4: useOnboarding hook with localStorage

**Files:**
- Create: `src/hooks/useOnboarding.js`
- Test: `tests/hooks/useOnboarding.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/hooks/useOnboarding.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const STORAGE = (() => {
    let store = {}
    return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v) },
        removeItem: (k) => { delete store[k] },
        clear: () => { store = {} },
    }
})()

beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { value: STORAGE, writable: true })
    STORAGE.clear()
})

afterEach(() => { vi.useRealTimers() })

describe('useOnboarding', () => {
    it('returns shouldShow=true when no completedAt is stored', async () => {
        const { useOnboarding } = await import('@/hooks/useOnboarding')
        const { result } = renderHook(() => useOnboarding())
        expect(result.current.shouldShow).toBe(true)
    })

    it('returns shouldShow=false when completedAt is stored', async () => {
        STORAGE.setItem('grm.onboarding.completedAt', new Date().toISOString())
        const { useOnboarding } = await import('@/hooks/useOnboarding')
        const { result } = renderHook(() => useOnboarding())
        expect(result.current.shouldShow).toBe(false)
    })

    it('markComplete writes completedAt to localStorage', async () => {
        const { useOnboarding } = await import('@/hooks/useOnboarding')
        const { result } = renderHook(() => useOnboarding())
        act(() => result.current.markComplete())
        expect(STORAGE.getItem('grm.onboarding.completedAt')).toMatch(/^\d{4}-\d{2}-\d{2}/)
    })

    it('reset clears both keys', async () => {
        STORAGE.setItem('grm.onboarding.completedAt', '2026-01-01T00:00:00Z')
        STORAGE.setItem('grm.onboarding.lastSeenAt', '2026-04-01T00:00:00Z')
        const { useOnboarding } = await import('@/hooks/useOnboarding')
        const { result } = renderHook(() => useOnboarding())
        act(() => result.current.reset())
        expect(STORAGE.getItem('grm.onboarding.completedAt')).toBeNull()
        expect(STORAGE.getItem('grm.onboarding.lastSeenAt')).toBeNull()
    })

    it('throttles re-show when lastSeenAt is within 6 hours', async () => {
        const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
        STORAGE.setItem('grm.onboarding.lastSeenAt', recent)
        const { useOnboarding } = await import('@/hooks/useOnboarding')
        const { result } = renderHook(() => useOnboarding())
        expect(result.current.shouldShow).toBe(false)
    })

    it('does not throttle when lastSeenAt is older than 6 hours', async () => {
        const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString()
        STORAGE.setItem('grm.onboarding.lastSeenAt', old)
        const { useOnboarding } = await import('@/hooks/useOnboarding')
        const { result } = renderHook(() => useOnboarding())
        expect(result.current.shouldShow).toBe(true)
    })

    it('falls back gracefully when localStorage throws', async () => {
        const broken = {
            getItem: () => { throw new Error('no storage') },
            setItem: () => { throw new Error('no storage') },
            removeItem: () => { throw new Error('no storage') },
        }
        Object.defineProperty(window, 'localStorage', { value: broken, writable: true })
        const { useOnboarding } = await import('@/hooks/useOnboarding')
        const { result } = renderHook(() => useOnboarding())
        expect(result.current.shouldShow).toBe(true)   // safe default
        expect(() => act(() => result.current.markComplete())).not.toThrow()
    })
})
```

- [ ] **Step 2: Verify tests fail**

```bash
cd "s:/Git Hub Repo Manager"
npx vitest run tests/hooks/useOnboarding
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the hook**

```js
// src/hooks/useOnboarding.js
import { useEffect, useState, useCallback } from 'react'

const COMPLETED_KEY = 'grm.onboarding.completedAt'
const LAST_SEEN_KEY = 'grm.onboarding.lastSeenAt'
const RESHOW_THROTTLE_MS = 6 * 60 * 60 * 1000   // 6 hours

function safeGet(key) {
    try { return window.localStorage.getItem(key) } catch { return null }
}

function safeSet(key, value) {
    try { window.localStorage.setItem(key, value) } catch { /* fail silent */ }
}

function safeRemove(key) {
    try { window.localStorage.removeItem(key) } catch { /* fail silent */ }
}

function computeShouldShow() {
    const completed = safeGet(COMPLETED_KEY)
    if (completed) return false
    const lastSeen = safeGet(LAST_SEEN_KEY)
    if (lastSeen) {
        const ts = new Date(lastSeen).getTime()
        if (!Number.isNaN(ts) && Date.now() - ts < RESHOW_THROTTLE_MS) return false
    }
    return true
}

/**
 * useOnboarding — flag + helpers for the first-run tour.
 *
 * The hook reads localStorage once on mount; consumers re-render only when
 * markComplete / markSeen / reset are called. Storage failures (private
 * mode, etc.) degrade gracefully to "always show this session" without
 * throwing.
 */
export function useOnboarding() {
    const [shouldShow, setShouldShow] = useState(false)

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShouldShow(computeShouldShow())
    }, [])

    const markComplete = useCallback(() => {
        safeSet(COMPLETED_KEY, new Date().toISOString())
        setShouldShow(false)
    }, [])

    const markSeen = useCallback(() => {
        safeSet(LAST_SEEN_KEY, new Date().toISOString())
        setShouldShow(false)
    }, [])

    const reset = useCallback(() => {
        safeRemove(COMPLETED_KEY)
        safeRemove(LAST_SEEN_KEY)
        setShouldShow(true)
    }, [])

    return { shouldShow, markComplete, markSeen, reset }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/hooks/useOnboarding
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useOnboarding.js tests/hooks/useOnboarding.test.js
git commit -m "feat(onboarding): useOnboarding hook with localStorage + 6h throttle"
```

---

### Task 5: Onboarding step definitions

**Files:**
- Create: `src/components/Onboarding/onboardingSteps.js`

- [ ] **Step 1: Create the steps file**

```js
// src/components/Onboarding/onboardingSteps.js
import { Search, Sparkles, Layers } from 'lucide-react'

export const ONBOARDING_STEPS = [
    {
        id: 'cmdk',
        icon: Search,
        title: 'Press Cmd+K from anywhere',
        body: 'The command palette finds repos, opens settings, and runs AI searches. Try it now or later.',
        gradient: 'from-indigo-500 to-purple-600',
    },
    {
        id: 'ai-config',
        icon: Sparkles,
        title: 'Add your AI key in Settings → AI',
        body: 'Power semantic search, README enhance, commit AI, and topic suggestions with your own Gemini key. Free tier works without it but most AI features need a key.',
        gradient: 'from-amber-500 to-rose-500',
    },
    {
        id: 'work-board',
        icon: Layers,
        title: 'Cross-repo Work Board',
        body: 'One inbox for all your reviews, stale PRs, and DORA metrics across every repo you track. Open from the sidebar.',
        gradient: 'from-emerald-500 to-cyan-500',
    },
]
```

- [ ] **Step 2: Commit**

```bash
mkdir -p src/components/Onboarding
git add src/components/Onboarding/onboardingSteps.js
git commit -m "feat(onboarding): step content for the 3-step tour"
```

---

### Task 6: OnboardingTour component

**Files:**
- Create: `src/components/Onboarding/OnboardingTour.jsx`
- Test: `tests/components/Onboarding/OnboardingTour.test.jsx`

- [ ] **Step 1: Write failing tests**

```jsx
// tests/components/Onboarding/OnboardingTour.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OnboardingTour } from '@/components/Onboarding/OnboardingTour'

const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    onNeverShow: vi.fn(),
}

beforeEach(() => { vi.clearAllMocks() })

describe('OnboardingTour', () => {
    it('renders nothing when isOpen is false', () => {
        const { container } = render(<OnboardingTour {...baseProps} isOpen={false} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders the first step on mount', () => {
        render(<OnboardingTour {...baseProps} />)
        expect(screen.getByText(/Press Cmd\+K/i)).toBeInTheDocument()
        expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument()
    })

    it('Next advances the step', () => {
        render(<OnboardingTour {...baseProps} />)
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        expect(screen.getByText(/AI key in Settings/i)).toBeInTheDocument()
        expect(screen.getByText(/Step 2 of 3/i)).toBeInTheDocument()
    })

    it('Back goes to the previous step', () => {
        render(<OnboardingTour {...baseProps} />)
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        fireEvent.click(screen.getByRole('button', { name: /back/i }))
        expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument()
    })

    it('Skip calls onNeverShow and onClose', () => {
        render(<OnboardingTour {...baseProps} />)
        fireEvent.click(screen.getByRole('button', { name: /skip/i }))
        expect(baseProps.onNeverShow).toHaveBeenCalledTimes(1)
        expect(baseProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('Got it on the final step calls onNeverShow and onClose', () => {
        render(<OnboardingTour {...baseProps} />)
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        fireEvent.click(screen.getByRole('button', { name: /next/i }))
        const gotIt = screen.getByRole('button', { name: /got it/i })
        fireEvent.click(gotIt)
        expect(baseProps.onNeverShow).toHaveBeenCalledTimes(1)
        expect(baseProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('exposes role=dialog with aria-modal', () => {
        render(<OnboardingTour {...baseProps} />)
        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('announces the active step via aria-live', () => {
        render(<OnboardingTour {...baseProps} />)
        const live = screen.getByText(/Press Cmd\+K/i).closest('[aria-live]')
        expect(live).toHaveAttribute('aria-live', 'polite')
    })
})
```

- [ ] **Step 2: Verify failing**

```bash
npx vitest run tests/components/Onboarding/OnboardingTour
```

Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement OnboardingTour.jsx**

```jsx
// src/components/Onboarding/OnboardingTour.jsx
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { ONBOARDING_STEPS } from './onboardingSteps'

export function OnboardingTour({ isOpen, onClose, onNeverShow }) {
    const [stepIndex, setStepIndex] = useState(0)
    const dialogRef = useFocusTrap(isOpen, onClose)

    useEffect(() => {
        if (isOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setStepIndex(0)
        }
    }, [isOpen])

    useEffect(() => {
        if (!isOpen) return
        const onKey = (e) => {
            if (e.key === 'ArrowRight') {
                setStepIndex((i) => Math.min(ONBOARDING_STEPS.length - 1, i + 1))
            } else if (e.key === 'ArrowLeft') {
                setStepIndex((i) => Math.max(0, i - 1))
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [isOpen])

    if (!isOpen) return null

    const step = ONBOARDING_STEPS[stepIndex]
    const isFirst = stepIndex === 0
    const isLast = stepIndex === ONBOARDING_STEPS.length - 1
    const Icon = step.icon

    const handleSkip = () => {
        onNeverShow?.()
        onClose?.()
    }
    const handleComplete = () => {
        onNeverShow?.()
        onClose?.()
    }

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Welcome tour"
            className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
            onClick={onClose}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose?.() }}
        >
            <motion.div
                ref={dialogRef}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                onClick={(e) => e.stopPropagation()}
                className="ds-card-shimmer w-full max-w-lg p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
            >
                <div className="flex justify-between items-start mb-6">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        Step {stepIndex + 1} of {ONBOARDING_STEPS.length}
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close tour"
                        className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <AnimatePresence mode="wait">
                    <motion.div
                        key={step.id}
                        initial={{ opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -12 }}
                        transition={{ duration: 0.2 }}
                        aria-live="polite"
                        className="text-center"
                    >
                        <div className={`w-16 h-16 mb-5 mx-auto rounded-2xl bg-gradient-to-br ${step.gradient} flex items-center justify-center`}>
                            <Icon className="w-8 h-8 text-white" strokeWidth={2.5} />
                        </div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{step.title}</h2>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{step.body}</p>
                    </motion.div>
                </AnimatePresence>

                <div className="mt-8 flex items-center justify-between gap-3">
                    <button
                        type="button"
                        onClick={handleSkip}
                        className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                        Skip tour
                    </button>
                    <div className="flex items-center gap-2">
                        {!isFirst && (
                            <button
                                type="button"
                                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                                className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
                            >
                                <ArrowLeft className="w-4 h-4" /> Back
                            </button>
                        )}
                        {!isLast && (
                            <button
                                type="button"
                                onClick={() => setStepIndex((i) => Math.min(ONBOARDING_STEPS.length - 1, i + 1))}
                                className="inline-flex items-center gap-1 px-4 py-2 text-sm font-semibold rounded-lg text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
                            >
                                Next <ArrowRight className="w-4 h-4" />
                            </button>
                        )}
                        {isLast && (
                            <button
                                type="button"
                                onClick={handleComplete}
                                className="inline-flex items-center gap-1 px-4 py-2 text-sm font-semibold rounded-lg text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
                            >
                                Got it
                            </button>
                        )}
                    </div>
                </div>
            </motion.div>
        </div>
    )
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/components/Onboarding/OnboardingTour
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Onboarding/OnboardingTour.jsx tests/components/Onboarding
git commit -m "feat(onboarding): OnboardingTour component (3-step modal carousel)"
```

---

### Task 7: Wire OnboardingTour in App.jsx + Settings re-run button

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/Settings/AIConfigSection.jsx`

- [ ] **Step 1: Mount the tour in App.jsx**

In `src/App.jsx`, near the other hook imports:

```jsx
import { useOnboarding } from './hooks/useOnboarding'
import { OnboardingTour } from './components/Onboarding/OnboardingTour'
```

Inside the App component body, near the other state hooks:

```jsx
const onboarding = useOnboarding()
const [tourOpen, setTourOpen] = useState(false)

useEffect(() => {
    if (onboarding.shouldShow) {
        const t = setTimeout(() => setTourOpen(true), 1500)
        return () => clearTimeout(t)
    }
}, [onboarding.shouldShow])

useEffect(() => {
    const handler = () => setTourOpen(true)
    window.addEventListener('app:show-onboarding', handler)
    return () => window.removeEventListener('app:show-onboarding', handler)
}, [])
```

In the JSX, mount the tour next to the QuotaExceededState backdrop block:

```jsx
<OnboardingTour
    isOpen={tourOpen}
    onClose={() => { onboarding.markSeen(); setTourOpen(false) }}
    onNeverShow={() => onboarding.markComplete()}
/>
```

- [ ] **Step 2: Add the "Re-run onboarding tour" button to AIConfigSection**

In `src/components/Settings/AIConfigSection.jsx`, near the bottom of the section (just before the closing tag of the outer container, after any existing buttons):

```jsx
import { Button } from '../ui/Button'   // adjust path; only add if not already imported

// ... inside the component JSX, near the end:
<div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
    <Button
        variant="ghost"
        onClick={() => {
            try { window.localStorage.removeItem('grm.onboarding.completedAt') } catch { /* noop */ }
            try { window.localStorage.removeItem('grm.onboarding.lastSeenAt') } catch { /* noop */ }
            window.dispatchEvent(new CustomEvent('app:show-onboarding'))
        }}
    >
        Re-run onboarding tour
    </Button>
</div>
```

Read the file first to find the exact placement that doesn't disrupt the existing layout. If AIConfigSection looks too crowded, place the button in `src/components/Settings/DangerZoneSection.jsx` instead — there's usually room in the danger zone for "destructive-ish" toggles.

- [ ] **Step 3: Run the full suite**

```bash
npx vitest run
```

Expected: ≥ 2730 tests pass (current baseline + 7 useOnboarding + 8 OnboardingTour).

- [ ] **Step 4: Run build honesty test**

```bash
RUN_BUILD_TESTS=1 npx vitest run tests/build/
```

Expected: 21+ build tests pass — no mock data introduced.

- [ ] **Step 5: Commit and push**

```bash
git add src/App.jsx src/components/Settings/AIConfigSection.jsx
git commit -m "feat(onboarding): mount OnboardingTour in App + re-run button in Settings"
git push origin main
```

- [ ] **Step 6: Manual smoke**

```bash
# Open the app, clear localStorage, refresh.
# Expected: tour appears after ~1.5s. Navigate steps. Skip / complete.
# Visit Settings → AI Configuration → click "Re-run onboarding tour".
# Expected: tour reopens.
```

---

## Self-review

**Spec coverage:**
- Spec Goal 1 (spinner uniformity) → Task 1 + lint regression test ✅
- Spec Goal 2 (modal-header canonicalization) → Task 3 ✅
- Spec Goal 3 (a11y closeout for new overlays — QuotaExceededState focus trap + new tour) → Task 2 + Task 6 (tour uses useFocusTrap) ✅
- Spec Goal 4 (onboarding tour) → Tasks 4-7 ✅
- Spec Goal 5 (dark + mobile findings doc) → Task 3 Step 4 ✅

**Type / signature consistency:**
- `useOnboarding` returns `{ shouldShow, markComplete, markSeen, reset }` — used identically in Tasks 4 and 7 ✅
- `OnboardingTour` props `{ isOpen, onClose, onNeverShow }` — defined in Task 6, consumed in Task 7 ✅
- `ONBOARDING_STEPS[i]` shape `{ id, icon, title, body, gradient }` — defined in Task 5, consumed in Task 6 ✅
- localStorage keys (`grm.onboarding.completedAt`, `grm.onboarding.lastSeenAt`) — used identically in Tasks 4 and 7 ✅

**Placeholder scan:** none. The two file-list approximations (Task 1 file list, Task 3 candidate list) are intentional — the engineer enumerates by running the supplied grep command, then applies one of three fully-specified replacement templates.

**Risk: `setStepIndex(0)` inside an effect** in Task 6 step 3 will trigger `react-hooks/set-state-in-effect`. Pre-emptively suppressed with the comment matching the codebase's existing pattern.

**Risk: AIConfigSection might already use a Button import path** different from what Task 7 step 2 assumes — read first, adapt the import.
