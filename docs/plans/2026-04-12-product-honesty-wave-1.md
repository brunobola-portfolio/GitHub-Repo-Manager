# Product Honesty Pass — Wave 1: Zero Vaporware

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all disabled / no-op items from the repository context menu by wiring them to real handlers (Dry-Run, Migration Risk, Export Metadata, Sync Repository), clean up two "Coming Soon" placeholder cards in the dashboard, and delete dead code (orphan hooks + `ProgressBar.jsx` + `WelcomeHero.jsx`).

**Architecture:** Reuse everything already in the codebase. Dry-Run and Migration Risk are pure wire-ups to the existing `MigrationWizard`. Export Metadata adds a thin `GET /api/v1/repos/:owner/:repo/export` endpoint that aggregates existing GitHub calls through the shared `githubApi()` helper. Sync Repository uses `simple-git` (already a dependency) plus a new `is_mirror` column on the existing `migration_jobs` table.

**Tech Stack:** React 19, Vite 7, Express 5, better-sqlite3, simple-git, Vitest, Playwright, Tailwind v4, Framer Motion.

**Source spec:** [docs/specs/2026-04-11-product-honesty-pass.md](../specs/2026-04-11-product-honesty-pass.md)

---

## File Structure

### New files
- `server/routes/v1/repos-export.js` — GET `/repos/:owner/:repo/export` endpoint
- `server/routes/v1/repos-sync.js` — POST `/repos/:owner/:repo/sync` endpoint
- `server/migrations/002-migration-jobs-is-mirror.sql` — adds `is_mirror` column
- `server/__tests__/repos-export.test.js` — unit tests for export endpoint
- `server/__tests__/repos-sync.test.js` — unit tests for sync endpoint
- `e2e/context-menu-wave-1.spec.js` — end-to-end tests for all four items

### Modified files
- `server/routes/v1/index.js` — mount two new routers
- `server/db.js` — run new migration on startup
- `server/routes/bulk.js` — mark `is_mirror=1` on mirror/fork operations
- `src/components/RepoContextMenu.jsx` — re-enable 2 items, remove `disabled: true` from `aiRisk`
- `src/components/RepoList.jsx` — wire `dryRun`, `aiRisk`, `exportMeta`, `sync` handlers
- `src/components/MigrationWizard/MigrationWizard.jsx` — accept `initialDryRun` and `initialStep` props
- `src/components/Dashboard/DashboardPremium.jsx` — replace 2 "Coming Soon" EmptyStates with real aggregate widgets or RoadmapPage link
- `src/hooks/useGitHub.js` — extend repo objects with `isMirror` boolean via join
- `src/api/repos.js` — add `exportMetadata()` and `syncMirror()` methods
- `src/hooks/useAI.js` — delete `suggestAI` and `generateReadmeAI` exports

### Deleted files
- `src/components/ui/ProgressBar.jsx` — zero importers
- `src/components/WelcomeHero.jsx` — zero importers

---

## Task 1: Wire Dry-Run to the Migration Wizard

**Files:**
- Modify: `src/components/MigrationWizard/MigrationWizard.jsx` — accept `initialDryRun` prop
- Modify: `src/components/RepoList.jsx` — handler for `dryRun` and `dryRun_selected`
- Test: `e2e/context-menu-wave-1.spec.js` (new file for this whole wave)

- [ ] **Step 1: Create the e2e test file with a failing Dry-Run test**

Create `e2e/context-menu-wave-1.spec.js`:

```js
import { test, expect } from '@playwright/test'

test.describe('Wave 1 — Context menu items', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mock=1')
    await page.waitForSelector('[data-testid="repo-card"]')
  })

  test('Dry-Run opens MigrationWizard with dry-run pill visible', async ({ page }) => {
    const firstCard = page.locator('[data-testid="repo-card"]').first()
    await firstCard.click({ button: 'right' })
    await page.locator('text=Migration').hover()
    await page.locator('text=Dry-Run (Simulate)').click()
    await expect(page.locator('[data-testid="migration-wizard"]')).toBeVisible()
    await expect(page.locator('[data-testid="dry-run-pill"]')).toBeVisible()
    await expect(page.locator('[data-testid="dry-run-pill"]')).toHaveText(/dry.?run/i)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx playwright test e2e/context-menu-wave-1.spec.js --headed=false`
