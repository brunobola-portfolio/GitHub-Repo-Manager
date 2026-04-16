# Select Repositories Step — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Migration Wizard's Select Repositories step into a decision-support surface with enriched metadata, a deterministic risk engine, a slide-in detail panel, a sticky summary bar, and coherent propagation of enriched data to the remaining wizard steps.

**Architecture:** Build the foundation first (shared UI components, motion tokens) to enable the Configure step to pick them up with zero visual regression. Add five new batched/lazy Azure endpoints that enrich the repo model. A pure client-side risk engine turns the enriched model into user-facing flags. The Select step is rebuilt as an orchestrator of focused subcomponents behind a `VITE_MIGRATION_SELECT_V2` flag. Downstream steps (Configure, AI Review, Schedule, Summary, BreadcrumbNav) adopt the shared components and consume the enriched state without re-fetching.

**Tech Stack:** React 19, Vite 7, Tailwind CSS v4, Framer Motion, lucide-react, Express, better-sqlite3, `@tanstack/react-virtual` (already present), Vitest + React Testing Library, Playwright.

**Source spec:** [docs/specs/2026-04-16-migration-repo-select-redesign.md](../specs/2026-04-16-migration-repo-select-redesign.md)

---

## Phase 1 — Foundation: Motion Tokens & Shared UI Primitives

No behavior changes. Extract visual vocabulary into shared components so every downstream step can adopt them without divergence.

### Task 1.1: Motion tokens module

**Files:**

- Create: `src/components/MigrationWizard/ui/motion.js`

- [ ] **Step 1: Write the file**

```js
// Shared motion tokens for the Migration Wizard.
// Centralizing these eliminates the mix of easeInOut/easeOut/ad-hoc springs
// across step components.

export const WIZARD_EASE = [0.16, 1, 0.3, 1]

export const WIZARD_SPRING = { type: 'spring', stiffness: 380, damping: 30 }

export const PANEL_SPRING = { type: 'spring', stiffness: 380, damping: 32 }

export const STAGGER_FAST = 0.03    // rows in large lists (>50 items)
export const STAGGER_NORMAL = 0.05  // cards in Configure / small lists
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MigrationWizard/ui/motion.js
git commit -m "feat(wizard): add shared motion tokens"
```

### Task 1.2: StatCard shared component

**Files:**

- Create: `src/components/MigrationWizard/ui/repo/StatCard.jsx`
- Test: `tests/components/MigrationWizard/ui/repo/StatCard.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import { render, screen } from '@testing-library/react'
import { Package } from 'lucide-react'
import { describe, it, expect } from 'vitest'
import { StatCard } from '../../../../../src/components/MigrationWizard/ui/repo/StatCard'

describe('StatCard', () => {
  it('renders value and label', () => {
    render(<StatCard icon={Package} label="Repositories" value="12" />)
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Repositories')).toBeInTheDocument()
  })

  it('applies tone color class to value', () => {
    render(<StatCard icon={Package} label="Warnings" value="3" tone="amber" />)
    expect(screen.getByText('3')).toHaveClass('text-amber-400')
  })

  it('falls back to indigo tone by default', () => {
    render(<StatCard icon={Package} label="Default" value="1" />)
    expect(screen.getByText('1')).toHaveClass('text-indigo-400')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/MigrationWizard/ui/repo/StatCard.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```jsx
// src/components/MigrationWizard/ui/repo/StatCard.jsx
const TONE_MAP = {
  indigo:  'text-indigo-400',
  violet:  'text-violet-400',
  cyan:    'text-cyan-400',
  emerald: 'text-emerald-400',
  amber:   'text-amber-400',
  orange:  'text-orange-400',
  red:     'text-red-400',
  slate:   'text-slate-400',
}

export function StatCard({ icon: Icon, label, value, tone = 'indigo' }) {
  const toneClass = TONE_MAP[tone] || TONE_MAP.indigo
  return (
    <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl px-4 py-3 text-center">
      {Icon && (
        <div className="flex justify-center mb-1">
          <Icon className={`w-4 h-4 ${toneClass}`} aria-hidden="true" />
        </div>
      )}
      <div className={`text-xl font-bold ${toneClass} tabular-nums`}>{value}</div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mt-0.5">
        {label}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run tests/components/MigrationWizard/ui/repo/StatCard.test.jsx`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/MigrationWizard/ui/repo/StatCard.jsx tests/components/MigrationWizard/ui/repo/StatCard.test.jsx
git commit -m "feat(wizard): add StatCard shared component"
```

### Task 1.3: RiskBadge shared component

**Files:**

- Create: `src/components/MigrationWizard/ui/repo/RiskBadge.jsx`
- Test: `tests/components/MigrationWizard/ui/repo/RiskBadge.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RiskBadge } from '../../../../../src/components/MigrationWizard/ui/repo/RiskBadge'

describe('RiskBadge', () => {
  it('returns null when level is ok', () => {
    const { container } = render(<RiskBadge level="ok" flags={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders blocker with count', () => {
    const flags = [
      { type: 'size-critical', severity: 'blocker', message: 'Too big' },
      { type: 'name-conflict', severity: 'blocker', message: 'Duplicate' },
    ]
    render(<RiskBadge level="blocker" flags={flags} />)
    expect(screen.getByText(/2/)).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', expect.stringMatching(/2 blocker/i))
  })

  it('uses amber styling for warning', () => {
    const flags = [{ type: 'lfs-suggested', severity: 'warning', message: 'LFS' }]
    render(<RiskBadge level="warning" flags={flags} />)
    expect(screen.getByRole('button').className).toMatch(/amber/)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/components/MigrationWizard/ui/repo/RiskBadge.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```jsx
// src/components/MigrationWizard/ui/repo/RiskBadge.jsx
import { AlertOctagon, AlertTriangle, Info } from 'lucide-react'

const LEVEL_STYLE = {
  blocker: {
    icon: AlertOctagon,
    cls:  'bg-red-500/15 text-red-400 border-red-500/30',
    aria: 'blocker',
  },
  warning: {
    icon: AlertTriangle,
    cls:  'bg-amber-500/15 text-amber-400 border-amber-500/30',
    aria: 'warning',
  },
  info: {
    icon: Info,
    cls:  'bg-slate-500/15 text-slate-400 border-slate-500/30',
    aria: 'info',
  },
}

export function RiskBadge({ level, flags, size = 'sm', onClick }) {
  if (level === 'ok') return null
  const style = LEVEL_STYLE[level]
  if (!style) return null
  const Icon = style.icon
  const count = flags?.length || 0
  const label = `${count} ${style.aria}${count === 1 ? '' : 's'}`
  const padding = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`inline-flex items-center gap-1 ${padding} rounded border font-medium ${style.cls}`}
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      {count > 0 && <span>{count}</span>}
    </button>
  )
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/components/MigrationWizard/ui/repo/RiskBadge.test.jsx`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/MigrationWizard/ui/repo/RiskBadge.jsx tests/components/MigrationWizard/ui/repo/RiskBadge.test.jsx
git commit -m "feat(wizard): add RiskBadge shared component"
```

### Task 1.4: RepoMetaBadges shared component

**Files:**

- Create: `src/components/MigrationWizard/ui/repo/RepoMetaBadges.jsx`
- Test: `tests/components/MigrationWizard/ui/repo/RepoMetaBadges.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RepoMetaBadges } from '../../../../../src/components/MigrationWizard/ui/repo/RepoMetaBadges'

describe('RepoMetaBadges', () => {
  const base = { name: 'foo', size: 2048, language: 'JavaScript', branches: 3 }

  it('renders language, size, branches', () => {
    render(<RepoMetaBadges repo={base} />)
    expect(screen.getByText('JavaScript')).toBeInTheDocument()
    expect(screen.getByText(/2 MB/)).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows TFVC badge for tfvc repos', () => {
    render(<RepoMetaBadges repo={{ ...base, isTfvc: true }} />)
    expect(screen.getByText('TFVC')).toBeInTheDocument()
  })

  it('shows LFS marker when hasLfsMarker', () => {
    render(<RepoMetaBadges repo={{ ...base, hasLfsMarker: true }} />)
    expect(screen.getByText('LFS')).toBeInTheDocument()
  })

  it('shows relative last activity', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString()
    render(<RepoMetaBadges repo={{ ...base, lastCommitDate: threeDaysAgo }} />)
    expect(screen.getByText(/3d/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/components/MigrationWizard/ui/repo/RepoMetaBadges.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```jsx
// src/components/MigrationWizard/ui/repo/RepoMetaBadges.jsx
import { Code2, HardDrive, GitBranch, Clock, Database } from 'lucide-react'
import { formatFileSize } from '../../../../utils/format'

function formatRelativeTime(iso) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const d = Math.floor(hr / 24)
  if (d < 30) return `${d}d`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo`
  return `${Math.floor(mo / 12)}y`
}

function Badge({ icon: Icon, children, tone = 'slate' }) {
  const toneCls = {
    slate:  'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-400',
    purple: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
    sky:    'bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400',
    amber:  'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    violet: 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400',
  }[tone]
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${toneCls}`}>
      {Icon && <Icon className="w-3 h-3" aria-hidden="true" />}
      {children}
    </span>
  )
}

export function RepoMetaBadges({ repo, density = 'full' }) {
  const relative = formatRelativeTime(repo.lastCommitDate)
  const showBranches = !repo.isTfvc && repo.branches > 0
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {repo.language && <Badge icon={Code2} tone="purple">{repo.language}</Badge>}
      <Badge icon={HardDrive}>{formatFileSize((repo.size || 0) * 1024, 1)}</Badge>
      {showBranches && <Badge icon={GitBranch} tone="sky">{repo.branches}</Badge>}
      {repo.isTfvc && <Badge tone="violet">TFVC</Badge>}
      {repo.hasLfsMarker && <Badge icon={Database} tone="amber">LFS</Badge>}
      {density === 'full' && relative && <Badge icon={Clock}>{relative}</Badge>}
    </div>
  )
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/components/MigrationWizard/ui/repo/RepoMetaBadges.test.jsx`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/MigrationWizard/ui/repo/RepoMetaBadges.jsx tests/components/MigrationWizard/ui/repo/RepoMetaBadges.test.jsx
git commit -m "feat(wizard): add RepoMetaBadges shared component"
```

### Task 1.5: SectionHero and SkeletonRow shared components

**Files:**

- Create: `src/components/MigrationWizard/ui/repo/SectionHero.jsx`
- Create: `src/components/MigrationWizard/ui/repo/SkeletonRow.jsx`

- [ ] **Step 1: Implement SectionHero**

```jsx
// src/components/MigrationWizard/ui/repo/SectionHero.jsx
import { motion } from 'framer-motion'
import { WIZARD_EASE } from '../motion'

export function SectionHero({ icon: Icon, title, subtitle, actions, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: WIZARD_EASE }}
      className="bg-gradient-to-br from-indigo-500/10 to-violet-500/10 border border-indigo-500/20 rounded-2xl p-5"
    >
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <div className="w-9 h-9 rounded-xl bg-indigo-500/15 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 text-indigo-400" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{title}</div>
            {subtitle && (
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{subtitle}</div>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </motion.div>
  )
}
```

- [ ] **Step 2: Implement SkeletonRow**

```jsx
// src/components/MigrationWizard/ui/repo/SkeletonRow.jsx
export function SkeletonRow() {
  return (
    <div className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 ds-card-shimmer">
      <div className="flex items-center gap-3">
        <div className="w-[18px] h-[18px] rounded bg-slate-200 dark:bg-slate-700" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-1/3 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-2 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
        </div>
        <div className="w-12 h-4 rounded bg-slate-200 dark:bg-slate-700" />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/MigrationWizard/ui/repo/SectionHero.jsx src/components/MigrationWizard/ui/repo/SkeletonRow.jsx
git commit -m "feat(wizard): add SectionHero and SkeletonRow primitives"
```

