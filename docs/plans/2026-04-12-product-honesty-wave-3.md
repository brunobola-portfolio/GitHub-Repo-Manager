# Product Honesty Pass — Wave 3: UI Polish & Parity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the dormant `ds-*` design system across the codebase, upgrade `Skeleton` and `Card` primitives, replace text-only empty states with the `<EmptyState />` component, add GitHub Actions tab + Insights entry point to RepoDetail, redesign Pricing Page without "Coming Soon" labels, introduce a new Roadmap page, and rewrite README.md + ROADMAP.md for honesty.

**Architecture:** Most of this wave is surgical application of existing infrastructure — the `ds-*` classes, `<EmptyState />`, `<Skeleton />`, `<Card />`, and the pre-existing repo-scoped Actions endpoints at [server/routes/repos.js:1126-1206](../../server/routes/repos.js#L1126-L1206). No new backend code. The new Roadmap page is a pure React component with static content (feature lists by phase).

**Tech Stack:** React 19, Tailwind v4, Framer Motion, Vitest, Playwright, `ds-*` design system from `src/design-system.css`.

**Source spec:** [docs/specs/2026-04-11-product-honesty-pass.md](../specs/2026-04-11-product-honesty-pass.md)

**Depends on:** Wave 1 removes orphan components (`ProgressBar.jsx`, `WelcomeHero.jsx`) which could otherwise collide with this wave's sweeps. Wave 2 introduces the `<SidePanel />` primitive used for Compare drawer — not required here. Recommended order: Wave 1 → Wave 3 → Wave 2.

---

## File Structure

### New files
- `src/components/RepoDetail/ActionsTab.jsx` — new tab consuming existing repo Actions endpoints
- `src/components/Roadmap/RoadmapPage.jsx` — Now / Next / Later timeline
- `src/components/Roadmap/RoadmapStage.jsx` — one stage card group
- `src/components/Roadmap/RoadmapItem.jsx` — single feature card
- `src/api/repo-actions.js` — frontend API module for Actions endpoints
- `tests/components/ui/Skeleton.test.jsx`
- `tests/components/ui/Card.test.jsx`
- `tests/components/Roadmap/RoadmapPage.test.jsx`

### Modified files
- `src/components/ui/Skeleton.jsx` — replace `animate-pulse` with `ds-skeleton` + variants
- `src/components/ui/Card.jsx` — implement `hover` prop with `ds-hover-lift` + Framer Motion
- `src/components/ui/EmptyState.jsx` — verify `ds-animate-scale-in` on icon (add if missing)
- `src/components/ui/Button.jsx` — add `ds-btn-shimmer` to `variants.primary`, `ds-focus-ring`
- `src/design-system.css` — add `--ds-transition-standard` CSS custom properties
- `src/components/RepoDetail/RepoDetail.jsx` — add Actions tab to TABS array
- `src/components/RepoDetail/OverviewTab.jsx` — EmptyState for missing README, "View AI Insights" button
- `src/components/RepoDetail/IssuesTab.jsx` — EmptyState for empty list
- `src/components/RepoDetail/BranchesTab.jsx` — EmptyState for empty list
- `src/components/RepoDetail/ReleasesTab.jsx` — EmptyState for empty list
- `src/components/RepoDetail/PullRequestsTab.jsx` — EmptyState for empty list
- `src/components/Pricing/PricingPage.jsx` — new tier matrix, remove "Coming Soon", link to Roadmap
- `src/App.jsx` — add `/roadmap` route
- `README.md` — rewrite features/roadmap sections for honesty
- `ROADMAP.md` — rewrite as thin mirror of Roadmap page content

### New test files
- `e2e/ui-polish-wave-3.spec.js`

---

## Task 1: Upgrade `Skeleton.jsx` to use `ds-skeleton`

**Files:**
- Modify: `src/components/ui/Skeleton.jsx`
- Create: `tests/components/ui/Skeleton.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/ui/Skeleton.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Skeleton } from '../../../src/components/ui/Skeleton'

describe('Skeleton', () => {
  it('applies ds-skeleton class', () => {
    render(<Skeleton data-testid="sk" />)
    const el = screen.getByTestId('sk')
    expect(el.className).toContain('ds-skeleton')
  })

  it('supports text variant with a default height', () => {
    render(<Skeleton variant="text" data-testid="sk" />)
    expect(screen.getByTestId('sk').className).toMatch(/h-4|h-3/)
  })

  it('has role="status" and aria-busy="true"', () => {
    render(<Skeleton data-testid="sk" />)
    expect(screen.getByTestId('sk').getAttribute('role')).toBe('status')
    expect(screen.getByTestId('sk').getAttribute('aria-busy')).toBe('true')
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx vitest run tests/components/ui/Skeleton.test.jsx`
Expected: FAIL — old Skeleton does not include `ds-skeleton`.

- [ ] **Step 3: Rewrite `Skeleton.jsx`**

Replace the contents of `src/components/ui/Skeleton.jsx` with:

```jsx
const VARIANT_CLASSES = {
  text: 'h-4 rounded',
  title: 'h-6 rounded-md',
  avatar: 'rounded-full',
  card: 'rounded-xl',
  button: 'h-10 rounded-lg'
}

export function Skeleton({ variant = 'text', className = '', ...rest }) {
  const variantClass = VARIANT_CLASSES[variant] || VARIANT_CLASSES.text
  return (
    <div
      className={`ds-skeleton ${variantClass} ${className}`}
      role="status"
      aria-busy="true"
      aria-label="Loading"
      {...rest}
    />
  )
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run tests/components/ui/Skeleton.test.jsx`
Expected: PASS all three cases.

- [ ] **Step 5: Run the full test suite to catch consumer regressions**

Run: `npx vitest run`
Expected: No new failures caused by the Skeleton change.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/Skeleton.jsx tests/components/ui/Skeleton.test.jsx
git commit -m "refactor(ui): upgrade Skeleton to ds-skeleton shimmer with variants"
```

---

## Task 2: Implement `Card` hover prop

**Files:**
- Modify: `src/components/ui/Card.jsx`
- Create: `tests/components/ui/Card.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/ui/Card.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card } from '../../../src/components/ui/Card'