Expected: FAIL — `data-testid="dry-run-pill"` not found (wizard opens but no pill).

- [ ] **Step 3: Add `initialDryRun` prop to MigrationWizard and render dry-run pill**

In `src/components/MigrationWizard/MigrationWizard.jsx`, find the existing `MigrationWizard` function component and extend its props destructure to include `initialDryRun = false`. Set the wizard's local `isDryRun` state from this prop on mount. In the wizard header JSX, add:

```jsx
{isDryRun && (
  <span data-testid="dry-run-pill" className="ds-animate-scale-in inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-900">
    <Zap className="w-3 h-3" />
    Dry-Run Mode
  </span>
)}
```

Import `Zap` from `lucide-react` at the top of the file if not already imported.

- [ ] **Step 4: Wire the `dryRun` action in RepoList**

In `src/components/RepoList.jsx`, find the `handleQuickAction` or equivalent dispatcher. Before the `default:` case, add:

```jsx
case 'dryRun':
  openModalWithData('showMigrationWizard', { targetRepo: data, initialDryRun: true })
  break
case 'dryRun_selected':
  openModalWithData('showMigrationWizard', { targetRepos: data, initialDryRun: true })
  break
```

In `App.jsx` where `<MigrationWizard>` is rendered, pass `initialDryRun={getModalData('showMigrationWizard')?.initialDryRun}` through the props.

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx playwright test e2e/context-menu-wave-1.spec.js -g "Dry-Run"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/MigrationWizard/MigrationWizard.jsx src/components/RepoList.jsx src/App.jsx e2e/context-menu-wave-1.spec.js
git commit -m "feat(migration): wire Dry-Run context menu entry to wizard with pill"
```

---

## Task 2: Wire Migration Risk Analysis shortcut

**Files:**
- Modify: `src/components/RepoContextMenu.jsx` — remove `disabled: true`, remove tooltip
- Modify: `src/components/MigrationWizard/MigrationWizard.jsx` — accept `initialStep` prop
- Modify: `src/components/RepoList.jsx` — handler for `aiRisk`
- Test: append to `e2e/context-menu-wave-1.spec.js`

- [ ] **Step 1: Append the failing test**

Add to `e2e/context-menu-wave-1.spec.js`:

```js
test('Migration Risk Analysis opens wizard directly on AI Review step', async ({ page }) => {
  const firstCard = page.locator('[data-testid="repo-card"]').first()
  await firstCard.click({ button: 'right' })
  await page.locator('text=Migration').hover()
  await page.locator('text=Migration Risk Analysis').click()
  await expect(page.locator('[data-testid="migration-wizard"]')).toBeVisible()
  await expect(page.locator('[data-testid="wizard-step-ai-review"]')).toBeVisible()
})
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npx playwright test e2e/context-menu-wave-1.spec.js -g "Risk Analysis"`
Expected: FAIL — the menu item is disabled (`aria-disabled="true"`) so the click is a no-op.

- [ ] **Step 3: Re-enable the menu item**

In `src/components/RepoContextMenu.jsx` around line 68-73, replace:

```jsx
{
  label: 'Migration Risk Analysis',
  disabled: true,
  tooltip: 'Coming soon — planned for the migration wizard',
  onClick: () => onAction('aiRisk', repo)
}
```

with:

```jsx
{
  label: 'Migration Risk Analysis',
  icon: ShieldAlert,
  onClick: () => onAction('aiRisk', repo)
}
```

Import `ShieldAlert` from `lucide-react` at the top.

- [ ] **Step 4: Accept `initialStep` prop in MigrationWizard**

In `src/components/MigrationWizard/MigrationWizard.jsx`, add `initialStep` to the destructured props. In the wizard's step initialization `useState`, use `initialStep` as the starting value when provided. On the rendered current step container, add `data-testid={\`wizard-step-${currentStep}\`}` so tests can assert which step is showing.

- [ ] **Step 5: Wire the `aiRisk` handler in RepoList**

In `src/components/RepoList.jsx`, add to the dispatcher:

```jsx
case 'aiRisk':
  openModalWithData('showMigrationWizard', { targetRepo: data, initialStep: 'ai-review' })
  break
```

Pass `initialStep={getModalData('showMigrationWizard')?.initialStep}` from `App.jsx`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx playwright test e2e/context-menu-wave-1.spec.js -g "Risk Analysis"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/RepoContextMenu.jsx src/components/MigrationWizard/MigrationWizard.jsx src/components/RepoList.jsx src/App.jsx e2e/context-menu-wave-1.spec.js
git commit -m "feat(migration): enable Migration Risk Analysis shortcut to AI Review step"
```

---

## Task 3: Export Metadata — backend endpoint

**Files:**
- Create: `server/routes/v1/repos-export.js`
- Modify: `server/routes/v1/index.js` — mount router
- Create: `server/__tests__/repos-export.test.js`

- [ ] **Step 1: Write the failing unit test**

Create `server/__tests__/repos-export.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

// Mock the githubApi helper
vi.mock('../lib/github-api.js', () => ({
  githubApi: vi.fn()
}))

// Mock audit log
vi.mock('../lib/audit.js', () => ({
  auditLog: vi.fn().mockResolvedValue(undefined)
}))

import { githubApi } from '../lib/github-api.js'

describe('GET /api/v1/repos/:owner/:repo/export', () => {
  let app
  beforeEach(async () => {
    vi.clearAllMocks()
    app = express()
    // Fake auth middleware
    app.use((req, _res, next) => {
      req.session = { accessToken: 'test-token', user: { login: 'alice' } }
      req.log = { error: vi.fn() }
      next()
    })
    const { default: router } = await import('../routes/v1/repos-export.js')
    app.use('/api/v1', router)
  })

  it('returns an export payload with all expected fields', async () => {
    githubApi.mockImplementation(async (path) => {
      if (path.endsWith('/repos/alice/hello')) return { data: { name: 'hello', default_branch: 'main', stargazers_count: 5 } }
      if (path.endsWith('/topics')) return { data: { names: ['web', 'react'] } }
      if (path.endsWith('/languages')) return { data: { JavaScript: 1000, CSS: 200 } }
      if (path.endsWith('/branches?per_page=100')) return { data: [{ name: 'main' }, { name: 'dev' }] }
      if (path.endsWith('/releases?per_page=30')) return { data: [] }
      return { data: null }
    })

    const res = await request(app).get('/api/v1/repos/alice/hello/export')
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.headers['content-disposition']).toContain('hello-export-')
    const body = JSON.parse(res.text)
    expect(body.schemaVersion).toBe(1)
    expect(body.exportedBy).toBe('alice')
    expect(body.repository.name).toBe('hello')
    expect(body.topics).toEqual(['web', 'react'])
    expect(body.languages).toEqual({ JavaScript: 1000, CSS: 200 })
    expect(body.branches.count).toBe(2)
    expect(body.branches.default).toBe('main')
  })

  it('returns 500 when GitHub API fails', async () => {
    githubApi.mockRejectedValue(Object.assign(new Error('github down'), { status: 502 }))
    const res = await request(app).get('/api/v1/repos/alice/hello/export')
    expect(res.status).toBe(502)
    expect(res.body.error).toContain('github down')
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run server/__tests__/repos-export.test.js`
Expected: FAIL — `Cannot find module '../routes/v1/repos-export.js'`.

- [ ] **Step 3: Create the endpoint**

Create `server/routes/v1/repos-export.js`:

```js
import { Router } from 'express'
import { githubApi } from '../../lib/github-api.js'
import { auditLog } from '../../lib/audit.js'
import { requireAuth } from '../../middleware/auth.js'
import { requireTier } from '../../middleware/require-tier.js'

const router = Router()

router.get('/repos/:owner/:repo/export', requireAuth, requireTier('free'), async (req, res) => {
  const { owner, repo } = req.params
  const token = req.session.accessToken  // requireAuth guarantees this exists
  try {
    const [repoRes, topicsRes, languagesRes, branchesRes, releasesRes] = await Promise.all([
      githubApi(`/repos/${owner}/${repo}`, token),
      githubApi(`/repos/${owner}/${repo}/topics`, token),
      githubApi(`/repos/${owner}/${repo}/languages`, token),
      githubApi(`/repos/${owner}/${repo}/branches?per_page=100`, token),
      githubApi(`/repos/${owner}/${repo}/releases?per_page=30`, token)
    ])
    const payload = {
      exportedAt: new Date().toISOString(),
      exportedBy: req.session.user?.login || null,
      schemaVersion: 1,
      repository: repoRes.data,
      topics: topicsRes.data?.names || [],
      languages: languagesRes.data || {},
      branches: {
        count: Array.isArray(branchesRes.data) ? branchesRes.data.length : 0,
        default: repoRes.data?.default_branch || null
      },
      releases: releasesRes.data || []
    }
    const body = JSON.stringify(payload, null, 2)
    auditLog(req, 'repo.export', 'repo', `${owner}/${repo}`, { size: body.length })
    const safeRepo = repo.replace(/[^\w.-]/g, '_').slice(0, 100)
    res.setHeader('Content-Disposition', `attachment; filename="${safeRepo}-export-${Date.now()}.json"`)
    res.setHeader('Content-Type', 'application/json')
    res.send(body)
  } catch (err) {
    req.log.error({ err, owner, repo }, 'repo export failed')
    res.status(err.status || 500).json({ error: err.message || 'Export failed' })
  }
})

export default router
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run server/__tests__/repos-export.test.js`
Expected: PASS both test cases.

- [ ] **Step 5: Mount the router in v1**

In `server/routes/v1/index.js`, add near the other `import` lines:

```js
import reposExportRouter from './repos-export.js'
```

And near the other `router.use` calls:

```js
router.use(reposExportRouter)
```

- [ ] **Step 6: Commit**

```bash
git add server/routes/v1/repos-export.js server/routes/v1/index.js server/__tests__/repos-export.test.js
git commit -m "feat(api): add GET /api/v1/repos/:owner/:repo/export endpoint"
```

---

## Task 4: Export Metadata — frontend wiring

**Files:**
- Modify: `src/api/repos.js` — add `exportMetadata()` method
- Modify: `src/components/RepoList.jsx` — handler for `exportMeta`
- Test: append to `e2e/context-menu-wave-1.spec.js`

- [ ] **Step 1: Append the failing e2e test**

Add to `e2e/context-menu-wave-1.spec.js`:

```js
test('Export Metadata triggers a JSON file download', async ({ page }) => {
  const firstCard = page.locator('[data-testid="repo-card"]').first()
  await firstCard.click({ button: 'right' })
  await page.locator('text=Management').hover()
  const downloadPromise = page.waitForEvent('download')
  await page.locator('text=Export Metadata (JSON)').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/-export-\d+\.json$/)
})
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx playwright test e2e/context-menu-wave-1.spec.js -g "Export Metadata"`
Expected: FAIL — no download event occurs (the menu item falls into the `default` case).

- [ ] **Step 3: Add `exportMetadata` method to the repos API module**

In `src/api/repos.js`, add to the exported `reposApi` object (or equivalent):

```js
exportMetadata: async (owner, repo) => {
  const res = await fetch(`/api/v1/repos/${owner}/${repo}/export`, {
    method: 'GET',
    credentials: 'include'
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Export failed' }))
    throw new Error(err.error || 'Export failed')
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const cd = res.headers.get('content-disposition') || ''
  const match = cd.match(/filename="(.+?)"/)
  a.download = match ? match[1] : `${repo}-export.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return { filename: a.download }
}
```

- [ ] **Step 4: Wire the `exportMeta` handler in RepoList**

In `src/components/RepoList.jsx`, add to the dispatcher (import `reposApi` and `toast` if needed):

```jsx
case 'exportMeta':
  try {
    const result = await reposApi.exportMetadata(data.owner.login, data.name)
    toast.success(`Exported ${result.filename}`)
  } catch (err) {
    toast.error(`Export failed: ${err.message}`)
  }
  break
case 'exportMeta_selected':
  for (const repo of data) {
    try {
      await reposApi.exportMetadata(repo.owner.login, repo.name)
    } catch (err) {
      toast.error(`Export failed for ${repo.name}: ${err.message}`)
    }
  }
  toast.success(`Exported ${data.length} repositories`)
  break
```

Make sure the containing handler is `async`.

- [ ] **Step 5: Run the test, confirm it passes**

Run: `npx playwright test e2e/context-menu-wave-1.spec.js -g "Export Metadata"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/repos.js src/components/RepoList.jsx e2e/context-menu-wave-1.spec.js
git commit -m "feat(repos): wire Export Metadata context menu to download handler"
```

---

## Task 5: Sync Repository — schema migration

**Files:**
- Create: `server/migrations/002-migration-jobs-is-mirror.sql`
- Modify: `server/db.js` — run the new migration on startup
- Modify: `server/routes/bulk.js` — set `is_mirror=1` on mirror/fork operations

- [ ] **Step 1: Create the migration file**

Create `server/migrations/002-migration-jobs-is-mirror.sql`:

```sql
-- Add is_mirror flag and index to migration_jobs
ALTER TABLE migration_jobs ADD COLUMN is_mirror INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_migration_jobs_mirror
  ON migration_jobs(target_owner, target_repo, is_mirror);
```

- [ ] **Step 2: Wire the migration into db initialization**

In `server/db.js`, locate the existing migration-loading block (searches for `001-initial-schema.sql`). Immediately after it, add:

```js
try {
  const migration002 = readFileSync(join(migrationsDir, '002-migration-jobs-is-mirror.sql'), 'utf8')
  db.exec(migration002)
} catch (err) {
  // SQLite ALTER TABLE ADD COLUMN is idempotent only if we guard with a check.
  // If column already exists, we get "duplicate column name" — safe to ignore.
  if (!err.message?.includes('duplicate column')) throw err
}
```

If `readFileSync` and `join` are not imported in `server/db.js`, add them from `fs` and `path`.

- [ ] **Step 3: Write a unit test verifying the column exists**

Create `server/__tests__/migration-002.test.js`:

```js
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('migration 002 — migration_jobs.is_mirror', () => {
  it('adds the is_mirror column and index', () => {
    const db = new Database(':memory:')
    db.exec(readFileSync(join(__dirname, '../migrations/001-initial-schema.sql'), 'utf8'))
    db.exec(readFileSync(join(__dirname, '../migrations/002-migration-jobs-is-mirror.sql'), 'utf8'))
    const cols = db.prepare(`PRAGMA table_info(migration_jobs)`).all()
    const isMirrorCol = cols.find(c => c.name === 'is_mirror')
    expect(isMirrorCol).toBeDefined()
    expect(isMirrorCol.type).toBe('INTEGER')
    const indexes = db.prepare(`PRAGMA index_list(migration_jobs)`).all()
    expect(indexes.some(i => i.name === 'idx_migration_jobs_mirror')).toBe(true)
  })
})
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run server/__tests__/migration-002.test.js`
Expected: PASS.

- [ ] **Step 5: Mark new mirror/fork operations as is_mirror=1**

In `server/routes/bulk.js`, find the mirror/fork endpoint (around line 204, the `/api/mirror` handler). After the successful GitHub API call that creates the fork, insert a row into `migration_jobs` with `is_mirror=1` (or update an existing row if the bulk flow already writes to the table). The exact INSERT depends on what columns are required:

```js
db.prepare(`
  INSERT INTO migration_jobs
    (user_id, source_type, source_url, source_name, target_owner, target_repo, target_full_name, status, is_mirror, completed_at)
  VALUES (?, 'github-mirror', ?, ?, ?, ?, ?, 'completed', 1, CURRENT_TIMESTAMP)
`).run(
  req.session.user.id,
  sourceRepo.html_url,
  sourceRepo.full_name,
  targetOwner,
  targetRepo,
  `${targetOwner}/${targetRepo}`
)
```

Use the exact user id column name the existing migration_jobs rows use (verify by grepping existing inserts in `server/routes/import.js`).

- [ ] **Step 6: Commit**

```bash
git add server/migrations/002-migration-jobs-is-mirror.sql server/db.js server/routes/bulk.js server/__tests__/migration-002.test.js
git commit -m "feat(db): add is_mirror column to migration_jobs + track mirror operations"
```

---

## Task 6: Sync Repository — backend endpoint

**Files:**
- Create: `server/routes/v1/repos-sync.js`
- Modify: `server/routes/v1/index.js` — mount router
- Create: `server/__tests__/repos-sync.test.js`

- [ ] **Step 1: Write the failing unit test**

Create `server/__tests__/repos-sync.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('simple-git', () => ({
  default: vi.fn(() => ({
    clone: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined)
  }))
}))

vi.mock('../lib/audit.js', () => ({
  auditLog: vi.fn()
}))

const mockDbGet = vi.fn()
vi.mock('../db.js', () => ({
  default: {
    prepare: vi.fn(() => ({ get: mockDbGet }))
  }
}))

// Mock middlewares as passthrough (happy path; real auth tested separately)
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    if (!req.session?.accessToken) return res.status(401).json({ error: 'Session expired. Please login again.' })
    next()
  }
}))

vi.mock('../middleware/require-tier.js', () => ({
  requireTier: () => (req, _res, next) => next()
}))

describe('POST /api/v1/repos/:owner/:repo/sync', () => {
  let app
  beforeEach(async () => {
    vi.clearAllMocks()
    app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      req.session = { accessToken: 'tok', user: { id: 1, login: 'alice' } }
      req.log = { error: vi.fn() }
      next()
    })
    const { default: router } = await import('../routes/v1/repos-sync.js')
    app.use('/api/v1', router)
  })

  it('syncs a tracked mirror and returns syncedAt timestamp', async () => {
    mockDbGet.mockReturnValue({ source_url: 'https://github.com/other/repo.git' })
    const res = await request(app).post('/api/v1/repos/alice/hello/sync')
    expect(res.status).toBe(200)
    expect(res.body.syncedAt).toBeDefined()
    expect(res.body.sourceUrl).toBe('https://github.com/other/repo.git')
  })

  it('returns 404 when repo is not a tracked mirror', async () => {
    mockDbGet.mockReturnValue(undefined)
    const res = await request(app).post('/api/v1/repos/alice/hello/sync')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not a tracked mirror/i)
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx vitest run server/__tests__/repos-sync.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the sync endpoint**

Create `server/routes/v1/repos-sync.js`:

```js
import { Router } from 'express'
import simpleGit from 'simple-git'
import { tmpdir } from 'os'
import { join } from 'path'
import { rm, mkdtemp } from 'fs/promises'
import db from '../../db.js'
import { auditLog } from '../../lib/audit.js'
import { requireAuth } from '../../middleware/auth.js'
import { requireTier } from '../../middleware/require-tier.js'

const router = Router()

router.post('/repos/:owner/:repo/sync', requireAuth, requireTier('pro'), async (req, res) => {
  const { owner, repo } = req.params
  const token = req.session.accessToken  // requireAuth guarantees this exists
  const job = db.prepare(
    `SELECT source_url FROM migration_jobs
     WHERE target_owner=? AND target_repo=? AND is_mirror=1
     ORDER BY id DESC LIMIT 1`
  ).get(owner, repo)
  if (!job) return res.status(404).json({ error: 'Not a tracked mirror' })

  const workDir = await mkdtemp(join(tmpdir(), 'grm-sync-'))
  const startedAt = Date.now()
  try {
    const git = simpleGit(workDir)
    await git.clone(job.source_url, '.', ['--mirror'])
    const targetUrl = `https://${token}@github.com/${owner}/${repo}.git`
    await git.push(targetUrl, '--mirror')
    const duration = Date.now() - startedAt
    auditLog(req, 'repo.sync', 'repo', `${owner}/${repo}`, {
      sourceUrl: job.source_url,
      duration
    })
    res.json({
      syncedAt: new Date().toISOString(),
      duration,
      sourceUrl: job.source_url
    })
  } catch (err) {
    req.log.error({ err, owner, repo }, 'mirror sync failed')
    res.status(500).json({ error: err.message || 'Sync failed' })
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
})

export default router
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run server/__tests__/repos-sync.test.js`
Expected: PASS both cases.

- [ ] **Step 5: Mount the router**

In `server/routes/v1/index.js`, add:

```js
import reposSyncRouter from './repos-sync.js'
// ... later ...
router.use(reposSyncRouter)
```

- [ ] **Step 6: Commit**

```bash
git add server/routes/v1/repos-sync.js server/routes/v1/index.js server/__tests__/repos-sync.test.js
git commit -m "feat(api): add POST /api/v1/repos/:owner/:repo/sync endpoint"
```

---

## Task 7: Sync Repository — frontend wiring + isMirror flag in repo object

**Files:**
- Modify: `src/hooks/useGitHub.js` — extend repo objects with `isMirror`
- Modify: `src/api/repos.js` — add `syncMirror()` method
- Modify: `src/components/RepoContextMenu.jsx` — conditional `disabled` based on `repo.isMirror`
- Modify: `src/components/RepoList.jsx` — handler for `sync`
- Test: append to `e2e/context-menu-wave-1.spec.js`

- [ ] **Step 1: Add isMirror join to the repos API backend**

First, the frontend needs to know which repos are mirrors. The simplest approach is to add it to the existing `/api/repos` response. In `server/routes/repos.js`, find the main repo-list endpoint and after shaping the response for each repo, add:

```js
const mirrorMap = new Map()
const mirrorRows = db.prepare(`
  SELECT target_owner, target_repo FROM migration_jobs
  WHERE user_id=? AND is_mirror=1
`).all(req.session.user.id)
for (const row of mirrorRows) {
  mirrorMap.set(`${row.target_owner}/${row.target_repo}`, true)
}
// then, for each repo being returned:
repo.isMirror = mirrorMap.has(repo.full_name) || false
```

- [ ] **Step 2: Add `syncMirror` to the repos API module**

In `src/api/repos.js`:

```js
syncMirror: async (owner, repo) => {
  const res = await fetch(`/api/v1/repos/${owner}/${repo}/sync`, {
    method: 'POST',
    credentials: 'include'
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Sync failed' }))
    throw new Error(err.error || 'Sync failed')
  }
  return res.json()
}
```

- [ ] **Step 3: Make the Sync menu item conditional**

In `src/components/RepoContextMenu.jsx` around line 94, replace:

```jsx
{
  label: 'Sync Repository',
  disabled: true,
  tooltip: 'Only available for mirrored repos',
  onClick: () => onAction('sync', repo)
}
```

with:

```jsx
{
  label: 'Sync Repository',
  icon: RefreshCw,
  disabled: !repo.isMirror,
  tooltip: repo.isMirror ? null : 'Only available for mirrored repos',
  onClick: () => onAction('sync', repo)
}
```

Import `RefreshCw` from `lucide-react` at the top if not present.

- [ ] **Step 4: Wire the `sync` handler in RepoList**

In `src/components/RepoList.jsx`:

```jsx
case 'sync':
  openModalWithData('showConfirm', {
    title: 'Sync Mirror',
    message: `Fetch latest changes from ${data.full_name}'s mirror source and force-push to the target?`,
    confirmLabel: 'Sync',
    onConfirm: async () => {
      try {
        const result = await reposApi.syncMirror(data.owner.login, data.name)
        toast.success(`Synced in ${Math.round(result.duration / 1000)}s`)
      } catch (err) {
        toast.error(`Sync failed: ${err.message}`)
      }
    }
  })
  break
```

- [ ] **Step 5: Append the e2e test**

Add to `e2e/context-menu-wave-1.spec.js`:

```js
test('Sync Repository is disabled for non-mirror repos', async ({ page }) => {
  const firstCard = page.locator('[data-testid="repo-card"]').first()
  await firstCard.click({ button: 'right' })
  await page.locator('text=Management').hover()
  const syncItem = page.locator('[data-testid="menu-item-sync"]')
  await expect(syncItem).toHaveAttribute('aria-disabled', 'true')
})
```

For this to work, add `data-testid={\`menu-item-${id}\`}` to menu items in `RepoContextMenu.jsx` where `id` is derived from the action name or a new `id` field on each menu item.

- [ ] **Step 6: Run the test, confirm it passes**

Run: `npx playwright test e2e/context-menu-wave-1.spec.js -g "Sync"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useGitHub.js src/api/repos.js src/components/RepoContextMenu.jsx src/components/RepoList.jsx server/routes/repos.js e2e/context-menu-wave-1.spec.js
git commit -m "feat(repos): conditional Sync Repository menu + isMirror flag + handler"
```

---

## Task 8: Dashboard — replace "Coming Soon" placeholders

**Files:**
- Modify: `src/components/Dashboard/DashboardPremium.jsx` — replace 2 EmptyStates

The minimum-risk approach is to replace the two placeholder cards with links to the new Roadmap page (introduced in Wave 3). For Wave 1 we introduce a temporary direct link to `/roadmap` (the route will exist by the time Wave 3 ships; until then, the link can 404 gracefully — but the placeholder text is no longer "Coming Soon"). Alternatively, remove the cards entirely from Wave 1.

- [ ] **Step 1: Remove the two placeholder cards**

In `src/components/Dashboard/DashboardPremium.jsx`, locate the two `<EmptyState>` blocks at lines ~198-204 and ~223-229 (search for "Pull Request Analytics Coming Soon" and "GitHub Actions Dashboard Coming Soon"). Delete both blocks entirely. If the surrounding grid has exactly the placeholder cards as its only children, remove the grid section as well to avoid an empty layout.

- [ ] **Step 2: Manual visual verification**

Run: `npm run dev`
Expected: Dashboard renders without any "Coming Soon" text. Remaining widgets keep their layout.

- [ ] **Step 3: Commit**

```bash
git add src/components/Dashboard/DashboardPremium.jsx
git commit -m "chore(dashboard): remove Coming Soon placeholder cards"
```

---

## Task 9: Delete orphan code

**Files:**
- Delete: `src/components/ui/ProgressBar.jsx`
- Delete: `src/components/WelcomeHero.jsx`
- Modify: `src/hooks/useAI.js` — remove orphan hook exports

- [ ] **Step 1: Verify `ProgressBar.jsx` has zero importers**

Run: `Grep --pattern "ui/ProgressBar" --path src`
Expected: No matches (other than `ProgressBar.jsx` itself).

- [ ] **Step 2: Delete `ProgressBar.jsx`**

Run: `rm "src/components/ui/ProgressBar.jsx"`

- [ ] **Step 3: Verify `WelcomeHero.jsx` has zero importers**

Run: `Grep --pattern "WelcomeHero" --path src --type jsx`
Expected: Only self-reference in `WelcomeHero.jsx`.

- [ ] **Step 4: Delete `WelcomeHero.jsx`**

Run: `rm "src/components/WelcomeHero.jsx"`

- [ ] **Step 5: Delete orphan hooks from `useAI.js`**

In `src/hooks/useAI.js`, delete:
- The `suggestAI` function (lines ~66-91)
- The `generateReadmeAI` function (lines ~98-116)
- Any references to these inside the returned object of the `useAI` hook

Verify: `Grep --pattern "suggestAI|generateReadmeAI" --path src`
Expected: No matches.

- [ ] **Step 6: Run build and tests to catch regressions**

Run: `npm run build && npx vitest run && npx playwright test e2e/context-menu-wave-1.spec.js`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add -u src/components/ui/ProgressBar.jsx src/components/WelcomeHero.jsx src/hooks/useAI.js
git commit -m "chore: delete orphan ProgressBar, WelcomeHero, and unused AI hooks"
```

---

## Self-review checklist

Before declaring Wave 1 complete:

- [ ] All 4 context menu items (Dry-Run, Migration Risk, Export Metadata, Sync) are wired and functional in the real UI
- [ ] Zero menu items have `disabled: true` with a "Coming Soon" tooltip
- [ ] Dashboard no longer shows any "Coming Soon" text
- [ ] `grep -r "ProgressBar" src/components/ui` returns no results
- [ ] `grep -r "WelcomeHero" src` returns no results
- [ ] `grep -r "suggestAI\|generateReadmeAI" src` returns no results
- [ ] `npx vitest run server/__tests__/repos-export.test.js server/__tests__/repos-sync.test.js server/__tests__/migration-002.test.js` passes
- [ ] `npx playwright test e2e/context-menu-wave-1.spec.js` passes all 4 tests
- [ ] `npm run build` succeeds without warnings about unused imports
- [ ] Manual smoke test: open app, right-click a repo, confirm each of the 4 items works end-to-end