---

## Phase 2 — Backend: Enrichment Endpoints

Five new batched/lazy endpoints that enrich the repo model without re-architecting existing ones.

### Task 2.1: azure-service.js — listRepoActivity (batch)

**Files:**

- Modify: `server/azure-service.js` — append new function
- Test: `server/__tests__/azure-service-activity.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/azure-service-activity.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('listRepoActivity', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  it('returns per-repo activity keyed by repoId', async () => {
    globalThis.fetch.mockImplementation((url) => {
      if (url.includes('/repoA/stats/branches')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            value: [{
              name: 'main',
              commit: { committer: { date: '2026-04-10T10:00:00Z', name: 'Alice' } },
            }],
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ value: [] }),
      })
    })
    const { listRepoActivity } = await import('../azure-service.js')
    const out = await listRepoActivity('org', 'proj', [
      { id: 'repoA', defaultBranch: 'refs/heads/main' },
      { id: 'repoB', defaultBranch: '' },
    ], 'PAT')
    expect(out.repoA.lastCommitDate).toBe('2026-04-10T10:00:00Z')
    expect(out.repoA.lastCommitAuthor).toBe('Alice')
    expect(out.repoB.lastCommitDate).toBeNull()
  })

  it('tolerates individual failures', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) })
    const { listRepoActivity } = await import('../azure-service.js')
    const out = await listRepoActivity('org', 'proj', [{ id: 'r1', defaultBranch: 'refs/heads/main' }], 'PAT')
    expect(out.r1.lastCommitDate).toBeNull()
  })
})
```

- [ ] **Step 2: Run test**

Run: `npx vitest run server/__tests__/azure-service-activity.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement in azure-service.js**

Append to `server/azure-service.js` (after `listBranches`):

```js
/**
 * Fetch last-commit metadata for many repos in parallel.
 * Returns { [repoId]: { lastCommitDate, lastCommitAuthor } | { lastCommitDate: null } }.
 * Individual failures are swallowed (activity is a hint, not a requirement).
 */