describe('Card', () => {
  it('applies ds-hover-lift when hover=true', () => {
    render(<Card hover data-testid="c">x</Card>)
    expect(screen.getByTestId('c').className).toContain('ds-hover-lift')
  })

  it('does not apply ds-hover-lift by default', () => {
    render(<Card data-testid="c">x</Card>)
    expect(screen.getByTestId('c').className).not.toContain('ds-hover-lift')
  })
})
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npx vitest run tests/components/ui/Card.test.jsx`
Expected: FAIL — `hover` prop currently has no effect.

- [ ] **Step 3: Update `Card.jsx`**

Edit `src/components/ui/Card.jsx` to add the hover classes:

```jsx
export function Card({ hover = false, className = '', children, ...rest }) {
  const hoverClass = hover ? 'ds-hover-lift cursor-pointer ds-card-shimmer' : ''
  return (
    <div className={`rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 ${hoverClass} ${className}`} {...rest}>
      {children}
    </div>
  )
}
```

Preserve any existing base classes or children handling the current file has — the above is additive, merge into the existing component.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run tests/components/ui/Card.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Card.jsx tests/components/ui/Card.test.jsx
git commit -m "feat(ui): implement Card hover prop with ds-hover-lift"
```

---

## Task 3: Add design-system transition custom properties

**Files:**
- Modify: `src/design-system.css`

- [ ] **Step 1: Add the custom properties**

In `src/design-system.css`, near the top of the `:root` block (after any existing custom properties), add:

```css
  --ds-transition-standard: 0.2s var(--ds-ease-out-expo);
  --ds-transition-fast: 0.12s var(--ds-ease-out-expo);
  --ds-transition-slow: 0.35s var(--ds-ease-spring);
```

Verify that `--ds-ease-out-expo` and `--ds-ease-spring` already exist in the file (they should — the spec says they're defined but underused). If either is missing, add them:

```css
  --ds-ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ds-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
```

- [ ] **Step 2: Add utility class**

In the same file, after the custom properties block:

```css
.ds-transition-standard {
  transition: all var(--ds-transition-standard);
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds; no CSS errors.

- [ ] **Step 4: Commit**

```bash
git add src/design-system.css
git commit -m "feat(css): add ds-transition-standard design tokens"
```

---

## Task 4: `ds-*` activation sweep — Buttons

**Files:**
- Modify: `src/components/ui/Button.jsx`

- [ ] **Step 1: Update the Button primary variant**

In `src/components/ui/Button.jsx`, find the `variants` object. Update the `primary` entry to include `ds-btn-shimmer` and `ds-focus-ring`:

```jsx
const variants = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-200 dark:shadow-indigo-900/50 active:scale-[0.98] ds-btn-shimmer ds-focus-ring',
  // ... other variants preserved ...
}
```

For `secondary`, `ghost`, and other variants, add `ds-focus-ring` only (keep their existing color treatment).

- [ ] **Step 2: Run the existing test suite**

Run: `npx vitest run`
Expected: No regressions.

- [ ] **Step 3: Manual visual check**

Run: `npm run dev`
Expected: Primary buttons across the app show the shimmer animation on hover. Focus outlines are consistent.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Button.jsx
git commit -m "feat(ui): activate ds-btn-shimmer and ds-focus-ring on buttons"
```

---

## Task 5: `ds-*` activation sweep — high-traffic components

**Files:**
- Modify: `src/components/RepoList.jsx` — repo cards
- Modify: `src/components/Dashboard/DashboardPremium.jsx` — stat cards
- Modify: `src/components/Dashboard/StatCard.jsx` — if exists, apply card shimmer
- Modify: `src/components/Pricing/PricingCard.jsx`

- [ ] **Step 1: Apply `ds-hover-lift` + `ds-card-shimmer` to repo cards**