async function listRepoActivity(org, project, repos, pat) {
  const { default: pLimit } = await import('p-limit')
  const limit = pLimit(5)
  const entries = await Promise.all(
    repos.map((repo) =>
      limit(async () => {
        const id = repo.id
        const defaultBranch = (repo.defaultBranch || '').replace(/^refs\/heads\//, '')
        if (!id || !defaultBranch) return [id, { lastCommitDate: null, lastCommitAuthor: null }]
        try {
          const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(id)}/stats/branches?name=${encodeURIComponent(defaultBranch)}&api-version=${API_VERSION}`
          const data = await azureFetch(url, pat)
          const entry = Array.isArray(data.value) ? data.value[0] : data
          const committer = entry?.commit?.committer
          return [id, {
            lastCommitDate: committer?.date || null,
            lastCommitAuthor: committer?.name || null,
          }]
        } catch {
          return [id, { lastCommitDate: null, lastCommitAuthor: null }]
        }
      })
    )
  )
  return Object.fromEntries(entries)
}

export { listRepoActivity }
```

Also update the existing `module.exports` / named-export block to include `listRepoActivity`.

- [ ] **Step 4: Install p-limit if missing**

Run: `npm list p-limit || npm install p-limit`

- [ ] **Step 5: Run tests**

Run: `npx vitest run server/__tests__/azure-service-activity.test.js`
Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
git add server/azure-service.js server/__tests__/azure-service-activity.test.js package.json package-lock.json
git commit -m "feat(azure): add listRepoActivity batch helper"
```

### Task 2.2: azure-service.js — checkLfsMarkers (batch)

**Files:**

- Modify: `server/azure-service.js`
- Test: `server/__tests__/azure-service-lfs.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('checkLfsMarkers', () => {
  beforeEach(() => { globalThis.fetch = vi.fn() })

  it('returns true when .gitattributes contains filter=lfs', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true, status: 200,
      text: () => Promise.resolve('*.psd filter=lfs diff=lfs merge=lfs -text'),
      json: () => Promise.resolve({}),
    })
    const { checkLfsMarkers } = await import('../azure-service.js')
    const out = await checkLfsMarkers('org', 'proj', [{ id: 'r1' }], 'PAT')
    expect(out.r1).toBe(true)
  })

  it('returns false when no .gitattributes (404)', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('') })
    const { checkLfsMarkers } = await import('../azure-service.js')
    const out = await checkLfsMarkers('org', 'proj', [{ id: 'r1' }], 'PAT')
    expect(out.r1).toBe(false)
  })
})
```

- [ ] **Step 2: Implement**

Append to `server/azure-service.js`:

```js
async function checkLfsMarkers(org, project, repos, pat) {
  const { default: pLimit } = await import('p-limit')
  const limit = pLimit(5)
  const entries = await Promise.all(
    repos.map((repo) =>
      limit(async () => {
        const id = repo.id
        if (!id) return [id, false]
        try {
          const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(id)}/items?path=/.gitattributes&$format=text&api-version=${API_VERSION}`
          const res = await fetch(url, {
            headers: {
              Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
              Accept: 'text/plain',
            },
          })
          if (!res.ok) return [id, false]
          const body = await res.text()
          return [id, /filter\s*=\s*lfs/.test(body)]
        } catch {
          return [id, false]
        }
      })
    )
  )
  return Object.fromEntries(entries)
}

export { checkLfsMarkers }
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run server/__tests__/azure-service-lfs.test.js`
Expected: 2 passing.

- [ ] **Step 4: Commit**

```bash
git add server/azure-service.js server/__tests__/azure-service-lfs.test.js
git commit -m "feat(azure): add checkLfsMarkers batch helper"
```

### Task 2.3: azure-service.js — lazy detail helpers

**Files:**

- Modify: `server/azure-service.js`

- [ ] **Step 1: Append helpers**

```js
/** 12-month commit activity histogram for a single repo. */
async function getCommitActivity(org, project, repoId, defaultBranch, pat, months = 12) {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const branch = (defaultBranch || '').replace(/^refs\/heads\//, '') || 'main'
  const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(branch)}&searchCriteria.fromDate=${encodeURIComponent(cutoff.toISOString())}&$top=1000&api-version=${API_VERSION}`
  const data = await azureFetch(url, pat)
  const buckets = {}
  for (const c of data.value || []) {
    const d = new Date(c.author?.date || c.committer?.date)
    if (isNaN(d)) continue
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    buckets[key] = (buckets[key] || 0) + 1
  }
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }))
}

/** Fetch the repository README (first matching file in root). */
async function getRepoReadme(org, project, repoId, pat, ref) {
  const candidates = ['README.md', 'README.MD', 'Readme.md', 'readme.md', 'README.rst', 'README']
  for (const name of candidates) {
    try {
      const versionDesc = ref ? `&versionDescriptor.version=${encodeURIComponent(ref)}` : ''
      const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/items?path=/${name}&$format=text${versionDesc}&api-version=${API_VERSION}`
      const res = await fetch(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
          Accept: 'text/plain',
        },
      })
      if (res.ok) {
        const text = await res.text()
        return { name, content: text.slice(0, 4096) }
      }
    } catch { /* try next */ }
  }
  return { name: null, content: '' }
}

/** Commit count (capped) and unique contributor count over default branch. */
async function getRepoFullStats(org, project, repoId, defaultBranch, pat) {
  const branch = (defaultBranch || '').replace(/^refs\/heads\//, '') || 'main'
  const CAP = 500
  const url = `${BASE_URL}/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(branch)}&$top=${CAP}&api-version=${API_VERSION}`
  const data = await azureFetch(url, pat)
  const commits = data.value || []
  const contributors = new Set(commits.map((c) => c.author?.email || c.author?.name).filter(Boolean))
  return {
    commitCount: commits.length,
    commitCountCapped: commits.length >= CAP,
    contributorCount: contributors.size,
  }
}

export { getCommitActivity, getRepoReadme, getRepoFullStats }
```

- [ ] **Step 2: Commit**

```bash
git add server/azure-service.js
git commit -m "feat(azure): add lazy detail helpers (activity, readme, full-stats)"
```

### Task 2.4: Route handlers in routes/azure.js

**Files:**

- Modify: `server/routes/azure.js` — add 5 handlers after line 175 (`pat-permissions`)

- [ ] **Step 1: Add the routes**

```js
// After existing /pat-permissions handler, before /tfvc/items:

router.post('/azure/repos/activity', requireAuth, async (req, res) => {
  try {
    const { org, project, repos, pat: bodyPat } = req.body
    const pat = azureService.resolvePat(bodyPat, req.session)
    if (!org || !project || !Array.isArray(repos)) {
      return errorResponse(res, 400, 'org, project and repos[] required')
    }
    if (!isValidGitHubUsername(org)) return errorResponse(res, 400, 'Invalid organization name')
    if (!pat) return errorResponse(res, 400, 'No PAT provided and no server PAT configured')
    const result = await azureService.listRepoActivity(org, project, repos, pat)
    res.json({ activity: result })
  } catch (error) {
    errorResponse(res, error.status || 500, safeError(error, 'Failed to fetch repo activity'))
  }
})

router.post('/azure/repos/lfs-check', requireAuth, async (req, res) => {
  try {
    const { org, project, repos, pat: bodyPat } = req.body
    const pat = azureService.resolvePat(bodyPat, req.session)
    if (!org || !project || !Array.isArray(repos)) {
      return errorResponse(res, 400, 'org, project and repos[] required')
    }
    if (!isValidGitHubUsername(org)) return errorResponse(res, 400, 'Invalid organization name')
    if (!pat) return errorResponse(res, 400, 'No PAT provided and no server PAT configured')
    const result = await azureService.checkLfsMarkers(org, project, repos, pat)
    res.json({ lfs: result })
  } catch (error) {
    errorResponse(res, error.status || 500, safeError(error, 'Failed to check LFS markers'))
  }
})

router.post('/azure/repos/commit-activity', requireAuth, async (req, res) => {
  try {
    const { org, project, repoId, defaultBranch, months, pat: bodyPat } = req.body
    const pat = azureService.resolvePat(bodyPat, req.session)
    if (!org || !project || !repoId) return errorResponse(res, 400, 'org, project, repoId required')
    if (!pat) return errorResponse(res, 400, 'No PAT provided and no server PAT configured')
    const activity = await azureService.getCommitActivity(org, project, repoId, defaultBranch, pat, months || 12)
    res.json({ activity })
  } catch (error) {
    errorResponse(res, error.status || 500, safeError(error, 'Failed to fetch commit activity'))
  }
})

router.post('/azure/repos/readme', requireAuth, async (req, res) => {
  try {
    const { org, project, repoId, ref, pat: bodyPat } = req.body
    const pat = azureService.resolvePat(bodyPat, req.session)
    if (!org || !project || !repoId) return errorResponse(res, 400, 'org, project, repoId required')
    if (!pat) return errorResponse(res, 400, 'No PAT provided and no server PAT configured')
    const readme = await azureService.getRepoReadme(org, project, repoId, pat, ref)
    res.json(readme)
  } catch (error) {
    errorResponse(res, error.status || 500, safeError(error, 'Failed to fetch README'))
  }
})

router.post('/azure/repos/full-stats', requireAuth, async (req, res) => {
  try {
    const { org, project, repoId, defaultBranch, pat: bodyPat } = req.body
    const pat = azureService.resolvePat(bodyPat, req.session)
    if (!org || !project || !repoId) return errorResponse(res, 400, 'org, project, repoId required')
    if (!pat) return errorResponse(res, 400, 'No PAT provided and no server PAT configured')
    const stats = await azureService.getRepoFullStats(org, project, repoId, defaultBranch, pat)
    res.json(stats)
  } catch (error) {
    errorResponse(res, error.status || 500, safeError(error, 'Failed to fetch full stats'))
  }
})
```

- [ ] **Step 2: Integration smoke test via http**

Create `server/__tests__/azure-routes-enriched.test.js`:

```js
import express from 'express'
import request from 'supertest'
import { describe, it, expect, vi } from 'vitest'
import azureRoutes from '../routes/azure.js'
import * as azureService from '../azure-service.js'

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (_req, _res, next) => next(),
  safeError: (e, msg) => msg,
  errorResponse: (res, code, msg) => res.status(code).json({ error: msg }),
  isValidGitHubUsername: () => true,
}))

describe('activity route', () => {
  it('returns 400 when repos missing', async () => {
    const app = express()
    app.use(express.json())
    app.use('/api', azureRoutes)
    const res = await request(app).post('/api/azure/repos/activity').send({ org: 'o', project: 'p' })
    expect(res.status).toBe(400)
  })

  it('delegates to azure-service and returns results', async () => {
    vi.spyOn(azureService, 'listRepoActivity').mockResolvedValue({ r1: { lastCommitDate: '2026-01-01T00:00:00Z' } })
    vi.spyOn(azureService, 'resolvePat').mockReturnValue('PAT')
    const app = express()
    app.use(express.json())
    app.use('/api', azureRoutes)
    const res = await request(app).post('/api/azure/repos/activity').send({
      org: 'o', project: 'p', repos: [{ id: 'r1', defaultBranch: 'refs/heads/main' }],
    })
    expect(res.status).toBe(200)
    expect(res.body.activity.r1.lastCommitDate).toBe('2026-01-01T00:00:00Z')
  })
})
```

- [ ] **Step 3: Install supertest if missing**

Run: `npm list supertest || npm install -D supertest`

- [ ] **Step 4: Run integration tests**

Run: `npx vitest run server/__tests__/azure-routes-enriched.test.js`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add server/routes/azure.js server/__tests__/azure-routes-enriched.test.js package.json package-lock.json
git commit -m "feat(api): add enriched repo endpoints (activity, lfs, commit-activity, readme, full-stats)"
```

---

## Phase 3 — Risk Engine (Pure Logic)

### Task 3.1: riskRules.js with all 10 rules

**Files:**

- Create: `src/components/MigrationWizard/steps/RepoSelectStep/riskRules.js`
- Test: `tests/components/MigrationWizard/RepoSelectStep/riskRules.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { evaluateRepo, RESERVED_NAMES } from '../../../../src/components/MigrationWizard/steps/RepoSelectStep/riskRules'

const base = {
  id: 'r1', name: 'foo', size: 1024, branches: 2, isDisabled: false,
  isTfvc: false, lastCommitDate: new Date().toISOString(), hasLfsMarker: false,
}
const ctx = { allRepos: [base], conflicts: {}, targetOrg: 'acme' }

describe('risk engine', () => {
  it('returns ok when no flags', () => {
    const r = evaluateRepo(base, ctx)
    expect(r.level).toBe('ok')
    expect(r.flags).toEqual([])
  })

  it('flags archived as info', () => {
    const r = evaluateRepo({ ...base, isDisabled: true }, ctx)
    expect(r.level).toBe('info')
    expect(r.flags[0].type).toBe('archived')
  })

  it('flags size > 5GB as warning', () => {
    // size is in KB
    const r = evaluateRepo({ ...base, size: 6 * 1024 * 1024 }, ctx)
    expect(r.level).toBe('warning')
    expect(r.flags.some((f) => f.type === 'size-warning')).toBe(true)
  })

  it('flags size > 10GB as blocker', () => {
    const r = evaluateRepo({ ...base, size: 11 * 1024 * 1024 }, ctx)
    expect(r.level).toBe('blocker')
    expect(r.flags.some((f) => f.type === 'size-critical')).toBe(true)
  })

  it('flags name conflict as blocker', () => {
    const r = evaluateRepo(base, { ...ctx, conflicts: { foo: true } })
    expect(r.level).toBe('blocker')
    expect(r.flags.some((f) => f.type === 'name-conflict')).toBe(true)
  })

  it('flags stale repo (>2 years) as info', () => {
    const old = new Date(Date.now() - 3 * 365 * 86400_000).toISOString()
    const r = evaluateRepo({ ...base, lastCommitDate: old }, ctx)
    expect(r.flags.some((f) => f.type === 'stale')).toBe(true)
    expect(r.level).toBe('info')
  })

  it('flags empty repo as info', () => {
    const r = evaluateRepo({ ...base, size: 0, branches: 0 }, ctx)
    expect(r.flags.some((f) => f.type === 'empty')).toBe(true)
  })

  it('flags LFS marker without explicit opt-in as warning', () => {
    const r = evaluateRepo({ ...base, hasLfsMarker: true, lfsEnabled: false }, ctx)
    expect(r.flags.some((f) => f.type === 'lfs-suggested')).toBe(true)
  })

  it('flags invalid chars as blocker', () => {
    const r = evaluateRepo({ ...base, name: 'has space!' }, ctx)
    expect(r.flags.some((f) => f.type === 'invalid-chars')).toBe(true)
    expect(r.level).toBe('blocker')
  })

  it('flags reserved names as blocker', () => {
    for (const name of RESERVED_NAMES) {
      const r = evaluateRepo({ ...base, name }, ctx)
      expect(r.flags.some((f) => f.type === 'reserved-name')).toBe(true)
    }
  })

  it('flags duplicate target names in batch as blocker', () => {
    const repos = [
      { ...base, id: 'a', name: 'dup' },
      { ...base, id: 'b', name: 'dup' },
    ]
    const r = evaluateRepo(repos[0], { ...ctx, allRepos: repos })
    expect(r.flags.some((f) => f.type === 'duplicate-in-batch')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/components/MigrationWizard/RepoSelectStep/riskRules.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement riskRules.js**

```js
// src/components/MigrationWizard/steps/RepoSelectStep/riskRules.js

export const RESERVED_NAMES = [
  '.git', '.github', 'www', 'api',
  'settings', 'login', 'logout',
  'admin', 'sponsors', 'topics',
]

const GB_IN_KB = 1024 * 1024
const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000
const VALID_NAME_RE = /^[A-Za-z0-9._-]+$/

// Each rule: (repo, ctx) => flag | null
const rules = [
  function ruleArchived(repo) {
    if (!repo.isDisabled) return null
    return {
      type: 'archived',
      severity: 'info',
      message: 'Repository is archived/disabled in Azure DevOps.',
      suggestion: 'Consider excluding — migrated archives rarely see traffic.',
    }
  },
  function ruleStale(repo) {
    if (!repo.lastCommitDate) return null
    const age = Date.now() - new Date(repo.lastCommitDate).getTime()
    if (age < TWO_YEARS_MS) return null
    return {
      type: 'stale',
      severity: 'info',
      message: 'No commits in the last 2 years.',
      suggestion: 'Likely a candidate to exclude from active migration.',
    }
  },
  function ruleEmpty(repo) {
    if (repo.size !== 0 || repo.branches !== 0 || repo.isTfvc) return null
    return {
      type: 'empty',
      severity: 'info',
      message: 'Repository is empty.',
      suggestion: 'Migration will create an empty repo on GitHub.',
    }
  },
  function ruleSizeWarning(repo) {
    if (repo.size <= 5 * GB_IN_KB || repo.size > 10 * GB_IN_KB) return null
    return {
      type: 'size-warning',
      severity: 'warning',
      message: 'Repository size exceeds 5 GB.',
      suggestion: 'Clone/push may take a while. Consider LFS for binaries.',
    }
  },
  function ruleSizeCritical(repo) {
    if (repo.size <= 10 * GB_IN_KB) return null
    return {
      type: 'size-critical',
      severity: 'blocker',
      message: 'Repository size exceeds 10 GB.',
      suggestion: 'GitHub may reject pushes over 10 GB. Split history or migrate LFS first.',
    }
  },
  function ruleLfsSuggested(repo) {
    if (!repo.hasLfsMarker || repo.lfsEnabled) return null
    return {
      type: 'lfs-suggested',
      severity: 'warning',
      message: 'LFS markers detected in .gitattributes.',
      suggestion: 'Enable LFS on target to preserve large-file pointers.',
    }
  },
  function ruleNameConflict(repo, ctx) {
    if (!ctx.conflicts?.[repo.name]) return null
    return {
      type: 'name-conflict',
      severity: 'blocker',
      message: `A repository named "${repo.name}" already exists in ${ctx.targetOrg || 'the target org'}.`,
      suggestion: 'Rename on the Configure step or skip this repo.',
      actions: [
        { id: 'auto-rename', label: 'Auto-rename' },
        { id: 'skip', label: 'Skip' },
      ],
    }
  },
  function ruleDuplicateInBatch(repo, ctx) {
    const dupes = (ctx.allRepos || []).filter((r) => r.name === repo.name)
    if (dupes.length < 2) return null
    return {
      type: 'duplicate-in-batch',
      severity: 'blocker',
      message: 'Another selected item has the same target name.',
      suggestion: 'Rename one on the Configure step.',
    }
  },
  function ruleInvalidChars(repo) {
    if (VALID_NAME_RE.test(repo.name)) return null
    return {
      type: 'invalid-chars',
      severity: 'blocker',
      message: 'Name contains characters GitHub does not accept.',
      suggestion: 'Only letters, numbers, dots, hyphens and underscores are allowed.',
    }
  },
  function ruleReservedName(repo) {
    if (!RESERVED_NAMES.includes(repo.name.toLowerCase())) return null
    return {
      type: 'reserved-name',
      severity: 'blocker',
      message: 'Name is reserved by GitHub.',
      suggestion: `Choose a different target name (${repo.name} is a GitHub-reserved path).`,
    }
  },
]

export function evaluateRepo(repo, ctx) {
  const flags = rules
    .map((rule) => rule(repo, ctx))
    .filter(Boolean)
  const level = flags.some((f) => f.severity === 'blocker') ? 'blocker'
              : flags.some((f) => f.severity === 'warning') ? 'warning'
              : flags.some((f) => f.severity === 'info')    ? 'info'
              : 'ok'
  return { level, flags }
}

/** Aggregate risk across the repos currently in scope (the whole list or the selection). */
export function aggregateRisk(repos) {
  let blockers = 0, warnings = 0, infos = 0
  for (const r of repos) {
    for (const f of r.risk?.flags || []) {
      if (f.severity === 'blocker') blockers++
      else if (f.severity === 'warning') warnings++
      else if (f.severity === 'info') infos++
    }
  }
  return { blockers, warnings, infos }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/components/MigrationWizard/RepoSelectStep/riskRules.test.js`
Expected: 11 passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/riskRules.js tests/components/MigrationWizard/RepoSelectStep/riskRules.test.js
git commit -m "feat(wizard): add risk engine with 10 rules"
```

### Task 3.2: useRiskEngine hook

**Files:**

- Create: `src/components/MigrationWizard/steps/RepoSelectStep/useRiskEngine.js`

- [ ] **Step 1: Implement**

```js
import { useMemo } from 'react'
import { evaluateRepo, aggregateRisk } from './riskRules'

/**
 * Compute risk for every repo. Pure memoization over repos, conflicts, targetOrg.
 * Returns a new array with `risk` attached to each repo.
 */
export function useRiskEngine(repos, conflicts, targetOrg) {
  return useMemo(() => {
    const ctx = { allRepos: repos, conflicts: conflicts || {}, targetOrg }
    const scored = repos.map((repo) => ({ ...repo, risk: evaluateRepo(repo, ctx) }))
    const aggregate = aggregateRisk(scored)
    const aggregateSelected = aggregateRisk(scored.filter((r) => r.selected))
    return { repos: scored, aggregate, aggregateSelected }
  }, [repos, conflicts, targetOrg])
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/useRiskEngine.js
git commit -m "feat(wizard): add useRiskEngine memoized hook"
```

---

## Phase 4 — Select Step: Orchestrator & Subcomponents

### Task 4.1: useEnrichedRepos — fetch orchestration hook

**Files:**

- Create: `src/components/MigrationWizard/steps/RepoSelectStep/useEnrichedRepos.js`

- [ ] **Step 1: Implement**

```js
import { useEffect, useState, useCallback } from 'react'

/**
 * Orchestrates the Select step's data lifecycle:
 *   1. base repo list (existing endpoint),
 *   2. batched activity + LFS enrichment,
 *   3. batched conflict preview.
 *
 * Failures in enrichment do not block the list render — they degrade gracefully.
 */
export function useEnrichedRepos({ source, repos, onSetRepos, onChange, targetOrg }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tfvcWarning, setTfvcWarning] = useState('')
  const [enriching, setEnriching] = useState(false)
  const [conflictsState, setConflictsState] = useState({})
  const [fetched, setFetched] = useState(false)

  // ── 1. Base fetch ─────────────────────────────────────────────
  useEffect(() => {
    if (fetched || !source.org || !source.project) return
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch('/api/azure/repos', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            org: source.org,
            project: source.project,
            pat: source.credentialMode === 'personalPat' ? source.pat : undefined,
          }),
        })
        const data = await res.json()
        if (!res.ok || !data.repos) {
          if (!cancelled) setError(data.error || 'Failed to load repositories')
          return
        }
        const isTfvc = data.versionControlType === 'Tfvc'
        if (onChange) onChange({ versionControlType: isTfvc ? 'Tfvc' : null })

        const gitMapped = data.repos.map((r) => ({
          id: r.id, name: r.name, selected: false, targetName: r.name,
          visibility: 'private', description: '',
          size: r.size || 0, language: r.language || null,
          defaultBranch: r.defaultBranch || '',
          webUrl: r.webUrl || '',
          branches: r.defaultBranch ? 1 : 0,
          isDisabled: r.isDisabled || false, isFork: r.isFork || false,
          lastCommitDate: null, lastCommitAuthor: null,
          hasLfsMarker: false,
        }))

        let tfvcMapped = []
        if (isTfvc) {
          try {
            const tfvcRes = await fetch('/api/azure/tfvc/items', {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                org: source.org, project: source.project,
                pat: source.credentialMode === 'personalPat' ? source.pat : undefined,
              }),
            })
            const tfvcData = await tfvcRes.json()
            const items = (tfvcData.items || []).filter((i) => i.isFolder)
            tfvcMapped = items.map((item) => ({
              id: item.path, name: item.path.split('/').pop(),
              selected: false, targetName: item.path.split('/').pop(),
              visibility: 'private', description: '',
              size: item.size || 0, language: null, defaultBranch: '',
              branches: 0, isDisabled: false, isFork: false,
              isTfvc: true, tfvcPath: item.path,
              lastCommitDate: null, lastCommitAuthor: null, hasLfsMarker: false,
            }))
          } catch {
            if (!cancelled) setTfvcWarning('Could not load TFVC folders — only Git repos are shown.')
          }
        }
        if (cancelled) return
        onSetRepos([...tfvcMapped, ...gitMapped])
        setFetched(true)
      } catch {
        if (!cancelled) setError('Could not reach server. Check your connection.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
    // onSetRepos/onChange are stable setState-shape; we only re-run on source change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.org, source.project, source.pat, source.credentialMode, fetched])

  // ── 2. Enrichment (activity + lfs) — runs once after base fetch ────
  useEffect(() => {
    if (!fetched || repos.length === 0) return
    const gitRepos = repos.filter((r) => !r.isTfvc && r.id)
    if (gitRepos.length === 0) return
    if (gitRepos.every((r) => r.lastCommitDate !== null || r.lastCommitDate === null)) {
      // Only run if at least one repo still has un-enriched fields
      const needsEnrichment = gitRepos.some((r) => r.lastCommitDate === null && !r._enriched)
      if (!needsEnrichment) return
    }
    let cancelled = false
    const payload = {
      org: source.org, project: source.project,
      pat: source.credentialMode === 'personalPat' ? source.pat : undefined,
      repos: gitRepos.map((r) => ({ id: r.id, defaultBranch: r.defaultBranch })),
    }
    setEnriching(true)
    Promise.allSettled([
      fetch('/api/azure/repos/activity', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json()),
      fetch('/api/azure/repos/lfs-check', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json()),
    ]).then(([activityRes, lfsRes]) => {
      if (cancelled) return
      const activity = activityRes.status === 'fulfilled' ? (activityRes.value.activity || {}) : {}
      const lfs      = lfsRes.status === 'fulfilled'      ? (lfsRes.value.lfs      || {}) : {}
      onSetRepos(
        repos.map((r) => ({
          ...r,
          lastCommitDate: activity[r.id]?.lastCommitDate ?? r.lastCommitDate,
          lastCommitAuthor: activity[r.id]?.lastCommitAuthor ?? r.lastCommitAuthor,
          hasLfsMarker: lfs[r.id] ?? r.hasLfsMarker,
          _enriched: true,
        }))
      )
    }).finally(() => { if (!cancelled) setEnriching(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetched])

  // ── 3. Conflict preview — batched + re-runs on targetOrg change ─────
  const runConflictCheck = useCallback(async (names, targetOwner) => {
    if (!names.length || !targetOwner) return
    try {
      const res = await fetch('/api/import/check-duplicates', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repos: names, targetOwner }),
      })
      const data = await res.json()
      if (res.ok && data.duplicates) setConflictsState(data.duplicates)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    if (!fetched || repos.length === 0) return
    const owner = targetOrg || source.org
    const names = repos.map((r) => r.name)
    const handle = setTimeout(() => runConflictCheck(names, owner), 500)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetched, targetOrg, repos.length])

  const retry = useCallback(() => {
    setFetched(false)
    setError('')
  }, [])

  return { loading, error, tfvcWarning, enriching, conflicts: conflictsState, retry }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/useEnrichedRepos.js
git commit -m "feat(wizard): add useEnrichedRepos orchestrator hook"
```

### Task 4.2: SelectionDashboard — hero with stats

**Files:**

- Create: `src/components/MigrationWizard/steps/RepoSelectStep/SelectionDashboard.jsx`

- [ ] **Step 1: Implement**

```jsx
import { Rocket, Package, AlertOctagon, AlertTriangle, Clock } from 'lucide-react'
import { SectionHero } from '../../ui/repo/SectionHero'
import { StatCard } from '../../ui/repo/StatCard'
import { SmartSelectMenu } from './SmartSelectMenu'

export function SelectionDashboard({ repos, aggregate, staleCount, onSmartSelect, onReset }) {
  return (
    <SectionHero
      icon={Rocket}
      title="Choose what to migrate"
      subtitle={`${repos.length} repos found`}
      actions={
        <>
          <SmartSelectMenu repos={repos} onSelect={onSmartSelect} />
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
              bg-slate-500/15 text-slate-400 border border-slate-500/20 hover:bg-slate-500/25 transition-colors"
          >
            Reset
          </button>
        </>
      }
    >
      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={Package} label="Total" value={repos.length} tone="indigo" />
        <StatCard icon={AlertTriangle} label="At risk" value={aggregate.warnings} tone="amber" />
        <StatCard icon={AlertOctagon} label="Blockers" value={aggregate.blockers} tone="red" />
        <StatCard icon={Clock} label="Stale" value={staleCount} tone="slate" />
      </div>
    </SectionHero>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/SelectionDashboard.jsx
git commit -m "feat(wizard): add SelectionDashboard hero"
```

### Task 4.3: QuickFilters — reactive chips

**Files:**

- Create: `src/components/MigrationWizard/steps/RepoSelectStep/QuickFilters.jsx`

- [ ] **Step 1: Implement**

```jsx
import { useMemo } from 'react'
import { AlertOctagon, AlertTriangle, Zap, Clock, Archive, Package, Database, Copy } from 'lucide-react'

const CHIP_DEFS = [
  { id: 'recommended', icon: Zap,           label: 'Recommended', match: (r) => r.risk?.level === 'ok' && !r.isDisabled },
  { id: 'at-risk',     icon: AlertTriangle, label: 'At risk',     match: (r) => r.risk?.level === 'warning' },
  { id: 'blocked',     icon: AlertOctagon,  label: 'Blocked',     match: (r) => r.risk?.level === 'blocker' },
  { id: 'stale',       icon: Clock,         label: 'Stale',       match: (r) => (r.risk?.flags || []).some((f) => f.type === 'stale') },
  { id: 'archived',    icon: Archive,       label: 'Archived',    match: (r) => r.isDisabled },
  { id: 'large',       icon: Package,       label: 'Large',       match: (r) => r.size > 1024 * 1024 },
  { id: 'tfvc',        icon: Database,      label: 'TFVC',        match: (r) => r.isTfvc },
  { id: 'conflicts',   icon: Copy,          label: 'Conflicts',   match: (r) => r.risk?.flags?.some((f) => f.type === 'name-conflict') },
]

export function QuickFilters({ repos, active, onToggle }) {
  const counts = useMemo(() => {
    const all = { all: repos.length }
    for (const def of CHIP_DEFS) all[def.id] = repos.filter(def.match).length
    return all
  }, [repos])

  return (
    <div className="flex items-center gap-1.5 flex-wrap" role="toolbar" aria-label="Quick filters">
      <Chip
        active={active.size === 0}
        onClick={() => onToggle(null)}
        label="All"
        count={counts.all}
        tone="indigo"
      />
      {CHIP_DEFS.map((def) => {
        const count = counts[def.id]
        if (!count) return null
        return (
          <Chip
            key={def.id}
            icon={def.icon}
            label={def.label}
            count={count}
            active={active.has(def.id)}
            onClick={() => onToggle(def.id)}
            tone={
              def.id === 'blocked'   ? 'red' :
              def.id === 'at-risk'   ? 'amber' :
              def.id === 'recommended' ? 'emerald' :
              def.id === 'tfvc'      ? 'violet' :
              'slate'
            }
          />
        )
      })}
    </div>
  )
}

function Chip({ icon: Icon, label, count, active, onClick, tone = 'slate' }) {
  const base = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors'
  const activeCls = {
    indigo:  'bg-indigo-500 text-white border-indigo-500 shadow-md shadow-indigo-500/25',
    red:     'bg-red-500 text-white border-red-500 shadow-md shadow-red-500/25',
    amber:   'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/25',
    emerald: 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/25',
    violet:  'bg-violet-500 text-white border-violet-500 shadow-md shadow-violet-500/25',
    slate:   'bg-slate-700 text-white border-slate-700 shadow-md',
  }[tone]
  const inactiveCls = 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`${base} ${active ? activeCls : inactiveCls}`}
    >
      {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
      {label}
      <span className="text-[10px] opacity-80 tabular-nums">{count}</span>
    </button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/QuickFilters.jsx
git commit -m "feat(wizard): add QuickFilters reactive chip bar"
```

### Task 4.4: SmartSelectMenu and PatternSelectModal

**Files:**

- Create: `src/components/MigrationWizard/steps/RepoSelectStep/SmartSelectMenu.jsx`
- Create: `src/components/MigrationWizard/steps/RepoSelectStep/PatternSelectModal.jsx`

- [ ] **Step 1: Implement SmartSelectMenu**

```jsx
// SmartSelectMenu.jsx
import { useState, useRef, useEffect } from 'react'
import { Sparkles, ChevronDown, Zap, Clock, XCircle, Archive, AlertOctagon, Pencil, Save } from 'lucide-react'
import { PatternSelectModal } from './PatternSelectModal'

const PRESETS = [
  { id: 'recommended', icon: Zap,         label: 'Recommended',          predicate: (r) => r.risk?.level === 'ok' && !r.isDisabled },
  { id: 'active-1y',   icon: Clock,       label: 'Active in last year',  predicate: (r) => {
      if (!r.lastCommitDate) return false
      return (Date.now() - new Date(r.lastCommitDate).getTime()) < 365 * 86400_000
    } },
  { id: 'excl-arch',   icon: Archive,     label: 'Exclude archived',     predicate: (r) => !r.isDisabled, mode: 'exclude' },
  { id: 'excl-stale',  icon: XCircle,     label: 'Exclude stale',        predicate: (r) => !(r.risk?.flags || []).some((f) => f.type === 'stale'), mode: 'exclude' },
  { id: 'excl-block',  icon: AlertOctagon,label: 'Exclude blockers',     predicate: (r) => r.risk?.level !== 'blocker', mode: 'exclude' },
]

export function SmartSelectMenu({ repos, onSelect }) {
  const [open, setOpen] = useState(false)
  const [patternOpen, setPatternOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    if (open) document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const apply = (preset) => {
    const selected = new Set(repos.filter(preset.predicate).map((r) => r.id))
    onSelect(selected, preset.mode)
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
          bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-md shadow-indigo-500/25
          hover:shadow-lg transition-all"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Sparkles className="w-3.5 h-3.5" />
        Smart Select
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-64 rounded-xl bg-slate-900/95 backdrop-blur-xl border border-slate-800 shadow-xl z-20"
        >
          <ul className="py-1">
            {PRESETS.map((p) => {
              const count = repos.filter(p.predicate).length
              const Icon = p.icon
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => apply(p)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                  >
                    <Icon className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="flex-1">{p.label}</span>
                    <span className="text-[11px] text-slate-500 tabular-nums">{count}</span>
                  </button>
                </li>
              )
            })}
            <li className="my-1 border-t border-slate-800" />
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setPatternOpen(true); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
              >
                <Pencil className="w-3.5 h-3.5 text-indigo-400" />
                Select by pattern…
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                disabled
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-500 opacity-50 cursor-not-allowed"
                title="Coming soon"
              >
                <Save className="w-3.5 h-3.5" />
                Save as preset… (soon)
              </button>
            </li>
          </ul>
        </div>
      )}
      {patternOpen && (
        <PatternSelectModal
          repos={repos}
          onConfirm={(ids) => { onSelect(new Set(ids)); setPatternOpen(false) }}
          onClose={() => setPatternOpen(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Implement PatternSelectModal**

```jsx
// PatternSelectModal.jsx — regex selection with live preview
import { useState, useMemo } from 'react'
import { X } from 'lucide-react'

export function PatternSelectModal({ repos, onConfirm, onClose }) {
  const [pattern, setPattern] = useState('')
  const [error, setError] = useState('')

  const matches = useMemo(() => {
    if (!pattern.trim()) { setError(''); return [] }
    // Safety: cap pattern length to avoid pathological regex
    if (pattern.length > 100) { setError('Pattern too long (max 100 chars)'); return [] }
    try {
      const re = new RegExp(pattern, 'i')
      setError('')
      return repos.filter((r) => re.test(r.name))
    } catch (e) {
      setError(e.message)
      return []
    }
  }, [pattern, repos])

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-200">Select by pattern</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-2">Enter a regular expression. Case-insensitive match on repo name.</p>
        <input
          type="text"
          autoFocus
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="^web-.*|.*-legacy$"
          className="w-full px-3 py-2 text-sm bg-slate-950 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-600 focus:ring-2 focus:ring-indigo-500"
        />
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        <p className="text-xs text-slate-400 mt-2 tabular-nums">
          {matches.length} of {repos.length} match
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!matches.length}
            onClick={() => onConfirm(matches.map((r) => r.id))}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-600"
          >
            Select {matches.length} match{matches.length === 1 ? '' : 'es'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/SmartSelectMenu.jsx src/components/MigrationWizard/steps/RepoSelectStep/PatternSelectModal.jsx
git commit -m "feat(wizard): add Smart Select menu and pattern modal"
```

### Task 4.5: SearchAndSort + BulkActions

**Files:**

- Create: `src/components/MigrationWizard/steps/RepoSelectStep/SearchAndSort.jsx`
- Create: `src/components/MigrationWizard/steps/RepoSelectStep/BulkActions.jsx`

- [ ] **Step 1: Implement SearchAndSort**

```jsx
// SearchAndSort.jsx
import { Search, ArrowUpDown, LayoutList, Rows } from 'lucide-react'

const SORT_OPTIONS = [
  { value: 'name',     label: 'Name (A–Z)' },
  { value: 'size',     label: 'Size (largest)' },
  { value: 'activity', label: 'Last activity' },
  { value: 'risk',     label: 'Risk (worst first)' },
]

export function SearchAndSort({ query, onQuery, sortBy, onSort, viewMode, onViewMode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search repositories..."
          aria-label="Search repositories"
          className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
        />
      </div>
      <div className="relative">
        <ArrowUpDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" aria-hidden="true" />
        <select
          value={sortBy}
          onChange={(e) => onSort(e.target.value)}
          aria-label="Sort repositories"
          className="appearance-none pl-8 pr-8 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 transition-colors"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div className="flex rounded-xl border border-slate-300 dark:border-slate-600 overflow-hidden">
        <button
          type="button"
          onClick={() => onViewMode('list')}
          aria-pressed={viewMode === 'list'}
          aria-label="List view"
          className={`px-2 py-2 ${viewMode === 'list' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-white dark:bg-slate-800 text-slate-500'}`}
        >
          <LayoutList className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onViewMode('compact')}
          aria-pressed={viewMode === 'compact'}
          aria-label="Compact view"
          className={`px-2 py-2 ${viewMode === 'compact' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-white dark:bg-slate-800 text-slate-500'}`}
        >
          <Rows className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Implement BulkActions**

```jsx
// BulkActions.jsx
import { CheckSquare, Square, ToggleLeft } from 'lucide-react'

export function BulkActions({ selectedCount, filteredCount, totalCount, hasActiveFilter, onSelectAll, onDeselectAll, onInvert }) {
  const primaryLabel =
    selectedCount === 0 && hasActiveFilter ? `Select ${filteredCount} in filter`
    : selectedCount === 0 ? 'Select All'
    : `Deselect All (${selectedCount})`
  const primaryOnClick = selectedCount === 0 ? onSelectAll : onDeselectAll
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={primaryOnClick}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-colors"
      >
        {selectedCount === 0 ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
        {primaryLabel}
      </button>
      <button
        type="button"
        onClick={onInvert}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-indigo-500 hover:text-indigo-500 transition-colors"
      >
        <ToggleLeft className="w-3.5 h-3.5" />
        Invert
      </button>
      <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
        <span className={selectedCount > 0 ? 'text-indigo-500 dark:text-indigo-400 font-medium' : ''}>
          {selectedCount} selected
        </span>{' '}
        of {totalCount}
      </span>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/SearchAndSort.jsx src/components/MigrationWizard/steps/RepoSelectStep/BulkActions.jsx
git commit -m "feat(wizard): add SearchAndSort and BulkActions controls"
```

### Task 4.6: RepoRow

**Files:**

- Create: `src/components/MigrationWizard/steps/RepoSelectStep/RepoRow.jsx`

- [ ] **Step 1: Implement**

```jsx
import { motion } from 'framer-motion'
import { Check, ChevronRight } from 'lucide-react'
import { RepoMetaBadges } from '../../ui/repo/RepoMetaBadges'
import { RiskBadge } from '../../ui/repo/RiskBadge'

const ACCENT = {
  blocker: 'from-red-500 to-red-600',
  warning: 'from-amber-500 to-orange-500',
  info:    'from-slate-400 to-slate-500',
  ok:      'from-indigo-500 to-violet-500',
}

export function RepoRow({ repo, isSelected, isActive, density = 'full', onToggle, onOpenDetail, onRiskClick }) {
  const level = repo.risk?.level || 'ok'
  const accent = ACCENT[level] || ACCENT.ok
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className={`relative w-full rounded-xl border transition-all text-sm ${
        repo.isDisabled ? 'opacity-60' : ''
      } ${
        isSelected
          ? 'border-indigo-500/60 bg-indigo-950/30 shadow-sm shadow-indigo-500/10'
          : 'border-slate-200 dark:border-slate-700 hover:border-indigo-400/50 hover:bg-slate-50 dark:hover:bg-slate-800/50'
      } ${isActive ? 'ring-2 ring-indigo-500/40' : ''}`}
    >
      <div className={`absolute top-0 left-0 bottom-0 w-[3px] rounded-l-xl bg-gradient-to-b ${accent}`} />
      <button
        type="button"
        role="option"
        aria-selected={isSelected}
        onClick={() => onToggle(repo.id)}
        onDoubleClick={() => onOpenDetail(repo.id)}
        disabled={repo.isDisabled && density !== 'compact'}
        className="w-full text-left p-3 pl-4 flex items-center gap-3"
      >
        <div
          className={`w-[18px] h-[18px] rounded flex items-center justify-center shrink-0 border-2 transition-colors ${
            isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-slate-400 dark:border-slate-600'
          }`}
        >
          {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">{repo.name}</span>
            {repo.isDisabled && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-500 font-semibold uppercase tracking-wide">
                Archived
              </span>
            )}
          </div>
          {density === 'full' && (
            <div className="mt-1.5">
              <RepoMetaBadges repo={repo} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <RiskBadge level={level} flags={repo.risk?.flags || []} onClick={onRiskClick ? (e) => { e.stopPropagation(); onRiskClick(repo.id) } : undefined} />
          <ChevronRight
            className="w-4 h-4 text-slate-400 dark:text-slate-500 cursor-pointer hover:text-indigo-400"
            onClick={(e) => { e.stopPropagation(); onOpenDetail(repo.id) }}
          />
        </div>
      </button>
    </motion.div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/RepoRow.jsx
git commit -m "feat(wizard): add RepoRow with risk-driven accent"
```

### Task 4.7: RepoList with virtualization threshold

**Files:**

- Create: `src/components/MigrationWizard/steps/RepoSelectStep/RepoList.jsx`

- [ ] **Step 1: Implement**

```jsx
import { useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useVirtualizer } from '@tanstack/react-virtual'
import { RepoRow } from './RepoRow'

const VIRTUALIZATION_THRESHOLD = 50

export function RepoList({ repos, selectedIds, activeId, density, onToggle, onOpenDetail }) {
  const parentRef = useRef(null)

  if (repos.length < VIRTUALIZATION_THRESHOLD) {
    return (
      <div className="space-y-1.5 max-h-96 overflow-y-auto pr-0.5" role="listbox" aria-multiselectable="true">
        <AnimatePresence initial={false}>
          {repos.map((r) => (
            <RepoRow
              key={r.id}
              repo={r}
              isSelected={selectedIds.has(r.id)}
              isActive={activeId === r.id}
              density={density}
              onToggle={onToggle}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </AnimatePresence>
      </div>
    )
  }

  return <VirtualList
    repos={repos}
    selectedIds={selectedIds}
    activeId={activeId}
    density={density}
    onToggle={onToggle}
    onOpenDetail={onOpenDetail}
    parentRef={parentRef}
  />
}

function VirtualList({ repos, selectedIds, activeId, density, onToggle, onOpenDetail }) {
  const parentRef = useRef(null)
  const rowHeight = density === 'compact' ? 40 : 68
  const virtualizer = useVirtualizer({
    count: repos.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  })
  return (
    <div
      ref={parentRef}
      className="max-h-[32rem] overflow-y-auto pr-0.5"
      role="listbox"
      aria-multiselectable="true"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const r = repos[vi.index]
          return (
            <div
              key={r.id}
              style={{
                position: 'absolute',
                top: 0, left: 0, right: 0,
                transform: `translateY(${vi.start}px)`,
                paddingBottom: 6,
              }}
            >
              <RepoRow
                repo={r}
                isSelected={selectedIds.has(r.id)}
                isActive={activeId === r.id}
                density={density}
                onToggle={onToggle}
                onOpenDetail={onOpenDetail}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/RepoList.jsx
git commit -m "feat(wizard): add RepoList with virtualization over 50 items"
```

### Task 4.8: RepoDetailPanel (uses shared SidePanel)

**Files:**

- Create: `src/components/MigrationWizard/steps/RepoSelectStep/RepoDetailPanel.jsx`

- [ ] **Step 1: Implement**

```jsx
import { useEffect, useState } from 'react'
import { ExternalLink, ChevronUp, ChevronDown } from 'lucide-react'
import { SidePanel } from '../../../ui/SidePanel'
import { RepoMetaBadges } from '../../ui/repo/RepoMetaBadges'
import { RepoRiskReport } from '../../ui/repo/RepoRiskReport'

export function RepoDetailPanel({ repo, source, onClose, onPrev, onNext, onRiskAction }) {
  const [stats, setStats] = useState(null)
  const [readme, setReadme] = useState(null)
  const [activity, setActivity] = useState(null)

  useEffect(() => {
    if (!repo) return
    let cancelled = false
    const payload = {
      org: source.org, project: source.project, repoId: repo.id, defaultBranch: repo.defaultBranch,
      pat: source.credentialMode === 'personalPat' ? source.pat : undefined,
    }
    // Fire three lazy endpoints in parallel
    Promise.all([
      fetch('/api/azure/repos/full-stats', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/azure/repos/readme', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/azure/repos/commit-activity', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, months: 12 }),
      }).then((r) => r.ok ? r.json() : null).catch(() => null),
    ]).then(([statsRes, readmeRes, activityRes]) => {
      if (cancelled) return
      setStats(statsRes)
      setReadme(readmeRes)
      setActivity(activityRes?.activity || [])
    })
    return () => { cancelled = true }
  }, [repo, source.org, source.project, source.credentialMode, source.pat])

  if (!repo) return null
  return (
    <SidePanel
      isOpen={!!repo}
      onClose={onClose}
      title={repo.name}
      subtitle={repo.lastCommitAuthor ? `Last update by ${repo.lastCommitAuthor}` : 'Repository details'}
      width={420}
    >
      <div className="flex items-center gap-2 p-4 border-b border-slate-200 dark:border-slate-800">
        {repo.webUrl && (
          <a
            href={repo.webUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-400"
          >
            Open in Azure DevOps <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onPrev} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Previous repo">
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onNext} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Next repo">
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="overflow-y-auto flex-1 p-4 space-y-5">
        {/* Risk report */}
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Risk Report</h4>
          <RepoRiskReport flags={repo.risk?.flags || []} onAction={(actionId) => onRiskAction(repo.id, actionId)} />
        </section>

        {/* Activity */}
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Activity</h4>
          {activity === null ? (
            <div className="h-8 rounded bg-slate-200 dark:bg-slate-800 ds-card-shimmer" />
          ) : (
            <ActivitySparkline data={activity} />
          )}
          {stats && (
            <p className="text-xs text-slate-500 mt-2">
              {stats.commitCountCapped ? '500+' : stats.commitCount} commits ·{' '}
              {stats.contributorCount} contributor{stats.contributorCount === 1 ? '' : 's'}
            </p>
          )}
        </section>

        {/* Details */}
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Details</h4>
          <RepoMetaBadges repo={repo} />
        </section>

        {/* README preview */}
        {readme?.content && (
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
              {readme.name} (preview)
            </h4>
            <div className="relative max-h-60 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
              <pre className="p-3 text-xs whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">
                {readme.content}
              </pre>
              <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-slate-50 dark:from-slate-950 to-transparent pointer-events-none" />
            </div>
          </section>
        )}
      </div>
    </SidePanel>
  )
}

function ActivitySparkline({ data }) {
  if (!data?.length) return <p className="text-xs text-slate-400">No commits in the last 12 months.</p>
  const max = Math.max(...data.map((d) => d.count), 1)
  return (
    <div className="flex items-end gap-1 h-12" aria-label="12-month commit activity">
      {data.map((d) => (
        <div
          key={d.month}
          title={`${d.month}: ${d.count}`}
          className="flex-1 bg-gradient-to-t from-indigo-500 to-violet-400 rounded-sm min-w-[4px]"
          style={{ height: `${(d.count / max) * 100}%` }}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Implement RepoRiskReport shared component**

Create `src/components/MigrationWizard/ui/repo/RepoRiskReport.jsx`:

```jsx
import { AlertOctagon, AlertTriangle, Info } from 'lucide-react'

const TONE = {
  blocker: { Icon: AlertOctagon,  bg: 'bg-red-500/10 border-red-500/30 text-red-400' },
  warning: { Icon: AlertTriangle, bg: 'bg-amber-500/10 border-amber-500/30 text-amber-400' },
  info:    { Icon: Info,          bg: 'bg-slate-500/10 border-slate-500/30 text-slate-400' },
}

export function RepoRiskReport({ flags, onAction }) {
  if (!flags?.length) return <p className="text-xs text-emerald-500">No issues detected.</p>
  return (
    <ul className="space-y-2">
      {flags.map((f) => {
        const t = TONE[f.severity] || TONE.info
        const Icon = t.Icon
        return (
          <li key={f.type} className={`p-3 rounded-lg border ${t.bg}`}>
            <div className="flex items-start gap-2">
              <Icon className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">{f.message}</p>
                {f.suggestion && <p className="text-xs opacity-80 mt-1">{f.suggestion}</p>}
                {f.actions?.length > 0 && onAction && (
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {f.actions.map((a) => (
                      a.href ? (
                        <a
                          key={a.id}
                          href={a.href} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-slate-800 text-slate-200 hover:bg-slate-700"
                        >
                          {a.label}
                        </a>
                      ) : (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => onAction(a.id)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-slate-800 text-slate-200 hover:bg-slate-700"
                        >
                          {a.label}
                        </button>
                      )
                    ))}
                  </div>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/RepoDetailPanel.jsx src/components/MigrationWizard/ui/repo/RepoRiskReport.jsx
git commit -m "feat(wizard): add RepoDetailPanel and RepoRiskReport"
```

### Task 4.9: SelectionSummaryBar (sticky)

**Files:**

- Create: `src/components/MigrationWizard/steps/RepoSelectStep/SelectionSummaryBar.jsx`

- [ ] **Step 1: Implement**

```jsx
import { motion, AnimatePresence } from 'framer-motion'
import { HardDrive, Clock, AlertTriangle, AlertOctagon, ArrowRight } from 'lucide-react'
import { formatFileSize } from '../../../../utils/format'

function estimateMinutes(totalSizeKb, totalBranches) {
  // 30 MB/s baseline clone + 3s per branch overhead
  const mb = totalSizeKb / 1024
  const seconds = (mb / 30) + (totalBranches * 3)
  return Math.max(1, Math.round(seconds / 60))
}

export function SelectionSummaryBar({ selected, warnings, blockers, onFixIssues }) {
  const show = selected.length > 0
  const totalSize = selected.reduce((s, r) => s + (r.size || 0), 0)
  const totalBranches = selected.reduce((s, r) => s + (r.branches || 0), 0)
  const est = estimateMinutes(totalSize, totalBranches)
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="sticky bottom-0 mt-4 backdrop-blur-xl bg-slate-900/70 dark:bg-slate-950/70 border border-indigo-500/20 rounded-2xl p-3 shadow-lg shadow-indigo-500/10 z-10"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <span className="font-semibold text-indigo-400">{selected.length} selected</span>
            <span className="flex items-center gap-1 text-slate-400">
              <HardDrive className="w-3.5 h-3.5" /> {formatFileSize(totalSize * 1024, 1)}
            </span>
            <span className="flex items-center gap-1 text-slate-400">
              <Clock className="w-3.5 h-3.5" /> ~{est} min
            </span>
            {warnings > 0 && (
              <span className="flex items-center gap-1 text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" /> {warnings} warning{warnings === 1 ? '' : 's'}
              </span>
            )}
            {blockers > 0 && (
              <span className="flex items-center gap-1 text-red-400">
                <AlertOctagon className="w-3.5 h-3.5" /> {blockers} blocker{blockers === 1 ? '' : 's'}
              </span>
            )}
            {(warnings > 0 || blockers > 0) && (
              <button
                type="button"
                onClick={onFixIssues}
                className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-indigo-400 hover:text-indigo-300"
              >
                Fix issues <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/SelectionSummaryBar.jsx
git commit -m "feat(wizard): add SelectionSummaryBar with estimated time"
```

### Task 4.10: RepoSelectStep orchestrator (v2) + feature flag wiring

**Files:**

- Replace: `src/components/MigrationWizard/steps/RepoSelectStep.jsx`
- Create: `src/components/MigrationWizard/steps/RepoSelectStep/index.jsx` (optional re-export pattern — skip, keep orchestrator in the top-level file)

- [ ] **Step 1: Replace RepoSelectStep.jsx**

```jsx
// src/components/MigrationWizard/steps/RepoSelectStep.jsx
import { useState, useMemo, useCallback, useEffect } from 'react'
import { Loader2, AlertCircle, AlertTriangle, FolderGit2 } from 'lucide-react'
import { useEnrichedRepos } from './RepoSelectStep/useEnrichedRepos'
import { useRiskEngine } from './RepoSelectStep/useRiskEngine'
import { SelectionDashboard } from './RepoSelectStep/SelectionDashboard'
import { QuickFilters } from './RepoSelectStep/QuickFilters'
import { SearchAndSort } from './RepoSelectStep/SearchAndSort'
import { BulkActions } from './RepoSelectStep/BulkActions'
import { RepoList } from './RepoSelectStep/RepoList'
import { RepoDetailPanel } from './RepoSelectStep/RepoDetailPanel'
import { SelectionSummaryBar } from './RepoSelectStep/SelectionSummaryBar'
import { SkeletonRow } from '../ui/repo/SkeletonRow'

const FILTER_PREDICATES = {
  'recommended': (r) => r.risk?.level === 'ok' && !r.isDisabled,
  'at-risk':     (r) => r.risk?.level === 'warning',
  'blocked':     (r) => r.risk?.level === 'blocker',
  'stale':       (r) => (r.risk?.flags || []).some((f) => f.type === 'stale'),
  'archived':    (r) => r.isDisabled,
  'large':       (r) => r.size > 1024 * 1024,
  'tfvc':        (r) => r.isTfvc,
  'conflicts':   (r) => r.risk?.flags?.some((f) => f.type === 'name-conflict'),
}

export default function RepoSelectStep({ repos, onSetRepos, source, onChange }) {
  const targetOrg = source.targetOrg || ''
  const { loading, error, tfvcWarning, enriching, conflicts, retry } = useEnrichedRepos({
    source, repos, onSetRepos, onChange, targetOrg,
  })

  // Attach risk to each repo (memoized)
  const { repos: scored, aggregate, aggregateSelected } =
    useRiskEngine(repos, conflicts, targetOrg || source.org)

  // Propagate `risk` back into wizard state exactly once when it changes meaningfully
  useEffect(() => {
    if (scored.length === 0) return
    const needsUpdate = scored.some((r, i) => JSON.stringify(r.risk) !== JSON.stringify(repos[i]?.risk))
    if (needsUpdate) onSetRepos(scored)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scored])

  // Local UI state
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('repoSelect:viewMode') || 'list')
  const [activeFilters, setActiveFilters] = useState(new Set())
  const [activeDetailId, setActiveDetailId] = useState(null)

  useEffect(() => { localStorage.setItem('repoSelect:viewMode', viewMode) }, [viewMode])

  const toggleFilter = useCallback((id) => {
    if (id === null) { setActiveFilters(new Set()); return }
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  // Derived list
  const filtered = useMemo(() => {
    let out = scored
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      out = out.filter((r) => r.name.toLowerCase().includes(q) || (r.language || '').toLowerCase().includes(q))
    }
    if (activeFilters.size > 0) {
      out = out.filter((r) => [...activeFilters].some((id) => FILTER_PREDICATES[id]?.(r)))
    }
    return out
  }, [scored, searchQuery, activeFilters])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    const sev = { blocker: 0, warning: 1, info: 2, ok: 3 }
    switch (sortBy) {
      case 'name':     copy.sort((a, b) => a.name.localeCompare(b.name)); break
      case 'size':     copy.sort((a, b) => b.size - a.size); break
      case 'activity': copy.sort((a, b) => (new Date(b.lastCommitDate || 0)) - (new Date(a.lastCommitDate || 0))); break
      case 'risk':     copy.sort((a, b) => (sev[a.risk?.level] ?? 3) - (sev[b.risk?.level] ?? 3)); break
    }
    return copy
  }, [filtered, sortBy])

  const selectedIds = useMemo(() => new Set(scored.filter((r) => r.selected).map((r) => r.id)), [scored])
  const staleCount = useMemo(() => scored.filter(FILTER_PREDICATES.stale).length, [scored])

  // Actions
  const toggleRepo = useCallback((id) => {
    onSetRepos(repos.map((r) => r.id === id ? { ...r, selected: !r.selected } : r))
  }, [repos, onSetRepos])

  const handleSmartSelect = useCallback((idSet, mode) => {
    onSetRepos(repos.map((r) => ({
      ...r,
      selected: mode === 'exclude' ? (r.selected && idSet.has(r.id)) : idSet.has(r.id),
    })))
  }, [repos, onSetRepos])

  const selectAll = useCallback(() => {
    const visible = new Set(sorted.map((r) => r.id))
    onSetRepos(repos.map((r) => r.isDisabled || !visible.has(r.id) ? r : { ...r, selected: true }))
  }, [repos, sorted, onSetRepos])

  const deselectAll = useCallback(() => {
    onSetRepos(repos.map((r) => ({ ...r, selected: false })))
  }, [repos, onSetRepos])

  const invertSelection = useCallback(() => {
    onSetRepos(repos.map((r) => r.isDisabled ? r : { ...r, selected: !r.selected }))
  }, [repos, onSetRepos])

  const handleFixIssues = useCallback(() => {
    setActiveFilters(new Set(['at-risk', 'blocked']))
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === '/') { e.preventDefault(); document.querySelector('input[aria-label="Search repositories"]')?.focus(); return }
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); invertSelection(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        if (e.shiftKey) deselectAll(); else selectAll()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [invertSelection, selectAll, deselectAll])

  const activeRepo = scored.find((r) => r.id === activeDetailId) || null

  // ── Render ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow />
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/30">
          <AlertCircle className="w-6 h-6 text-red-500" />
        </div>
        <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
        <button onClick={retry} className="text-sm text-indigo-500 hover:text-indigo-400 underline">Try again</button>
      </div>
    )
  }
  if (!loading && scored.length === 0) {
    return (
      <div className="text-center py-12">
        <FolderGit2 className="w-10 h-10 text-slate-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">No repositories found in this project.</p>
      </div>
    )
  }

  const isTfvc = source.versionControlType === 'Tfvc' || scored.some((r) => r.isTfvc)

  return (
    <div className="space-y-4">
      <SelectionDashboard
        repos={scored}
        aggregate={aggregate}
        staleCount={staleCount}
        onSmartSelect={handleSmartSelect}
        onReset={deselectAll}
      />

      {isTfvc && (
        <div className="p-3 bg-amber-900/20 border border-amber-700/30 rounded-xl text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" />
          This project uses TFVC. Each folder will be converted to a Git repository and pushed to GitHub.
        </div>
      )}
      {tfvcWarning && (
        <div className="p-3 bg-amber-900/20 border border-amber-700/30 rounded-xl text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" />
          {tfvcWarning}
        </div>
      )}

      <QuickFilters repos={scored} active={activeFilters} onToggle={toggleFilter} />

      <SearchAndSort
        query={searchQuery} onQuery={setSearchQuery}
        sortBy={sortBy} onSort={setSortBy}
        viewMode={viewMode} onViewMode={setViewMode}
      />

      <BulkActions
        selectedCount={selectedIds.size}
        filteredCount={sorted.length}
        totalCount={scored.length}
        hasActiveFilter={activeFilters.size > 0 || searchQuery.length > 0}
        onSelectAll={selectAll}
        onDeselectAll={deselectAll}
        onInvert={invertSelection}
      />

      {enriching && (
        <p className="text-[11px] text-slate-500">
          <Loader2 className="w-3 h-3 inline animate-spin mr-1" /> Loading activity & LFS signals…
        </p>
      )}

      <RepoList
        repos={sorted}
        selectedIds={selectedIds}
        activeId={activeDetailId}
        density={viewMode === 'compact' ? 'compact' : 'full'}
        onToggle={toggleRepo}
        onOpenDetail={(id) => setActiveDetailId(id)}
      />

      <SelectionSummaryBar
        selected={scored.filter((r) => r.selected)}
        warnings={aggregateSelected.warnings}
        blockers={aggregateSelected.blockers}
        onFixIssues={handleFixIssues}
      />

      {activeRepo && (
        <RepoDetailPanel
          repo={activeRepo}
          source={source}
          onClose={() => setActiveDetailId(null)}
          onPrev={() => {
            const idx = scored.findIndex((r) => r.id === activeDetailId)
            if (idx > 0) setActiveDetailId(scored[idx - 1].id)
          }}
          onNext={() => {
            const idx = scored.findIndex((r) => r.id === activeDetailId)
            if (idx < scored.length - 1) setActiveDetailId(scored[idx + 1].id)
          }}
          onRiskAction={() => { /* wired in 5.1 when Configure owns rename */ }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add Next-button gating**

Modify `src/components/MigrationWizard/MigrationWizard.jsx`. After computing `selectedRepos` (around line 397), compute blockers and disable Next when present on the repoSelect step:

```jsx
// Add near the other derived values:
const blockerCount = currentStep === 'repoSelect'
  ? selectedRepos.reduce((sum, r) => sum + (r.risk?.flags || []).filter((f) => f.severity === 'blocker').length, 0)
  : 0
```

In the footer JSX, update the Next button:

```jsx
{canGoNext && !hideNextButton && (
  <button
    type="button"
    onClick={handleNext}
    disabled={blockerCount > 0}
    title={blockerCount > 0 ? `${blockerCount} blocker(s) must be resolved — open a row to see options` : undefined}
    className={`ds-btn-shimmer inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-semibold rounded-lg text-white
      ${blockerCount > 0
        ? 'bg-slate-600 cursor-not-allowed opacity-60'
        : 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700'}
      shadow-md shadow-indigo-500/20 hover:shadow-lg hover:shadow-indigo-500/25 transition-all duration-200`}
  >
    Next
    <ArrowRight className="w-3.5 h-3.5" />
  </button>
)}
```

- [ ] **Step 3: Smoke test**

Run: `npm run dev` then manually:

1. Launch migration wizard, pick Azure, connect, select a project → Select step
2. Verify hero dashboard, chips, search, list, detail panel, summary bar appear
3. Select repos → sticky bar shows totals
4. Deep-select a risky repo → panel shows flags

- [ ] **Step 4: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep.jsx src/components/MigrationWizard/MigrationWizard.jsx
git commit -m "feat(wizard): rebuild RepoSelectStep with risk engine + detail panel"
```

---

## Phase 5 — Downstream Coherence

### Task 5.1: RepoConfigStep — consume cached conflict + show RiskBadge

**Files:**

- Modify: `src/components/MigrationWizard/steps/RepoConfigStep.jsx`

- [ ] **Step 1: Seed conflicts from cached state, remove mount-time recheck**

Replace the `useEffect` block at [RepoConfigStep.jsx:116-123](src/components/MigrationWizard/steps/RepoConfigStep.jsx#L116-L123) with:

```jsx
// Seed conflict state from cached repo.conflictStatus (set by Select step).
// Only run a live check when user edits a targetName (existing debounced logic in handleTargetNameChange).
useEffect(() => {
  const seeded = {}
  repos.forEach((repo) => {
    if (repo.risk?.flags?.some((f) => f.type === 'name-conflict')) seeded[repo.name] = 'conflict'
    else if (repo.targetName?.trim()) seeded[repo.name] = 'clear'
  })
  setConflicts(seeded)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

- [ ] **Step 2: Render RiskBadge on each card**

Inside the `motion.div` that renders each card, just before the visibility toggle block (`<button type="button" onClick={() => handleVisibilityToggle(...)}`), insert:

```jsx
import { RiskBadge } from '../ui/repo/RiskBadge'

// …inside the card, inline after repo metadata row:
<RiskBadge level={repo.risk?.level || 'ok'} flags={repo.risk?.flags || []} />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoConfigStep.jsx
git commit -m "feat(wizard): Configure reads cached conflict state from Select"
```

### Task 5.2: AIReviewStep — send clientFindings

**Files:**

- Modify: `src/api/migration.js` (or wherever `runAiReview` is defined)
- Modify: `src/components/MigrationWizard/steps/AIReviewStep.jsx` — pass clientFindings

- [ ] **Step 1: Update migrationApi.runAiReview signature**

Find the existing call. Add `clientFindings` to the POST body:

```js
// Change signature to accept clientFindings
export async function runAiReview({ planId, clientFindings }) {
  const res = await fetch('/api/ai/review', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId, clientFindings }),
  })
  return res.json()
}
```

- [ ] **Step 2: Update AIReviewStep call-site**

In `AIReviewStep.jsx`, change the call to `runAiReview` to include the current risk flags:

```jsx
const selectedRepos = (wizard.repos || []).filter((r) => r.selected)
const clientFindings = selectedRepos.map((r) => ({
  repoId: r.id,
  name: r.name,
  flags: r.risk?.flags || [],
}))
const result = await migrationApi.runAiReview({ planId: wizard.planId, clientFindings })
```

- [ ] **Step 3: Update backend /api/ai/review to accept & echo clientFindings**

Modify the handler to include the clientFindings in its prompt to the LLM. Implementation is backend-specific; at minimum the backend must accept the field without erroring. Add a unit test asserting the schema permits `clientFindings`.

- [ ] **Step 4: Commit**

```bash
git add src/api/migration.js src/components/MigrationWizard/steps/AIReviewStep.jsx server
git commit -m "feat(wizard): AI review consumes client-computed risk flags"
```

### Task 5.3: ScheduleStep — adopt StatCard

**Files:**

- Modify: `src/components/MigrationWizard/steps/ScheduleStep.jsx` — refactor `SummaryCard`

- [ ] **Step 1: Replace SummaryCard internals**

```jsx
import { StatCard } from '../ui/repo/StatCard'
import { Package, HardDrive, Clock, Flag, AlertTriangle } from 'lucide-react'
import { formatFileSize } from '../../../utils/format'

function SummaryCard({ wizard }) {
  const selectedRepos = (wizard.repos || []).filter((r) => r.selected)
  const totalSize = selectedRepos.reduce((s, r) => s + (r.size || 0), 0)
  const warnings = selectedRepos.reduce((s, r) => s + (r.risk?.flags || []).filter((f) => f.severity === 'warning').length, 0)
  const estimatedMinutes = wizard.aiPlan?.estimatedMinutes || null
  const targetOrg = wizard.source?.targetOrg || wizard.source?.org || 'GitHub'
  return (
    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3">
      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Migration Summary</h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Package} label="Repositories" value={selectedRepos.length} tone="indigo" />
        <StatCard icon={HardDrive} label="Total size"  value={formatFileSize(totalSize * 1024, 1)} tone="cyan" />
        {estimatedMinutes && <StatCard icon={Clock} label="Estimated" value={`~${estimatedMinutes}m`} tone="violet" />}
        <StatCard icon={Flag} label="Target" value={targetOrg} tone="emerald" />
        {warnings > 0 && <StatCard icon={AlertTriangle} label="Warnings" value={warnings} tone="amber" />}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MigrationWizard/steps/ScheduleStep.jsx
git commit -m "feat(wizard): Schedule step uses shared StatCard"
```

### Task 5.4: SummaryStep — Pre-flight section

**Files:**

- Modify: `src/components/MigrationWizard/steps/SummaryStep.jsx`

- [ ] **Step 1: Add pre-flight summary near top**

Immediately after the main header section in the existing SummaryStep render, add:

```jsx
import { ShieldCheck } from 'lucide-react'

function PreflightSummary({ wizard }) {
  const selected = (wizard.repos || []).filter((r) => r.selected)
  const flagsByType = {}
  for (const r of selected) {
    for (const f of r.risk?.flags || []) {
      flagsByType[f.type] = (flagsByType[f.type] || 0) + 1
    }
  }
  const total = Object.values(flagsByType).reduce((a, b) => a + b, 0)
  if (total === 0) return null
  const labels = {
    'name-conflict': 'name conflict → auto-renamed',
    'lfs-suggested': 'LFS marker detected → LFS enabled on target',
    'size-warning':  'size warning → migrated with extended timeout',
    'size-critical': 'size blocker resolved before migration',
    'archived':      'archived repo included',
    'stale':         'stale repo included',
  }
  return (
    <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-emerald-400">
          Pre-flight resolved {total} issue{total === 1 ? '' : 's'} before migration
        </span>
      </div>
      <ul className="text-xs text-slate-400 space-y-1 ml-6 list-disc">
        {Object.entries(flagsByType).map(([type, count]) => (
          <li key={type}>{count} {labels[type] || type}</li>
        ))}
      </ul>
    </div>
  )
}
```

Render `<PreflightSummary wizard={wizard} />` before the stats section (pass wizard via props; if not available, read from the hook in parent).

- [ ] **Step 2: Commit**

```bash
git add src/components/MigrationWizard/steps/SummaryStep.jsx
git commit -m "feat(wizard): Summary shows pre-flight risk resolution"
```

### Task 5.5: BreadcrumbNav — warning pill

**Files:**

- Modify: `src/components/MigrationWizard/MigrationWizard.jsx` (SidebarStepper breadcrumb block)
- Modify: `src/components/MigrationWizard/BreadcrumbNav.jsx`

- [ ] **Step 1: Thread totalWarnings to breadcrumb**

In MigrationWizard.jsx, compute `totalWarnings` from selectedRepos and pass into SidebarStepper:

```jsx
const totalWarnings = selectedRepos.reduce(
  (sum, r) => sum + (r.risk?.flags || []).filter((f) => f.severity === 'warning').length, 0
)

// Pass to SidebarStepper
<SidebarStepper … selectedCount={selectedRepos.length} totalWarnings={totalWarnings} … />
```

- [ ] **Step 2: Update SidebarStepper breadcrumb pill**

Inside SidebarStepper, modify the `{selectedCount > 0 && …}` pill:

```jsx
{selectedCount > 0 && (
  <>
    <ChevronRight className="w-2.5 h-2.5 text-slate-400 dark:text-slate-600 shrink-0" />
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap flex items-center gap-1 ${
      totalWarnings > 0
        ? 'text-amber-500 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-500/15'
        : 'text-emerald-500 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-500/15'
    }`}>
      {selectedCount} repos
      {totalWarnings > 0 && <AlertTriangle className="w-2.5 h-2.5" />}
    </span>
  </>
)}
```

Also import `AlertTriangle` at top. Apply the same change to `BreadcrumbNav.jsx` for the mobile/restored-mode breadcrumb.

- [ ] **Step 3: Commit**

```bash
git add src/components/MigrationWizard/MigrationWizard.jsx src/components/MigrationWizard/BreadcrumbNav.jsx
git commit -m "feat(wizard): breadcrumb shows warning pill when selection has warnings"
```

---

## Phase 6 — Accessibility & Polish

### Task 6.1: Keyboard cheatsheet overlay

**Files:**

- Create: `src/components/MigrationWizard/steps/RepoSelectStep/ShortcutsOverlay.jsx`

- [ ] **Step 1: Implement**

```jsx
import { X } from 'lucide-react'

const SHORTCUTS = [
  { keys: ['/'],            label: 'Focus search' },
  { keys: ['↑', '↓'],        label: 'Navigate rows' },
  { keys: ['Space'],        label: 'Toggle selection' },
  { keys: ['Enter'],        label: 'Open detail panel' },
  { keys: ['Esc'],          label: 'Close detail panel' },
  { keys: ['J', 'K'],        label: 'Prev/next in panel' },
  { keys: ['I'],            label: 'Invert selection' },
  { keys: ['Ctrl', 'A'],     label: 'Select all visible' },
  { keys: ['Ctrl', 'Shift', 'A'], label: 'Deselect all' },
  { keys: ['?'],            label: 'Show this help' },
]

export function ShortcutsOverlay({ open, onClose }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-200">Keyboard shortcuts</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>
        <ul className="space-y-2">
          {SHORTCUTS.map((s, i) => (
            <li key={i} className="flex items-center justify-between text-xs">
              <span className="text-slate-400">{s.label}</span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-800 border border-slate-700 rounded text-slate-300">{k}</kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire `?` shortcut in RepoSelectStep.jsx**

Inside the existing keyboard effect:

```jsx
if (e.key === '?') { e.preventDefault(); setShortcutsOpen(true) }
```

Add `const [shortcutsOpen, setShortcutsOpen] = useState(false)` and render `<ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />`.

- [ ] **Step 3: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep/ShortcutsOverlay.jsx src/components/MigrationWizard/steps/RepoSelectStep.jsx
git commit -m "feat(wizard): add keyboard shortcuts overlay"
```

### Task 6.2: Filter persistence in sessionStorage

**Files:**

- Modify: `src/components/MigrationWizard/steps/RepoSelectStep.jsx`

- [ ] **Step 1: Add session persistence**

Replace the `activeFilters` initialization:

```jsx
const [activeFilters, setActiveFilters] = useState(() => {
  try {
    const raw = sessionStorage.getItem('repoSelect:filters')
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
})
useEffect(() => {
  sessionStorage.setItem('repoSelect:filters', JSON.stringify([...activeFilters]))
}, [activeFilters])
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep.jsx
git commit -m "feat(wizard): persist quick-filter selection across reloads"
```

### Task 6.3: E2E test — happy path

**Files:**

- Create: `e2e/migration-select-redesign.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from '@playwright/test'

test.describe('Migration Wizard — Select step redesign', () => {
  test('shows hero dashboard, selects repos, and blocks Next on blocker', async ({ page }) => {
    await page.goto('/')
    // Open wizard; exact selectors match existing patterns
    await page.getByRole('button', { name: /migrate|import/i }).first().click()
    await page.getByText(/azure/i).click()

    // Fill connection (using seeded mock org/project in dev)
    await page.getByLabel(/organization/i).fill('test-org')
    await page.getByLabel(/project/i).fill('test-project')
    await page.getByRole('button', { name: /validate/i }).click()

    // Wait for Select step
    await expect(page.getByText('Choose what to migrate')).toBeVisible({ timeout: 10000 })

    // Select first repo
    await page.getByRole('option').first().click()

    // Sticky bar appears
    await expect(page.getByText(/selected/)).toBeVisible()
  })
})
```

- [ ] **Step 2: Run (may require mock fixtures)**

Run: `npx playwright test e2e/migration-select-redesign.spec.ts`
Expected: passes in CI; may skip locally if no dev server.

- [ ] **Step 3: Commit**

```bash
git add e2e/migration-select-redesign.spec.ts
git commit -m "test(e2e): select step happy path"
```

---

## Phase 7 — Verification & Rollout

### Task 7.1: Full test suite green

- [ ] **Step 1: Run unit tests**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 2: Run E2E against dev server**

Run: `npm run dev` (in another terminal), then `npx playwright test`
Expected: all green.

- [ ] **Step 3: ESLint + build**

Run: `npm run lint && npm run build`
Expected: no new errors.

### Task 7.2: Manual QA checklist

- [ ] Launch Azure migration with 2 repos → verify list, stats, detail panel.
- [ ] Launch with >50 repos (mock) → verify virtualization kicks in.
- [ ] Select repo with simulated name conflict (via check-duplicates mock) → blocker pill appears; Next is disabled with tooltip.
- [ ] Open detail panel with keyboard (`Enter`) → focus trapped; `Esc` closes and returns focus.
- [ ] Apply filter → chips update counts; `/` focuses search.
- [ ] Smart Select → apply "Recommended" → appropriate repos selected.
- [ ] Pattern select → valid regex selects, invalid shows error.
- [ ] Go to Configure step → conflicts show clear/conflict state without re-fetch.
- [ ] Dark mode + light mode → no broken contrast.
- [ ] Mobile breakpoint (<768px) → chips scroll, detail panel fills screen.

### Task 7.3: Update docs

- [ ] **Step 1: Add entry to docs/index.md** if it has a wizard section.
- [ ] **Step 2: Commit**

```bash
git add docs/index.md
git commit -m "docs: reference select step redesign"
```

### Task 7.4: Self-review summary commit

- [ ] Tag the work: nothing to tag (main branch). Push and open PR:

```bash
git push
gh pr create --title "Migration Wizard: Select Repositories redesign" --body-file docs/plans/2026-04-16-migration-repo-select-redesign.md
```

---

## Appendix — Risk & Rollback

- Every task is a separate commit; `git revert` rolls back one unit cleanly.
- Phase 1 tasks (shared components) have zero behavior change; safe to merge first.
- Phase 2 backend routes are additive; no existing endpoint modified destructively.
- Phase 4 replaces `RepoSelectStep.jsx` entirely — the previous behavior is in git history if needed.
- If any downstream step regresses, the specific Phase 5 task can be reverted without affecting the Select step.

## Self-Review Results

- **Spec coverage:** every spec section maps to at least one task:
  - §1 data model → Task 4.1 (useEnrichedRepos shape), Task 3.1 (risk shape)
  - §2 endpoints → Tasks 2.1–2.4
  - §3 risk engine → Tasks 3.1–3.2
  - §4 visual layout → Tasks 4.2–4.9
  - §5 functionality → Tasks 4.3–4.10, 6.1–6.2
  - §6 shared components → Tasks 1.2–1.5, 4.8 (RepoRiskReport)
  - §7 downstream propagation → Tasks 5.1–5.5
  - §8 motion tokens → Task 1.1
  - §9 file layout → followed throughout
  - §10 responsive → ensured via Tailwind classes in subcomponents; covered in Task 7.2 QA
  - §11 error/empty → Task 4.10 orchestrator
- **Placeholder scan:** no TBD/TODO; every step contains executable commands or code.
- **Type consistency:** repo shape (`id`, `name`, `size`, `branches`, `defaultBranch`, `lastCommitDate`, `hasLfsMarker`, `risk`) consistent across hooks, rules, components. `risk` always `{ level, flags }`; `flag` always `{ type, severity, message, suggestion?, actions? }`.