In `src/components/RepoList.jsx`, find the repo card rendering (likely a `<div className="...">` with the repo body). Add `ds-hover-lift ds-card-shimmer` to the card's className. For example:

```jsx
<div
  data-testid="repo-card"
  className={`... existing classes ... ds-hover-lift ds-card-shimmer`}
>
```

- [ ] **Step 2: Apply `ds-gradient-text` to main headings**

Sweep `src/components/Dashboard/DashboardPremium.jsx`, `src/components/Landing/LandingPage.jsx`, `src/components/Pricing/PricingPage.jsx` for any `<h1>` or `<h2>` tag that displays a primary title. Add `ds-gradient-text` to its className.

Example in DashboardPremium.jsx:

```jsx
<h1 className="text-3xl font-bold ds-gradient-text ds-font-display">
  {greeting}, {user.login}
</h1>
```

- [ ] **Step 3: Apply animations to card grids**

Find the card grid containers in `DashboardPremium.jsx` and wrap each column/item in a motion.div with `ds-animate-fade-in-up`:

```jsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay: i * 0.05 }}
  className="ds-animate-fade-in-up"
>
  {/* card */}
</motion.div>
```

- [ ] **Step 4: Apply `ds-border-glow` to pricing active tier**

In `src/components/Pricing/PricingCard.jsx` (or equivalent), on the currently-active tier card, conditionally add `ds-border-glow`:

```jsx
<div className={`... base classes ... ${isActive ? 'ds-border-glow' : ''}`}>
```

- [ ] **Step 5: Run tests and build**

Run: `npx vitest run && npm run build`
Expected: PASS; no regressions.

- [ ] **Step 6: Manual visual QA**

Run: `npm run dev` and visit: Dashboard, RepoList, Pricing. Confirm hover-lift, shimmer, gradient text are active.

- [ ] **Step 7: Commit**

```bash
git add src/components/RepoList.jsx src/components/Dashboard/DashboardPremium.jsx src/components/Pricing/PricingCard.jsx
git commit -m "feat(ui): apply ds-* classes to repo cards, stat cards, pricing cards"
```

---

## Task 6: EmptyState sweep in RepoDetail tabs

**Files:**
- Modify: `src/components/RepoDetail/OverviewTab.jsx`
- Modify: `src/components/RepoDetail/IssuesTab.jsx`
- Modify: `src/components/RepoDetail/BranchesTab.jsx`
- Modify: `src/components/RepoDetail/ReleasesTab.jsx`
- Modify: `src/components/RepoDetail/PullRequestsTab.jsx`

- [ ] **Step 1: Replace OverviewTab "No README found"**

In `src/components/RepoDetail/OverviewTab.jsx` around line 57-59, replace:

```jsx
<p>No README found</p>
```

with:

```jsx
<EmptyState
  icon={BookOpen}
  title="No README"
  description="This repository doesn't have a README yet."
  action={{ label: 'Generate with AI', onClick: () => openModal('showCommitGen') /* or AI README flow */ }}
/>
```

Import `EmptyState` from `../ui/EmptyState` and `BookOpen` from `lucide-react`.

- [ ] **Step 2: Replace empty list in IssuesTab**

In `src/components/RepoDetail/IssuesTab.jsx`, where the code renders an empty list (likely `{issues.length === 0 && <something>}`), replace with:

```jsx
{issues.length === 0 && !loading && (
  <EmptyState
    icon={CircleDot}
    title="No open issues"
    description="This repository has no open issues right now."
  />
)}
```

Import `EmptyState` and `CircleDot`.

- [ ] **Step 3: Repeat for BranchesTab, ReleasesTab, PullRequestsTab**

- BranchesTab: `<EmptyState icon={GitBranch} title="No branches" description="..." />`
- ReleasesTab: `<EmptyState icon={Tag} title="No releases yet" description="..." />`
- PullRequestsTab: `<EmptyState icon={GitPullRequest} title="No open pull requests" description="..." />`

- [ ] **Step 4: Verify all tabs render empty states correctly**

Run: `npm run dev`
Navigate to a repo with empty tabs (or use mock mode). Expected: no raw `<p>No X</p>` fallbacks.

- [ ] **Step 5: Commit**

```bash
git add src/components/RepoDetail/OverviewTab.jsx src/components/RepoDetail/IssuesTab.jsx src/components/RepoDetail/BranchesTab.jsx src/components/RepoDetail/ReleasesTab.jsx src/components/RepoDetail/PullRequestsTab.jsx
git commit -m "refactor(repo-detail): replace text-only empty states with EmptyState component"
```

---

## Task 7: Create RepoDetail ActionsTab

**Files:**
- Create: `src/components/RepoDetail/ActionsTab.jsx`
- Create: `src/api/repo-actions.js`
- Modify: `src/components/RepoDetail/RepoDetail.jsx` — add tab to TABS array
- Test: append to `e2e/ui-polish-wave-3.spec.js`

- [ ] **Step 1: Create the frontend API module**

Create `src/api/repo-actions.js`:

```js
export const repoActionsApi = {
  listWorkflows: async (owner, repo) => {
    const res = await fetch(`/api/repos/${owner}/${repo}/actions/workflows`, { credentials: 'include' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  listRuns: async (owner, repo) => {
    const res = await fetch(`/api/repos/${owner}/${repo}/actions/runs`, { credentials: 'include' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  triggerDispatch: async (owner, repo, workflowId, ref = 'main') => {
    const res = await fetch(`/api/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  syncRuns: async (owner, repo) => {
    const res = await fetch(`/api/repos/${owner}/${repo}/actions/sync`, { method: 'POST', credentials: 'include' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }
}
```

Verify the exact URL prefix — existing repos endpoints may be mounted under `/api/repos`, `/api/v1/repos`, or `/repos`. Grep for `actions/workflows` in `server/routes/repos.js` and check how the router is mounted in `server/index.js`.

- [ ] **Step 2: Create the ActionsTab component**

Create `src/components/RepoDetail/ActionsTab.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { Zap, Play, RefreshCw, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { repoActionsApi } from '../../api/repo-actions'
import { EmptyState } from '../ui/EmptyState'
import { Skeleton } from '../ui/Skeleton'

const STATUS_ICONS = {
  success: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  failure: <XCircle className="w-4 h-4 text-red-500" />,
  in_progress: <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />,
  cancelled: <Clock className="w-4 h-4 text-slate-400" />
}

export function ActionsTab({ repo }) {
  const [workflows, setWorkflows] = useState([])
  const [runs, setRuns] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [wfs, rs] = await Promise.all([
        repoActionsApi.listWorkflows(repo.owner.login, repo.name),
        repoActionsApi.listRuns(repo.owner.login, repo.name)
      ])
      setWorkflows(wfs.workflows || wfs.data || [])
      setRuns(rs.runs || rs.data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [repo?.full_name])

  const handleSync = async () => {
    setLoading(true)
    try {
      await repoActionsApi.syncRuns(repo.owner.login, repo.name)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  const filteredRuns = selected ? runs.filter(r => r.workflow_id === selected.id) : runs

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <Skeleton key={i} variant="card" className="h-16" />)}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 text-red-900 dark:text-red-300 text-sm">
        {error}
      </div>
    )
  }

  if (workflows.length === 0) {
    return (
      <EmptyState
        icon={Zap}
        title="GitHub Actions not enabled"
        description="This repository does not have any workflows configured yet."
        action={{
          label: 'Learn how to get started',
          href: 'https://docs.github.com/en/actions/quickstart'
        }}
      />
    )
  }

  return (
    <div data-testid="actions-tab" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <aside className="lg:col-span-1 space-y-2">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold">Workflows</h3>
          <button onClick={handleSync} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 ds-hover-scale" aria-label="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {workflows.map(wf => (
          <button
            key={wf.id}
            onClick={() => setSelected(wf)}
            className={`w-full text-left p-3 rounded-lg border transition ds-transition-standard ${
              selected?.id === wf.id
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium truncate">{wf.name}</span>
              <Play className="w-3 h-3 text-slate-400" />
            </div>
          </button>
        ))}
      </aside>
      <section className="lg:col-span-2 space-y-2">
        <h3 className="text-sm font-semibold">
          Recent Runs {selected && `— ${selected.name}`}
        </h3>
        {filteredRuns.length === 0 ? (
          <p className="text-sm text-slate-500">No runs yet.</p>
        ) : (
          <ul className="space-y-2">
            {filteredRuns.slice(0, 30).map(run => (
              <li key={run.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between ds-hover-lift">
                <div className="flex items-center gap-3">
                  {STATUS_ICONS[run.conclusion || run.status] || STATUS_ICONS.in_progress}
                  <div>
                    <p className="text-sm font-medium">{run.display_title || run.name || `Run #${run.run_number}`}</p>
                    <p className="text-xs text-slate-500">
                      {run.head_branch} • {run.event} • {new Date(run.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Add the tab to RepoDetail**

In `src/components/RepoDetail/RepoDetail.jsx`, around lines 17-24, update the TABS array:

```jsx
const TABS = [
  { id: 'overview', label: 'Overview', icon: FileText },
  { id: 'branches', label: 'Branches', icon: GitBranch },
  { id: 'releases', label: 'Releases', icon: Tag },
  { id: 'actions', label: 'Actions', icon: Zap },
  { id: 'issues', label: 'Issues', icon: CircleDot },
  { id: 'pulls', label: 'Pull Requests', icon: GitPullRequest },
  { id: 'settings', label: 'Settings', icon: Settings }
]
```

Import `Zap` at the top. Also add the content renderer for the new tab:

```jsx
{activeTab === 'actions' && <ActionsTab repo={repo} />}
```

Import `ActionsTab`.

- [ ] **Step 4: Create e2e test file for Wave 3**

Create `e2e/ui-polish-wave-3.spec.js`:

```js
import { test, expect } from '@playwright/test'

test.describe('Wave 3 — UI polish & parity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=1')
    await page.waitForSelector('[data-testid="repo-card"]')
  })

  test('RepoDetail has an Actions tab', async ({ page }) => {
    await page.locator('[data-testid="repo-card"]').first().click()
    await page.waitForSelector('[data-testid="repo-detail"]')
    const actionsTab = page.locator('role=tab', { hasText: 'Actions' })
    await expect(actionsTab).toBeVisible()
    await actionsTab.click()
    await expect(page.locator('[data-testid="actions-tab"], text=GitHub Actions not enabled')).toBeVisible()
  })
})
```

Make sure `RepoDetail.jsx` has `data-testid="repo-detail"` on its root container.

- [ ] **Step 5: Run the test**

Run: `npx playwright test e2e/ui-polish-wave-3.spec.js -g "Actions tab"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/RepoDetail/ActionsTab.jsx src/api/repo-actions.js src/components/RepoDetail/RepoDetail.jsx e2e/ui-polish-wave-3.spec.js
git commit -m "feat(repo-detail): add Actions tab consuming existing workflow endpoints"
```

---

## Task 8: Insights entry point in RepoDetail OverviewTab

**Files:**
- Modify: `src/components/RepoDetail/OverviewTab.jsx`
- Test: append to `e2e/ui-polish-wave-3.spec.js`

- [ ] **Step 1: Append the failing test**

```js
test('OverviewTab has a View AI Insights button', async ({ page }) => {
  await page.locator('[data-testid="repo-card"]').first().click()
  await page.waitForSelector('[data-testid="repo-detail"]')
  const btn = page.locator('text=View AI Insights')
  await expect(btn).toBeVisible()
  await btn.click()
  await expect(page.locator('[data-testid="repo-insights-modal"]')).toBeVisible()
})
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npx playwright test e2e/ui-polish-wave-3.spec.js -g "AI Insights"`
Expected: FAIL — button does not exist.

- [ ] **Step 3: Add the button to OverviewTab**

In `src/components/RepoDetail/OverviewTab.jsx`, near the top of the tab content, add:

```jsx
import { Sparkles } from 'lucide-react'
import { useModal } from '../../contexts/ModalContext'

// inside the component:
const { openModalWithData } = useModal()

// in JSX, in a prominent position:
<button
  onClick={() => openModalWithData('showRepoInsights', { repo, initialTab: 'quality' })}
  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 ds-btn-shimmer ds-focus-ring"
>
  <Sparkles className="w-4 h-4" />
  View AI Insights
</button>
```

Ensure `RepoInsightsModal` in App.jsx is set up to accept `initialTab` from modal data (it likely already is — verify by grepping `initialTab` in RepoInsightsModal.jsx).

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx playwright test e2e/ui-polish-wave-3.spec.js -g "AI Insights"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/RepoDetail/OverviewTab.jsx e2e/ui-polish-wave-3.spec.js
git commit -m "feat(repo-detail): add View AI Insights button on OverviewTab"
```

---

## Task 9: Rewrite PricingPage with new Tier Matrix

**Files:**
- Modify: `src/components/Pricing/PricingPage.jsx`
- Test: append to `e2e/ui-polish-wave-3.spec.js`

- [ ] **Step 1: Append the failing test**

```js
test('PricingPage renders without any Coming Soon labels', async ({ page }) => {
  await page.goto('/pricing')
  await page.waitForSelector('[data-testid="pricing-page"]')
  const html = await page.content()
  expect(html).not.toMatch(/coming soon/i)
  expect(html).not.toMatch(/future release/i)
  expect(html).not.toMatch(/gitlab/i)  // Must not appear in pricing
})

test('PricingPage links to Roadmap', async ({ page }) => {
  await page.goto('/pricing')
  const link = page.locator('text=Roadmap').first()
  await expect(link).toBeVisible()
})
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npx playwright test e2e/ui-polish-wave-3.spec.js -g "PricingPage"`
Expected: FAIL — "Full migration (Azure + GitLab)" still present, no Roadmap link.

- [ ] **Step 3: Define the new tier data**

In `src/components/Pricing/PricingPage.jsx`, replace the tiers data structure with (preserve existing component layout):

```jsx
const TIERS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    description: 'Generous for individuals and OSS maintainers',
    features: [
      '50 repositories managed',
      '100 AI queries / month',
      'Dashboard, dark mode, shortcuts',
      'Community Health Dashboard',
      'Dry-Run migration (simulate)',
      'Export Metadata (JSON)',
      'Repo Insights — 5 per month',
      'README Generator — 3 per month',
      'Commit Generator — 20 per month',
      'Basic bulk on your own repos',
      '2 API keys'
    ],
    cta: { label: 'Get Started', href: '/signup' }
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$19',
    period: '/month',
    description: 'For small teams and power users',
    features: [
      'Everything in Free, unlimited',
      '2,000 AI queries / month',
      'Semantic Search (AI)',
      'AI Assistant (conversational)',
      'Azure DevOps Cloud migration',
      'Migration Risk Analysis',
      'Advanced Bulk (transfer, mirror)',
      'Teams — up to 15 members',
      'PR Review Experience',
      'Sync Repository (mirrors)',
      'Compare with Existing',
      'Security & Secrets Scan',
      'README Enhance with AI',
      '10 API keys',
      'Email support'
    ],
    cta: { label: 'Upgrade to Pro', href: '/checkout?tier=pro' },
    highlighted: true
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    description: 'For organizations needing compliance + scale',
    features: [
      'Everything in Pro, unlimited',
      'Unlimited AI queries',
      'Unlimited team members',
      'Audit Logs',
      '50 API keys',
      'Priority Support + SLA'
    ],
    cta: { label: 'Contact Sales', href: 'mailto:bruno@bolalabs.pt?subject=GitHub%20Repo%20Manager%20Enterprise' }
  }
]
```

- [ ] **Step 4: Render tier cards and Roadmap footer link**

Inside the component's return, keep the existing layout shell but render from `TIERS`. At the bottom, add:

```jsx
<footer className="text-center mt-12">
  <p className="text-sm text-slate-600 dark:text-slate-400">
    Curious about what's next?{' '}
    <a href="/roadmap" className="text-indigo-600 hover:underline ds-focus-ring">
      See the Roadmap →
    </a>
  </p>
</footer>
```

Add `data-testid="pricing-page"` on the page root for the test to find it.

- [ ] **Step 5: Remove any remaining "Coming Soon" / "Future Release" strings**

Run: `Grep --pattern "Coming Soon|Future Release|Azure \+ GitLab" --path src/components/Pricing`
Expected: No matches. If any remain, remove them.

- [ ] **Step 6: Run the tests, confirm they pass**

Run: `npx playwright test e2e/ui-polish-wave-3.spec.js -g "PricingPage"`
Expected: PASS both cases.

- [ ] **Step 7: Commit**

```bash
git add src/components/Pricing/PricingPage.jsx e2e/ui-polish-wave-3.spec.js
git commit -m "feat(pricing): rewrite PricingPage with honest tier matrix and Roadmap link"
```

---

## Task 10: New Roadmap page

**Files:**
- Create: `src/components/Roadmap/RoadmapPage.jsx`
- Create: `src/components/Roadmap/RoadmapStage.jsx`
- Create: `src/components/Roadmap/RoadmapItem.jsx`
- Modify: `src/App.jsx` — add `/roadmap` route
- Create: `tests/components/Roadmap/RoadmapPage.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/Roadmap/RoadmapPage.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RoadmapPage } from '../../../src/components/Roadmap/RoadmapPage'

describe('RoadmapPage', () => {
  it('renders three stages', () => {
    render(<RoadmapPage />)
    expect(screen.getByText(/Shipping Now/i)).toBeInTheDocument()
    expect(screen.getByText(/^Next/i)).toBeInTheDocument()
    expect(screen.getByText(/^Later/i)).toBeInTheDocument()
  })

  it('lists at least one feature per stage', () => {
    render(<RoadmapPage />)
    expect(screen.getByText(/Azure DevOps Server/i)).toBeInTheDocument()
    expect(screen.getByText(/SSO.*SAML/i)).toBeInTheDocument()
    expect(screen.getByText(/GitHub Enterprise Server/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npx vitest run tests/components/Roadmap/RoadmapPage.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the RoadmapItem component**

Create `src/components/Roadmap/RoadmapItem.jsx`:

```jsx
export function RoadmapItem({ title, description, tier }) {
  const tierColor = {
    free: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300',
    pro: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300',
    enterprise: 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
  }
  return (
    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 ds-hover-lift ds-card-shimmer">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className={`text-xs px-2 py-0.5 rounded ${tierColor[tier] || ''}`}>{tier}</span>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{description}</p>
    </div>
  )
}
```

- [ ] **Step 4: Create the RoadmapStage component**

Create `src/components/Roadmap/RoadmapStage.jsx`:

```jsx
import { RoadmapItem } from './RoadmapItem'

const STAGE_COLORS = {
  now: 'border-emerald-300 dark:border-emerald-800',
  next: 'border-amber-300 dark:border-amber-800',
  later: 'border-blue-300 dark:border-blue-800'
}

export function RoadmapStage({ id, title, subtitle, items }) {
  return (
    <section className={`rounded-2xl border-2 ${STAGE_COLORS[id]} p-6 space-y-4`}>
      <header>
        <h3 className="text-lg font-bold ds-gradient-text">{title}</h3>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </header>
      <div className="space-y-3">
        {items.map(item => <RoadmapItem key={item.title} {...item} />)}
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Create the RoadmapPage**

Create `src/components/Roadmap/RoadmapPage.jsx`:

```jsx
import { RoadmapStage } from './RoadmapStage'

const STAGES = [
  {
    id: 'now',
    title: 'Shipping Now',
    subtitle: 'Q2 2026 — in active development',
    items: [
      { title: 'Azure DevOps Server (On-Premise)', description: 'On-prem Azure DevOps support with PAT + URL adaptation.', tier: 'enterprise' },
      { title: 'GitLab Migration Importer', description: 'Clone GitLab repos into GitHub with history preservation.', tier: 'pro' },
      { title: 'Advanced Analytics Dashboard', description: 'Commit heatmaps, contributor insights, dependency graph.', tier: 'enterprise' },
      { title: 'Dependency Graph Visualizer', description: 'Interactive graph of repo dependencies.', tier: 'pro' },
      { title: 'CODEOWNERS Generator', description: 'Auto-generate and validate CODEOWNERS files.', tier: 'free' }
    ]
  },
  {
    id: 'next',
    title: 'Next',
    subtitle: 'Q3 2026 — scoped and committed',
    items: [
      { title: 'Bitbucket Migration Importer', description: 'Bitbucket Cloud and Server support.', tier: 'pro' },
      { title: 'SSO / SAML', description: 'Okta, Azure AD, and SAML 2.0 integration.', tier: 'enterprise' },
      { title: 'Backup & Restore System', description: 'Full export and restoration of repo data.', tier: 'enterprise' },
      { title: 'Security Alerts Dashboard', description: 'Cross-repo CVE aggregation with remediation workflow.', tier: 'pro' },
      { title: 'SBOM Export', description: 'CycloneDX and SPDX formats for compliance.', tier: 'enterprise' },
      { title: 'Release Notes Generator', description: 'AI-powered changelogs from commits and PRs.', tier: 'pro' }
    ]
  },
  {
    id: 'later',
    title: 'Later',
    subtitle: 'Q4 2026+ — exploring',
    items: [
      { title: 'GitHub Enterprise Server', description: 'Self-hosted GitHub with full feature parity.', tier: 'enterprise' },
      { title: 'Plugin / Extension System', description: 'Community-contributed extensions framework.', tier: 'free' },
      { title: 'Mobile App (React Native)', description: 'iOS and Android companion app.', tier: 'free' },
      { title: 'Custom AI Model Selection', description: 'OpenAI, Claude, or local model backends.', tier: 'pro' },
      { title: 'Org Permissions Sync', description: 'Bidirectional sync between GRM and GitHub teams.', tier: 'enterprise' },
      { title: 'Dependabot Aggregation', description: 'Review Dependabot PRs across multiple repos.', tier: 'pro' },
      { title: 'Custom Workflow Templates', description: 'Reusable CI/CD starter workflows.', tier: 'pro' }
    ]
  }
]

export function RoadmapPage() {
  return (
    <main data-testid="roadmap-page" className="max-w-6xl mx-auto px-6 py-12">
      <header className="text-center mb-12">
        <h1 className="text-4xl font-bold ds-gradient-text ds-font-display mb-3">Roadmap</h1>
        <p className="text-slate-600 dark:text-slate-400 max-w-xl mx-auto">
          What we're building next. Every item shipped on the Pricing page works today; everything on this page is honestly either in progress or planned.
        </p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {STAGES.map(stage => <RoadmapStage key={stage.id} {...stage} />)}
      </div>
    </main>
  )
}
```

- [ ] **Step 6: Add the route in App.jsx**

In `src/App.jsx`, find the route definitions (or equivalent — the app may use a simple state-based router). Add a case for `/roadmap` → `<RoadmapPage />`. If the app uses a state machine for routing, add a `currentView === 'roadmap'` branch. Import `RoadmapPage` (lazy) at the top.

- [ ] **Step 7: Run unit test, confirm it passes**

Run: `npx vitest run tests/components/Roadmap/RoadmapPage.test.jsx`
Expected: PASS.

- [ ] **Step 8: Append e2e test**

```js
test('Roadmap page loads with three stages', async ({ page }) => {
  await page.goto('/roadmap')
  await expect(page.locator('[data-testid="roadmap-page"]')).toBeVisible()
  await expect(page.locator('text=Shipping Now')).toBeVisible()
  await expect(page.locator('text=/^Next/')).toBeVisible()
  await expect(page.locator('text=/^Later/')).toBeVisible()
})
```

- [ ] **Step 9: Run e2e test**

Run: `npx playwright test e2e/ui-polish-wave-3.spec.js -g "Roadmap"`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/Roadmap/ src/App.jsx tests/components/Roadmap/ e2e/ui-polish-wave-3.spec.js
git commit -m "feat(roadmap): add Roadmap page with Now/Next/Later stages"
```

---

## Task 11: Rewrite README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Remove outdated feature promises and GitLab mentions**

Open `README.md`. Search for:
- `"Full migration (Azure + GitLab)"`, `"GitLab migration"`, `"GitLab import support"`, `"Bitbucket import"`, `"GitHub Enterprise Server"`, `"Plugin system"`, `"Mobile app"`, `"Custom AI model"`, `"SSO/SAML"`.

For each occurrence inside the Features, Pricing, or "What you get" sections, either delete the line or rewrite it to link to the Roadmap page (e.g., "See our [Roadmap](docs/plans/2026-04-12-roadmap.md) for upcoming features").

- [ ] **Step 2: Add Recently Shipped subsection**

Inside the Features or Overview section, add:

```markdown
### Recently Shipped (March–April 2026)

- **PR Review Experience** — File tree, diff viewer, AI insights, conversation threads.
- **License Badge** — Active tier display with Ed25519-signed JWT keys.
- **License Mint Automation** — GitHub Actions workflow for distributing license keys.
- **Rate Limit UX** — Friendly notices with dev-mode exemption.
- **Health Dashboard Premium** — Tabbed organization with visual polish.
- **Modal System Redesign** — Shared Modal primitive with body scroll lock.
- **Landing Page** — Hero, features, CTA sections.
```

- [ ] **Step 3: Replace Roadmap section**

Find the existing Roadmap section in `README.md`. Replace it with:

```markdown
## Roadmap

See the full [Roadmap page](https://grm.bolalabs.pt/roadmap) or [ROADMAP.md](ROADMAP.md) for what's next. Every feature on the Pricing page works today; upcoming items are honestly scoped as Shipping Now / Next / Later.
```

Replace the URL with whatever the project uses.

- [ ] **Step 4: Verify nothing on README claims non-existent features**

Run: `Grep --pattern "GitLab|Bitbucket|GitHub Enterprise Server|Mobile app|Plugin system|SSO|SAML" --path README.md`
Expected: Only mentions inside the Roadmap link paragraph (or no mentions at all).

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(readme): honest features section and recently shipped subsection"
```

---

## Task 12: Rewrite ROADMAP.md

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Replace the file contents**

Open `ROADMAP.md` and replace its contents with:

```markdown
# Roadmap

A thin mirror of the [in-app Roadmap page](/roadmap). Everything here is honestly either in progress or on the wishlist — nothing on the Pricing Page is vaporware.

## Shipping Now (Q2 2026)

- **Azure DevOps Server (on-premise)** — Enterprise tier. PAT + URL adaptation for self-hosted Azure DevOps.
- **GitLab Migration Importer** — Pro + Enterprise. Clone GitLab repos with history.
- **Advanced Analytics Dashboard** — Enterprise. Commit heatmaps, contributor insights, dependency graph.
- **Dependency Graph Visualizer** — Pro. Interactive graph of repo dependencies.
- **CODEOWNERS Generator** — Free. Auto-generate and validate CODEOWNERS files.

## Next (Q3 2026)

- **Bitbucket Migration Importer** — Pro + Enterprise.
- **SSO / SAML** — Enterprise. Okta, Azure AD, SAML 2.0.
- **Backup & Restore System** — Enterprise.
- **Security Alerts Dashboard** — Pro. Cross-repo CVE aggregation.
- **SBOM Export** — Enterprise. CycloneDX + SPDX.
- **Release Notes Generator** — Pro. AI from commits + PRs.

## Later (Q4 2026+)

- **GitHub Enterprise Server** — Enterprise.
- **Plugin / Extension System** — Free + Pro.
- **Mobile App (React Native)** — all tiers.
- **Custom AI Model Selection** — Pro + Enterprise.
- **Org Permissions Sync** — Enterprise.
- **Dependabot Aggregation** — Pro.
- **Custom Workflow Templates** — Pro.

## Recently Shipped (March–April 2026)

- PR Review Experience (file tree, diff viewer, AI insights, threads)
- License Badge + License Mint Automation (GitHub Actions workflow)
- Context Menu (scroll-free, native performance)
- Modal System Redesign (shared Modal primitive, body scroll lock)
- Health Dashboard Premium (tabbed organization, visual polish)
- Rate Limit UX (friendly notices + dev-mode exemption)
- Landing Page (hero, features, CTA)
- AGPL Open-Core License Key System (Ed25519 JWT)

See `docs/specs/` and `docs/plans/` for detailed design and implementation history.
```

- [ ] **Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): rewrite as thin mirror of Roadmap page content"
```

---

## Self-review checklist

- [ ] `Skeleton` uses `ds-skeleton` class, passes tests
- [ ] `Card hover` applies `ds-hover-lift` and `ds-card-shimmer`
- [ ] `Button` primary variant has `ds-btn-shimmer` and `ds-focus-ring`
- [ ] `design-system.css` has `--ds-transition-standard` tokens
- [ ] Dashboard, RepoList, PricingCard apply `ds-*` classes
- [ ] RepoDetail has new Actions tab and it renders workflows
- [ ] RepoDetail OverviewTab has "View AI Insights" button
- [ ] Every RepoDetail tab shows `<EmptyState />` for empty/missing data
- [ ] PricingPage has zero "Coming Soon" or "GitLab" mentions
- [ ] PricingPage links to `/roadmap`
- [ ] RoadmapPage renders three stages with the documented feature lists
- [ ] `/roadmap` route is registered in App.jsx
- [ ] README.md has updated Recently Shipped, no GitLab promises
- [ ] ROADMAP.md mirrors the Roadmap page content
- [ ] `grep -r "Coming Soon" src` returns zero results (outside comments/docs)
- [ ] `npx vitest run` passes
- [ ] `npx playwright test e2e/ui-polish-wave-3.spec.js` passes
- [ ] `npm run build` succeeds
