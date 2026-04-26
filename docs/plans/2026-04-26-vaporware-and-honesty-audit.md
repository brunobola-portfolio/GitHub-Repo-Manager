# Vaporware & Honesty Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate mock-data leakage into production builds, unify error and quota UX so the app never shows fake or unhelpful messaging, and gate the result with a CI honesty test.

**Architecture:** Move mock generators to `src/__mocks__/` with dual guards (`import.meta.env.DEV && VITE_MOCK_MODE`) so Vite tree-shakes the code out of production bundles. Add `formatUserError()` helper for uniform toast/banner error shape. Add `quotaErrorPayload()` / `tierRequiredPayload()` server helpers + `<QuotaExceededState />` frontend component for tier-specific CTAs. Verify with a build-time grep test plus a zero-config Playwright spec.

**Tech Stack:** React 19, Vite 7, Tailwind v4, Vitest, Playwright, Express, better-sqlite3.

**Spec:** [docs/specs/2026-04-26-vaporware-and-honesty-audit.md](../specs/2026-04-26-vaporware-and-honesty-audit.md)

---

## File Structure

**Create:**
- `src/__mocks__/mockRepos.js` — moved from `useRepos.js:24-74`
- `src/__mocks__/mockOrgs.js` — moved from `useOrgs.js:21-46` + `useOrgs.js:48-117`
- `src/__mocks__/mockWorkBoard.js` — moved from `useWorkBoard.js:134-180`
- `src/__mocks__/mockAI.js` — moved from `api/ai.js:65-121`
- `src/utils/errors.js` — `formatUserError()` helper + known-error map
- `src/components/ui/QuotaExceededState.jsx` — tier-aware quota CTA primitive
- `tests/utils/errors.test.js`
- `tests/components/ui/QuotaExceededState.test.jsx`
- `tests/__mocks__/generators.test.js` — single regression test covering all four generators
- `tests/build/build-honesty.test.js` — opt-in slow build inspection (gated by `RUN_BUILD_TESTS=1`)
- `e2e/zero-config-honesty.spec.js`

**Modify:**
- `src/hooks/useRepos.js` — guarded mock import + EmptyState branches
- `src/hooks/useOrgs.js` — guarded mock import + EmptyState branches
- `src/hooks/useWorkBoard.js` — guarded mock import + empty arrays when no data
- `src/api/ai.js` — guarded mock import (replace inline `mockAnalysis` etc.)
- `src/components/AI/AINotConfiguredBanner.jsx` — comment cleanup (line 24)
- `src/components/LicenseBadge.jsx` — comment cleanup (lines 115-118)
- `src/components/ui/EmptyState.jsx` — add `data-testid="empty-state"`
- `src/components/ui/Toast.jsx` — extend with `errorFromException(err, ctx)` static helper
- `src/App.jsx` — error toast sweep (8 callsites at L406, 431, 451, 479, 497, 516, 1031, 1045)
- `src/components/RepoList/index.jsx` — error toast sweep (3 callsites at L237, 249, 265)
- `src/components/Admin/AdminDLQPage.jsx` — error toast sweep (3 callsites at L118, 134, 148)
- `src/components/DevToolkit/ReviewTab/QuickActions.jsx` — 1 callsite at L29
- Remaining 15-20 toast callsites in `src/components/**/*.jsx` — individual fixes (Task 11)
- `server/lib/usage-meter.js` — append `quotaErrorPayload()` + `tierRequiredPayload()`
- `server/routes/ai/core.js`, `indexing.js`, `migration.js`, `dev-toolkit.js`, `shared.js` — 429/403 callsites use new helpers
- `eslint.config.js` (or `.eslintrc.cjs`) — add `no-restricted-syntax` rule for `.stack` access
- `vitest.config.js` — exclude `tests/build/` from default fast suite
- `.github/workflows/ci.yml` — add `RUN_BUILD_TESTS=1` step

---

## Wave 1 — Mock Elimination

### Task 1: Add `data-testid` to EmptyState

**Files:**
- Modify: `src/components/ui/EmptyState.jsx:30-36`
- Test: `tests/components/ui/EmptyState.test.jsx` (existing, extend if exists; create if absent)

- [ ] **Step 1: Write the failing test**

```jsx
// tests/components/ui/EmptyState.test.jsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Bird } from 'lucide-react'
import { EmptyState } from '../../../src/components/ui/EmptyState'

describe('EmptyState', () => {
  it('exposes data-testid="empty-state" for e2e selectors', () => {
    render(<EmptyState icon={Bird} title="Nothing yet" description="Try again." />)
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ui/EmptyState.test.jsx`
Expected: FAIL with "Unable to find an element by: [data-testid='empty-state']"

- [ ] **Step 3: Add the testid attribute**

```jsx
// src/components/ui/EmptyState.jsx — modify the outer motion.div
<motion.div
  data-testid="empty-state"
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.5 }}
  className="flex flex-col items-center justify-center p-12 text-center"
>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ui/EmptyState.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/EmptyState.jsx tests/components/ui/EmptyState.test.jsx
git commit -m "test(ui): add data-testid hook to EmptyState"
```

---

### Task 2: Move mock repo generator to `__mocks__/mockRepos.js`

**Files:**
- Create: `src/__mocks__/mockRepos.js`
- Modify: `src/hooks/useRepos.js:24-74, 94-103`
- Test: `tests/__mocks__/generators.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/__mocks__/generators.test.js
import { describe, it, expect } from 'vitest'
import { generateMockRepos } from '../../src/__mocks__/mockRepos.js'

describe('mockRepos generator', () => {
  it('returns the requested page size', () => {
    const { repos, totalPages } = generateMockRepos(1, 10)
    expect(repos).toHaveLength(10)
    expect(totalPages).toBeGreaterThan(0)
    expect(repos[0]).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
      full_name: expect.stringContaining('dev-user/'),
      owner: { login: 'dev-user' },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/__mocks__/generators.test.js`
Expected: FAIL with "Failed to resolve import"

- [ ] **Step 3: Create the mock module**

```js
// src/__mocks__/mockRepos.js
// Mock data generators — DEV ONLY.
// Imported via dynamic import() guarded by import.meta.env.DEV.
// Vite's dead-code elimination drops the entire import branch in
// production builds, so no string from this file ships to dist/.

const TEMPLATES = [
  { name: 'fintech-dashboard', lang: 'TypeScript', desc: 'Real-time financial markets dashboard with charts' },
  { name: 'ai-analytics-platform', lang: 'Python', desc: 'ML-driven analytics platform for SaaS metrics' },
  { name: 'react-component-library', lang: 'TypeScript', desc: 'Internal React component library used across products' },
  { name: 'serverless-api-gateway', lang: 'Go', desc: 'High-throughput API gateway running on Cloudflare Workers' },
  { name: 'mobile-app-flutter', lang: 'Dart', desc: 'Cross-platform mobile app for B2B logistics' },
  { name: 'design-system-tokens', lang: 'CSS', desc: 'Design tokens and assets for the corporate brand identity' },
  { name: 'devops-ci-templates', lang: 'YAML', desc: 'Standardized GitHub Actions workflows for all teams' },
  { name: 'nlp-chatbot-engine', lang: 'Python', desc: 'Natural Language Processing engine for customer support bots' },
  { name: 'web-assembly-video-editor', lang: 'C++', desc: 'Browser-based video editing core using WASM' },
  { name: 'marketing-landing-pages', lang: 'HTML', desc: 'High-conversion landing pages for marketing campaigns' },
]

export function generateMockRepos(page, perPage) {
  const totalRepos = 87
  const totalPages = Math.ceil(totalRepos / perPage)
  const startIndex = (page - 1) * perPage
  const endIndex = Math.min(startIndex + perPage, totalRepos)
  const repos = []
  for (let i = startIndex; i < endIndex; i++) {
    const template = TEMPLATES[i % TEMPLATES.length]
    const suffix = Math.floor(i / TEMPLATES.length) > 0 ? `-${Math.floor(i / TEMPLATES.length) + 1}` : ''
    repos.push({
      id: i + 1,
      name: `${template.name}${suffix}`,
      full_name: `dev-user/${template.name}${suffix}`,
      description: template.desc,
      fork: i % 5 === 0,
      private: i % 3 === 0,
      owner: { login: 'dev-user' },
      html_url: `https://github.com/dev-user/${template.name}${suffix}`,
      updated_at: new Date(Date.now() - i * 3600000 * (Math.random() * 10)).toISOString(),
      stargazers_count: Math.floor(Math.random() * 500) + (i * 10),
      language: template.lang,
      topics: ['react', 'typescript', 'dashboard', 'ui', 'finance'].slice(0, Math.floor(Math.random() * 5)),
    })
  }
  return { repos, totalPages }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/__mocks__/generators.test.js`
Expected: PASS

- [ ] **Step 5: Replace the inline generator in useRepos.js**

```js
// src/hooks/useRepos.js — DELETE lines 19-74 (the entire generateMockData function).
// Then change the MOCK_MODE useEffect (currently around line 95-103) to:

useEffect(() => {
  if (!(import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true')) return
  let cancelled = false
  ;(async () => {
    const { generateMockRepos } = await import('../__mocks__/mockRepos.js')
    if (cancelled) return
    const { repos: mockRepos, totalPages: mockTotalPages } = generateMockRepos(1, perPage)
    setRepos(mockRepos)
    setTotalPages(mockTotalPages)
    setLoading(false)
  })()
  return () => { cancelled = true }
}, [perPage])
```

Verify the rest of `useRepos.js` no longer references `generateMockData` or any of the deleted module-level constants. The exported `MOCK_MODE` import from `../config` stays untouched.

- [ ] **Step 6: Run the existing useRepos test suite**

Run: `npx vitest run tests/hooks/useRepos`
Expected: PASS (any tests that depend on synchronous mock loading need to be updated to `await waitFor(...)` — fix inline if any fail).

- [ ] **Step 7: Commit**

```bash
git add src/__mocks__/mockRepos.js src/hooks/useRepos.js tests/__mocks__/generators.test.js
git commit -m "refactor(mocks): move repo mock generator behind dev-only guard"
```

---

### Task 3: Move mock orgs generator to `__mocks__/mockOrgs.js`

**Files:**
- Create: `src/__mocks__/mockOrgs.js`
- Modify: `src/hooks/useOrgs.js:21-46, 48-117` (and any other mock blocks)
- Test: `tests/__mocks__/generators.test.js` (extend)

- [ ] **Step 1: Read the entire useOrgs.js to find all mock blocks**

Run: `npx vitest run tests/__mocks__/generators.test.js` first as baseline (Task 2 should pass).

Then open `src/hooks/useOrgs.js` and grep for `Math.random` and "mock" to find all generators (the activity feed at L21-46 and the org-repos generator around L100-120, plus any inline `MOCK_MODE` branches).

- [ ] **Step 2: Extend the failing test**

```js
// tests/__mocks__/generators.test.js — append
import { generateMockActivity, generateMockOrgRepos } from '../../src/__mocks__/mockOrgs.js'

describe('mockOrgs generators', () => {
  it('generateMockActivity returns 15 events sorted newest first', () => {
    const events = generateMockActivity()
    expect(events).toHaveLength(15)
    for (let i = 1; i < events.length; i++) {
      expect(new Date(events[i - 1].created_at).getTime())
        .toBeGreaterThanOrEqual(new Date(events[i].created_at).getTime())
    }
  })

  it('generateMockOrgRepos returns repos for a given org', () => {
    const repos = generateMockOrgRepos('acme', 5)
    expect(repos).toHaveLength(5)
    expect(repos[0].full_name).toContain('acme/')
  })
})
```

- [ ] **Step 3: Verify it fails**

Run: `npx vitest run tests/__mocks__/generators.test.js`
Expected: FAIL with "Failed to resolve import"

- [ ] **Step 4: Create the mock module**

```js
// src/__mocks__/mockOrgs.js
// Mock data generators — DEV ONLY (see mockRepos.js header).

const ACTIONS = ['PushEvent', 'PullRequestEvent', 'IssuesEvent', 'CreateEvent', 'WatchEvent']
const REPOS = ['fintech-dashboard', 'ai-analytics-platform', 'react-component-library', 'serverless-api-gateway', 'mobile-app-flutter']

export function generateMockActivity() {
  return Array.from({ length: 15 }, (_, i) => {
    const type = ACTIONS[Math.floor(Math.random() * ACTIONS.length)]
    const repoName = REPOS[Math.floor(Math.random() * REPOS.length)]
    const timeOffset = Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 3)
    return {
      id: `evt-${i}`,
      type,
      actor: { login: 'dev-user', avatar_url: 'https://github.com/ghost.png' },
      repo: { name: `dev-user/${repoName}` },
      created_at: new Date(Date.now() - timeOffset).toISOString(),
      payload: {
        commits: type === 'PushEvent' ? [{ message: 'feat: Add new dashboard widgets' }, { message: 'fix: Resolve memory leak in data processor' }] : [],
        action: type === 'PullRequestEvent' ? 'opened' : (type === 'IssuesEvent' ? 'opened' : null),
        issue: type === 'IssuesEvent' ? { title: 'Bug: Login fails on mobile devices', number: 42 } : null,
        pull_request: type === 'PullRequestEvent' ? { title: 'Feat: Implement Dark Mode Support', number: 101 } : null,
        ref_type: type === 'CreateEvent' ? 'branch' : null,
        ref: type === 'CreateEvent' ? 'feature/new-ui-components' : null,
      },
    }
  }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

export function generateMockOrgRepos(orgLogin, count = 5) {
  return Array.from({ length: count }, (_, i) => ({
    id: 1000 + i,
    name: `${orgLogin}-service-${i + 1}`,
    full_name: `${orgLogin}/${orgLogin}-service-${i + 1}`,
    description: `${orgLogin} service ${i + 1}`,
    private: i % 2 === 0,
    owner: { login: orgLogin },
    html_url: `https://github.com/${orgLogin}/${orgLogin}-service-${i + 1}`,
    updated_at: new Date(Date.now() - i * 86400000).toISOString(),
    stargazers_count: Math.floor(Math.random() * 500),
    language: ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust'][i % 5],
  }))
}
```

- [ ] **Step 5: Replace inline generators in useOrgs.js**

Delete the `generateMockActivity` function (L21-46) and any inline org-repos generator. Replace any synchronous `MOCK_MODE` branch with the guarded async pattern from Task 2 step 5. Same shape:

```js
useEffect(() => {
  if (!(import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true')) return
  let cancelled = false
  ;(async () => {
    const { generateMockActivity } = await import('../__mocks__/mockOrgs.js')
    if (cancelled) return
    setActivity(generateMockActivity())
  })()
  return () => { cancelled = true }
}, [])
```

The non-MOCK_MODE branch must end in honest empty state — `setActivity([])` and let the consumer render its EmptyState.

- [ ] **Step 6: Verify tests pass**

Run: `npx vitest run tests/__mocks__/generators.test.js tests/hooks/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/__mocks__/mockOrgs.js src/hooks/useOrgs.js tests/__mocks__/generators.test.js
git commit -m "refactor(mocks): move org mock generators behind dev-only guard"
```

---

### Task 4: Move mock work-board generators to `__mocks__/mockWorkBoard.js`

**Files:**
- Create: `src/__mocks__/mockWorkBoard.js`
- Modify: `src/hooks/useWorkBoard.js:134-180` (and any other MOCK blocks)
- Test: `tests/__mocks__/generators.test.js` (extend)

- [ ] **Step 1: Map every mock block in useWorkBoard.js**

The mocks live in a contiguous "Synthetic mock data" section starting at L133. Confirmed contents: `MOCK_REVIEWS` (5 items), `MOCK_STALE_PRS` (10 items via Array.from), `MOCK_ISSUES` (3 items), `makeMockDORA()`, `getMockDORA()` cached singleton. Plus any `if (MOCK_MODE)` branches that consume them — grep `MOCK_MODE` in the file.

- [ ] **Step 2: Extend the test**

```js
// tests/__mocks__/generators.test.js — append
import { mockWorkBoardData } from '../../src/__mocks__/mockWorkBoard.js'

describe('mockWorkBoard generator', () => {
  it('returns reviews, stalePRs, issues, and dora arrays/objects', () => {
    const data = mockWorkBoardData()
    expect(data.reviews.length).toBeGreaterThan(0)
    expect(data.stalePRs.length).toBeGreaterThan(0)
    expect(data.issues.length).toBeGreaterThan(0)
    expect(data.dora.perDay).toHaveLength(30)
  })
})
```

- [ ] **Step 3: Verify it fails**

Run: `npx vitest run tests/__mocks__/generators.test.js`
Expected: FAIL with "Failed to resolve import"

- [ ] **Step 4: Create the mock module**

```js
// src/__mocks__/mockWorkBoard.js
// Mock data generators — DEV ONLY (see mockRepos.js header).

const REVIEWS = [
  { repoFullName: 'acme/backend', prNumber: 142, title: 'Add rate limiting to /api/auth', authorLogin: 'alice', requestedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), ageHours: 2 },
  { repoFullName: 'acme/frontend', prNumber: 87, title: 'Redesign dashboard cards', authorLogin: 'bob', requestedAt: new Date(Date.now() - 18 * 3600 * 1000).toISOString(), ageHours: 18 },
  { repoFullName: 'acme/infra', prNumber: 31, title: 'Migrate CI to GitHub Actions', authorLogin: 'carol', requestedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(), ageHours: 72 },
  { repoFullName: 'acme/docs', prNumber: 12, title: 'Update API reference for v3', authorLogin: 'dave', requestedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(), ageHours: 120 },
  { repoFullName: 'acme/backend', prNumber: 155, title: 'Optimise SQL queries in billing module', authorLogin: 'eve', requestedAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(), ageHours: 168 },
]

const STALE_PRS = Array.from({ length: 10 }, (_, i) => ({
  repoFullName: i % 2 === 0 ? 'acme/backend' : 'acme/frontend',
  prNumber: 200 + i,
  title: `Stale PR #${200 + i}: feature/${['auth', 'ui', 'perf', 'db', 'ci'][i % 5]}-improvements`,
  authorLogin: ['alice', 'bob', 'carol', 'dave', 'eve'][i % 5],
  openedAt: new Date(Date.now() - (8 + i * 3) * 24 * 3600 * 1000).toISOString(),
  ageDays: 8 + i * 3,
}))

const ISSUES = [
  { repoFullName: 'acme/backend', issueNumber: 501, labels: ['bug', 'priority:high'], openedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(), ageDays: 1 },
  { repoFullName: 'acme/frontend', issueNumber: 312, labels: ['enhancement'], openedAt: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(), ageDays: 4 },
  { repoFullName: 'acme/docs', issueNumber: 88, labels: ['documentation'], openedAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(), ageDays: 10 },
]

function makeDORA() {
  const perDay = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 24 * 3600 * 1000)
    return { date: d.toISOString().split('T')[0], count: Math.floor(Math.random() * 5) }
  })
  return {
    totalDeployments: perDay.reduce((s, d) => s + d.count, 0),
    perDay,
    medianLeadTimeHours: 18.5,
    p50: 18.5,
    p90: 52,
    sampleSize: 47,
  }
}

let _dora = null
export function mockWorkBoardData() {
  if (!_dora) _dora = makeDORA()
  return { reviews: REVIEWS, stalePRs: STALE_PRS, issues: ISSUES, dora: _dora }
}
```

- [ ] **Step 5: Replace inline generators in useWorkBoard.js**

Delete L133-180 (the entire "Synthetic mock data" section). Find every consumer of `MOCK_REVIEWS`, `MOCK_STALE_PRS`, `MOCK_ISSUES`, `getMockDORA` in the file and change them to read from a single guarded loader:

```js
async function loadMocks() {
  if (!(import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true')) return null
  const { mockWorkBoardData } = await import('../__mocks__/mockWorkBoard.js')
  return mockWorkBoardData()
}
```

Each consumer that previously read from a top-level constant now awaits `loadMocks()` and falls back to `[]` / `null` when not in mock mode.

- [ ] **Step 6: Verify tests pass**

Run: `npx vitest run tests/__mocks__/generators.test.js tests/hooks/useWorkBoard`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/__mocks__/mockWorkBoard.js src/hooks/useWorkBoard.js tests/__mocks__/generators.test.js
git commit -m "refactor(mocks): move work-board mock data behind dev-only guard"
```

---

### Task 5: Move mock AI factories to `__mocks__/mockAI.js`

**Files:**
- Create: `src/__mocks__/mockAI.js`
- Modify: `src/api/ai.js:65-121` (the four `mock*` factories) plus all callsites that reference them
- Test: `tests/__mocks__/generators.test.js` (extend)

- [ ] **Step 1: Locate every reference**

Grep `src/api/ai.js` for `mockAnalysis`, `mockQualityReport`, `mockSearchResults`, `mockReadmeEnhancement`. Each is referenced inside a `MOCK_MODE` branch. Note: keep the `unconfigured*` factories in place — those are the honest fallback for "AI provider not configured", NOT vaporware.

- [ ] **Step 2: Extend the test**

```js
// tests/__mocks__/generators.test.js — append
import { mockAnalysis, mockQualityReport, mockSearchResults, mockReadmeEnhancement } from '../../src/__mocks__/mockAI.js'

describe('mockAI factories', () => {
  it('mockAnalysis returns shape consumers depend on', () => {
    const repo = { name: 'foo', language: 'TypeScript', description: 'a thing' }
    const out = mockAnalysis(repo)
    expect(out).toMatchObject({
      summary: expect.any(String),
      health_score: expect.any(Number),
      improvements: expect.any(Array),
      patterns: expect.any(Object),
    })
  })

  it('mockQualityReport returns recommendations array', () => {
    expect(mockQualityReport({ name: 'x' }).recommendations).toBeInstanceOf(Array)
  })

  it('mockSearchResults returns three items containing the query', () => {
    const out = mockSearchResults('react')
    expect(out).toHaveLength(3)
    expect(out[0].description).toContain('react')
  })

  it('mockReadmeEnhancement returns enhancement string and missingSections', () => {
    const out = mockReadmeEnhancement({ name: 'foo' })
    expect(out.enhancement).toContain('Installation')
    expect(out.missingSections).toContain('Installation')
  })
})
```

- [ ] **Step 3: Verify it fails**

Run: `npx vitest run tests/__mocks__/generators.test.js`
Expected: FAIL with "Failed to resolve import"

- [ ] **Step 4: Create the mock module**

```js
// src/__mocks__/mockAI.js
// Mock data generators — DEV ONLY (see mockRepos.js header).

export const mockAnalysis = (repo) => ({
  summary: `${repo.name} is a ${repo.language || 'multi-language'} project focused on ${repo.description || 'software development'}.`,
  health_score: Math.floor(Math.random() * 30) + 65,
  project_type: 'application',
  suggested_topics: ['open-source', repo.language?.toLowerCase() || 'code', 'development'].filter(Boolean),
  improvements: [
    'Add comprehensive documentation with examples',
    'Set up automated testing with CI/CD pipeline',
    'Include contribution guidelines (CONTRIBUTING.md)',
    'Add status badges to README',
  ],
  readme_suggestions: ['Installation', 'Usage Examples', 'API Reference'],
  highlights: [`Active ${repo.language || 'multi-language'} project`, 'Well-structured codebase'],
  quality_breakdown: { documentation: 15, community: 10, engineering: 12, polish: 5 },
  patterns: { hasInstallation: true, hasUsage: false, hasTests: true, hasCI: true, hasLicense: true },
})

export const mockSearchResults = (query) => [
  { repo_id: 1, score: 0.92, name: 'project-1', full_name: 'dev-user/project-1', description: `Matches "${query}" - React dashboard`, summary: 'A React-based dashboard for data visualization' },
  { repo_id: 2, score: 0.85, name: 'project-2', full_name: 'dev-user/project-2', description: `Related to "${query}" - API service`, summary: 'RESTful API service with authentication' },
  { repo_id: 3, score: 0.78, name: 'project-3', full_name: 'dev-user/project-3', description: `Contains "${query}" - Utility library`, summary: 'Collection of utility functions' },
]

export const mockQualityReport = (_repo) => ({
  score: Math.floor(Math.random() * 30) + 60,
  breakdown: { documentation: 18, community: 12, engineering: 15, polish: 5 },
  patterns: {
    hasInstallation: true, hasUsage: false, hasExamples: false,
    hasContributing: false, hasLicense: true, hasCI: true, hasTests: true,
  },
  recommendations: [
    { priority: 'high', action: 'Add usage examples to README' },
    { priority: 'medium', action: 'Add CONTRIBUTING.md for community guidelines' },
    { priority: 'low', action: 'Add status badges to README' },
  ],
  summary: 'Good quality. A few improvements would make it great.',
})

export const mockReadmeEnhancement = (repo) => ({
  enhancement: `## Installation\n\n\`\`\`bash\nnpm install ${repo.name}\n\`\`\`\n\n## Usage\n\n\`\`\`javascript\nimport { example } from '${repo.name}';\n\n// Your code here\n\`\`\`\n\n## Contributing\n\nContributions are welcome! Please read our contributing guidelines first.`,
  missingSections: ['Installation', 'Usage', 'Contributing'],
  patterns: { hasInstallation: false, hasUsage: false, hasContributing: false },
})

// Used by batch-index mock fallback in api/ai.js
export function mockBatchIndexResults(repos) {
  return {
    success: true,
    processed: repos.length,
    results: repos.map(r => ({ repo: r.full_name, success: true, health_score: Math.floor(Math.random() * 30) + 65 })),
    skipped: 0,
  }
}
```

- [ ] **Step 5: Replace the inline factories in api/ai.js**

Delete L65-121 (the four `const mock* = ...` factories). Then in every `if (MOCK_MODE)` consumer block, replace synchronous calls with guarded async loads:

```js
// Pattern A: a function that previously returned mockAnalysis(repo) synchronously
export async function analyzeRepoAI(repo) {
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
    const { mockAnalysis } = await import('../__mocks__/mockAI.js')
    return mockAnalysis(repo)
  }
  // ... existing real implementation, plus the unconfigured* fallback for non-MOCK_MODE no-AI users
}
```

For the batch-index mock at L337, replace the inline literal `Math.floor(Math.random() * 30) + 65` with a guarded import of `mockBatchIndexResults(repos)`.

- [ ] **Step 6: Verify tests pass**

Run: `npx vitest run tests/__mocks__/generators.test.js tests/api`
Expected: PASS. If existing api/ai tests fail because they expected sync mock returns, update them to `await` the result.

- [ ] **Step 7: Commit**

```bash
git add src/__mocks__/mockAI.js src/api/ai.js tests/__mocks__/generators.test.js
git commit -m "refactor(mocks): move AI mock factories behind dev-only guard"
```

---

### Task 6: Wire honest EmptyStates on each surface

**Files:**
- Modify: `src/components/RepoList/index.jsx`, `src/components/OrgPanel.jsx`, `src/components/Dashboard/DashboardPremium.jsx` (verify only), `src/components/WorkBoard/**` (daily chart)
- Test: existing tests; add new test for OrgPanel empty state

- [ ] **Step 1: Audit each surface**

Run the app with `VITE_MOCK_MODE=` empty in dev (`npm run dev` after `unset VITE_MOCK_MODE`) and a logged-in account with no repos. Visit Dashboard, RepoList, OrgPanel, WorkBoard. Note which surfaces render nothing / a console error / undefined data.

- [ ] **Step 2: Write failing test for OrgPanel empty state**

```jsx
// tests/components/OrgPanel.test.jsx — extend or create
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { OrgPanel } from '../../src/components/OrgPanel'

describe('OrgPanel', () => {
  it('renders an EmptyState when there are no organizations', () => {
    render(<OrgPanel orgs={[]} loading={false} />)
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.getByText(/no organizations/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Verify it fails**

Run: `npx vitest run tests/components/OrgPanel`
Expected: FAIL (either no testid or no "No organizations" text).

- [ ] **Step 4: Add EmptyState in OrgPanel**

In `src/components/OrgPanel.jsx`, find the render branch where `orgs.length === 0` and render:

```jsx
import { Building2 } from 'lucide-react'
import { EmptyState } from './ui/EmptyState'

if (!loading && orgs.length === 0) {
  return (
    <EmptyState
      icon={Building2}
      title="No organizations"
      description="You're not a member of any GitHub organization yet."
      action={{ label: 'Learn about orgs', href: 'https://docs.github.com/en/organizations' }}
    />
  )
}
```

- [ ] **Step 5: Verify test passes**

Run: `npx vitest run tests/components/OrgPanel`
Expected: PASS

- [ ] **Step 6: Repeat the audit for WorkBoard daily chart**

If the work-board daily count chart renders an empty SVG or NaN axis when `dora.perDay` is empty, add an EmptyState branch:

```jsx
{!loading && (!data?.dora?.perDay || data.dora.perDay.every(d => d.count === 0)) && (
  <EmptyState
    icon={Activity}
    title="No activity in the last 30 days"
    description="Once you have deployments tracked, they'll appear here."
  />
)}
```

- [ ] **Step 7: Verify WorkBoard tests still pass**

Run: `npx vitest run tests/components/WorkBoard tests/hooks/useWorkBoard`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/components/OrgPanel.jsx src/components/WorkBoard tests/components/OrgPanel.test.jsx
git commit -m "feat(empty-states): honest EmptyStates on org and work-board surfaces"
```

---

### Task 7: Clean stale mock-related comments

**Files:**
- Modify: `src/components/AI/AINotConfiguredBanner.jsx:21-34` (comment block)
- Modify: `src/components/LicenseBadge.jsx:115-118` (comment block)

- [ ] **Step 1: Update AINotConfiguredBanner comment**

```jsx
// src/components/AI/AINotConfiguredBanner.jsx — replace the JSDoc block at L21-34 with:

/**
 * AINotConfiguredBanner — premium inline banner shown on AI surfaces when
 * the server has no Gemini provider configured. The UI shows degraded
 * results (no scores, no recommendations) plus a CTA to open Settings → AI.
 *
 * Variants:
 *   - "inline" (default): compact banner for placement at the top of
 *     AI-heavy panels/modals.
 *   - "compact": one-line pill for tight spots (e.g. sidebars, toolbars).
 *
 * Dismissible is session-scoped via local state only — the banner
 * reappears next time the component mounts so the user is never left
 * wondering why data looks degraded.
 */
```

- [ ] **Step 2: Update LicenseBadge comment**

```jsx
// src/components/LicenseBadge.jsx — replace the comment at L115-118 with:

  // Active real license — render tier-appropriate pill regardless of MOCK_MODE.
  // The backend's /api/v1/license reads LICENSE_KEY from env, not from the
  // session, so this surfaces the real license even in demo mode (MOCK_MODE).
```

- [ ] **Step 3: Verify nothing broke**

Run: `npx vitest run`
Expected: PASS (comment-only change).

- [ ] **Step 4: Commit**

```bash
git add src/components/AI/AINotConfiguredBanner.jsx src/components/LicenseBadge.jsx
git commit -m "docs(comments): drop stale 'showing mock data' phrasing"
```

---

### Task 8: Build honesty test (opt-in slow)

**Files:**
- Create: `tests/build/build-honesty.test.js`
- Modify: `vitest.config.js` (exclude `tests/build/` from default run)
- Modify: `.github/workflows/ci.yml` (add a step `RUN_BUILD_TESTS=1 npx vitest run tests/build/`)

- [ ] **Step 1: Write the test (will be skipped without env var)**

```js
// tests/build/build-honesty.test.js
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'

const FORBIDDEN_MARKERS = [
  'mockAnalysis',
  'mockQualityReport',
  'mockSearchResults',
  'mockReadmeEnhancement',
  'mockBatchIndexResults',
  'generateMockRepos',
  'generateMockActivity',
  'generateMockOrgRepos',
  'mockWorkBoardData',
  'nlp-chatbot-engine',
  'web-assembly-video-editor',
  'design-system-tokens',
  'fintech-dashboard',
  'ai-analytics-platform',
]

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else if (p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.html')) yield p
  }
}

const RUN = process.env.RUN_BUILD_TESTS === '1'

describe.skipIf(!RUN)('production build contains no mock data', () => {
  beforeAll(() => {
    execSync('npx vite build --mode production', { stdio: 'inherit' })
  }, 180_000)

  for (const marker of FORBIDDEN_MARKERS) {
    it(`dist/ must not contain "${marker}"`, () => {
      const offenders = []
      for (const file of walk('dist')) {
        const content = readFileSync(file, 'utf8')
        if (content.includes(marker)) offenders.push(file)
      }
      expect(offenders, `Found "${marker}" in: ${offenders.join(', ')}`).toEqual([])
    })
  }
})
```

- [ ] **Step 2: Exclude from default vitest run**

```js
// vitest.config.js — in the test config, add to `exclude`:
test: {
  // ...existing
  exclude: [
    ...(existingExclude || ['**/node_modules/**', '**/dist/**']),
    'tests/build/**',
  ],
},
```

(Read the current vitest config first to find the exact structure; merge into the existing `exclude` array rather than overwriting it.)

- [ ] **Step 3: Verify default suite still skips it**

Run: `npx vitest run`
Expected: PASS, no build executed.

- [ ] **Step 4: Verify opt-in run executes**

Run: `RUN_BUILD_TESTS=1 npx vitest run tests/build/`
Expected: vite build runs. If markers are found, test fails — that's a real leak that needs fixing in earlier tasks. If clean, test passes.

- [ ] **Step 5: Add CI step**

Edit `.github/workflows/ci.yml` and add after the existing test step:

```yaml
      - name: Build honesty test
        run: RUN_BUILD_TESTS=1 npx vitest run tests/build/
```

(Read the current `ci.yml` first — match the existing job structure exactly. The step belongs in whatever job runs unit tests.)

- [ ] **Step 6: Commit**

```bash
git add tests/build/build-honesty.test.js vitest.config.js .github/workflows/ci.yml
git commit -m "test(ci): add opt-in build honesty test against dist/"
```

- [ ] **Step 7: Push Wave 1 to origin/main**

```bash
git push origin main
```

Verify CI green. If the build honesty test reports a marker leak, that's a real bug — go back and tighten the guard at the offending callsite.

---

## Wave 2 — Error Message Uniformity

### Task 9: `formatUserError()` helper with tests

**Files:**
- Create: `src/utils/errors.js`
- Test: `tests/utils/errors.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/utils/errors.test.js
import { describe, it, expect, vi } from 'vitest'
import { formatUserError } from '../../src/utils/errors.js'

describe('formatUserError', () => {
  it('maps known code to title/body/action', () => {
    const out = formatUserError({ code: 'AI_NOT_CONFIGURED' })
    expect(out.title).toBe('AI is not configured')
    expect(out.action.kind).toBe('open-settings')
    expect(out.action.settingsTab).toBe('ai')
    expect(out.raw).toBeNull()
  })

  it('detects fetch network error', () => {
    const err = new TypeError('Failed to fetch')
    expect(formatUserError(err).code).toBe('NETWORK_ERROR')
  })

  it('detects 401 without explicit code', () => {
    expect(formatUserError({ status: 401 }).code).toBe('UNAUTHORIZED')
  })

  it('returns fallback for unknown error', () => {
    const out = formatUserError(new Error('weird internal thing'))
    expect(out.title).toBe('Something went wrong')
    expect(out.body).toContain('bruno@bolalabs.pt')
  })

  it('never includes raw stack in returned object', () => {
    const err = new Error('boom')
    const out = formatUserError(err)
    expect(out.raw).toBeNull()
    expect(JSON.stringify(out)).not.toContain('boom')
  })

  it('reads code from response.data.code (axios shape)', () => {
    expect(formatUserError({ response: { data: { code: 'AI_KEY_INVALID' } } }).code).toBe('AI_KEY_INVALID')
  })
})
```

- [ ] **Step 2: Verify tests fail**

Run: `npx vitest run tests/utils/errors.test.js`
Expected: FAIL with "Failed to resolve import"

- [ ] **Step 3: Implement `formatUserError`**

```js
// src/utils/errors.js

const KNOWN_ERRORS = {
  NETWORK_ERROR: {
    title: 'Could not reach the server',
    body: 'Check your connection and try again.',
    action: { label: 'Retry', kind: 'retry' },
  },
  UNAUTHORIZED: {
    title: 'Session expired',
    body: 'Please sign in again to continue.',
    action: { label: 'Sign in', kind: 'reauth' },
  },
  AI_KEY_INVALID: {
    title: 'AI key rejected',
    body: 'Your API key was not accepted by the provider.',
    action: { label: 'Update key', kind: 'open-settings', settingsTab: 'ai' },
  },
  AI_NOT_CONFIGURED: {
    title: 'AI is not configured',
    body: 'Configure a Gemini API key in Settings → AI to use this feature.',
    action: { label: 'Open Settings', kind: 'open-settings', settingsTab: 'ai' },
  },
  TIER_REQUIRED_PRO: {
    title: 'Pro feature',
    body: 'This feature is part of the Pro plan.',
    action: { label: 'See plans', kind: 'open-pricing' },
  },
  TIER_REQUIRED_ENTERPRISE: {
    title: 'Enterprise feature',
    body: 'This feature is part of the Enterprise plan.',
    action: { label: 'Contact sales', kind: 'open-pricing' },
  },
  QUOTA_EXCEEDED: {
    title: 'Quota reached',
    body: 'You have used your monthly allowance for this feature.',
    action: { label: 'See options', kind: 'open-quota' },
  },
}

const FALLBACK = {
  title: 'Something went wrong',
  body: 'Please try again. If the problem persists, contact bruno@bolalabs.pt.',
  action: { label: 'Retry', kind: 'retry' },
}

function pickCode(err, ctx) {
  return err?.code || err?.response?.data?.code || ctx?.code || null
}

export function formatUserError(err, ctx = {}) {
  if (!err) return { ...FALLBACK, code: null, raw: null }
  const code = pickCode(err, ctx)
  if (code && KNOWN_ERRORS[code]) return { ...KNOWN_ERRORS[code], code, raw: null }
  if (err.name === 'TypeError' && /fetch|network/i.test(err.message || '')) {
    return { ...KNOWN_ERRORS.NETWORK_ERROR, code: 'NETWORK_ERROR', raw: null }
  }
  if (err.status === 401 || err.response?.status === 401) {
    return { ...KNOWN_ERRORS.UNAUTHORIZED, code: 'UNAUTHORIZED', raw: null }
  }
  if (import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.warn('[formatUserError] unmapped error:', err)
  }
  return { ...FALLBACK, code: null, raw: null }
}
```

- [ ] **Step 4: Verify tests pass**

Run: `npx vitest run tests/utils/errors.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/errors.js tests/utils/errors.test.js
git commit -m "feat(errors): formatUserError helper with known-code mapping"
```

---

### Task 10: Toast `errorFromException` helper

**Files:**
- Modify: existing toast hook/context (find via `grep -r "useToast\|toast\.error" src/contexts src/hooks`). The likely file is `src/contexts/ToastContext.jsx` or similar.
- Test: `tests/contexts/ToastContext.test.jsx` (extend if exists)

- [ ] **Step 1: Locate the toast provider**

Run: `Grep` for `function.*toast|useToast|export.*toast` in `src/contexts/` and `src/hooks/`. Identify the module that exposes the `toast` object with `.error()`, `.success()` etc. Read the file.

- [ ] **Step 2: Write failing test**

```jsx
// tests/contexts/ToastContext.test.jsx — extend
import { act, render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ToastProvider, useToast } from '../../src/contexts/ToastContext'  // adjust path

function Probe() {
  const toast = useToast()
  return <button onClick={() => toast.errorFromException({ code: 'AI_NOT_CONFIGURED' })}>fail</button>
}

describe('toast.errorFromException', () => {
  it('renders mapped title/body and an action button', async () => {
    render(<ToastProvider><Probe /></ToastProvider>)
    await act(async () => screen.getByText('fail').click())
    expect(screen.getByText('AI is not configured')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open settings/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Verify it fails**

Run: `npx vitest run tests/contexts/ToastContext`
Expected: FAIL with "errorFromException is not a function"

- [ ] **Step 4: Implement the helper inside the provider**

In the toast provider, add:

```jsx
import { formatUserError } from '../utils/errors'

function dispatchAction(action) {
  if (!action) return
  switch (action.kind) {
    case 'retry':
      action.onClick?.()
      break
    case 'reauth':
      window.location.href = '/api/auth/github'
      break
    case 'open-settings':
      window.dispatchEvent(new CustomEvent('app:open-settings', { detail: { tab: action.settingsTab } }))
      break
    case 'open-pricing':
      window.location.hash = '#pricing'
      break
    case 'open-quota':
      window.dispatchEvent(new CustomEvent('app:show-quota-exceeded', { detail: action.detail || {} }))
      break
    default:
      action.onClick?.()
  }
}

// In the toast object (or hook return):
errorFromException(err, ctx = {}) {
  const formatted = formatUserError(err, ctx)
  this.error({
    title: formatted.title,
    message: formatted.body,
    action: formatted.action ? {
      label: formatted.action.label,
      onClick: () => dispatchAction({ ...formatted.action, onClick: ctx.onRetry }),
    } : undefined,
  })
}
```

If the existing `Toast` primitive does not yet support a `title` field separate from `message`, render `title` as a bold first line in the existing `content` slot. Match whatever the codebase already does for grouped toasts.

- [ ] **Step 5: Verify tests pass**

Run: `npx vitest run tests/contexts/ToastContext`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/contexts/ToastContext.jsx tests/contexts/ToastContext.test.jsx  # adjust paths
git commit -m "feat(toast): errorFromException helper routing through formatUserError"
```

---

### Task 11: Sweep `toast.error(${...err.message})` callsites

**Files:**
- Modify: all files matching the pattern (15+ confirmed; expect ~25 total).

- [ ] **Step 1: Enumerate every callsite**

Run a Grep with pattern `toast\.error\(.*err\.message|toast\.error\(.*\.message\)` across `src/`. Save the list. Cross-reference with the file list under "Modify" in the File Structure section.

- [ ] **Step 2: For each callsite, replace pattern**

Three patterns to handle:

**Pattern A** — bare `err.message`:
```js
// Before
toast.error(err.message)
// After
toast.errorFromException(err)
```

**Pattern B** — prefixed string with `${err.message}`:
```js
// Before
toast.error(`Transfer failed: ${err.message}`)
// After
toast.errorFromException(err, { code: 'TRANSFER_FAILED' })   // OR keep generic if no useful code
```
If the prefix carries semantic information that maps to a known code, add the mapping in `src/utils/errors.js` first, then use it. Otherwise fall through to the FALLBACK shape — the user still gets "Something went wrong" + retry, no leaked backend string.

**Pattern C** — `${err.message || 'fallback'}`:
```js
// Before
toast.error(`Failed: ${err.message || 'try again'}`)
// After
toast.errorFromException(err)
```

- [ ] **Step 3: Run unit suite after every 5-10 callsites**

Run: `npx vitest run`
Expected: PASS at each checkpoint.

- [ ] **Step 4: Commit per file (or per group of 3-5 files)**

```bash
git add <files>
git commit -m "refactor(errors): use formatUserError in <area>"
```

Example areas: App.jsx (8 callsites in one commit), RepoList (3 in one commit), AdminDLQPage (3 in one commit), remaining components grouped by feature area.

---

### Task 12: ESLint guardrail against `.stack` in components

**Files:**
- Modify: `eslint.config.js` (or `.eslintrc.cjs` — check which exists)

- [ ] **Step 1: Add the rule**

If `eslint.config.js` (flat config) exists:

```js
// eslint.config.js — inside the existing rules object, scoped to src/components/
{
  files: ['src/components/**/*.{js,jsx}'],
  rules: {
    'no-restricted-syntax': ['error', {
      selector: "MemberExpression[property.name='stack']",
      message: 'Do not surface .stack in UI. Use formatUserError(err) instead.',
    }],
  },
}
```

If `.eslintrc.cjs` (legacy):

```js
// inside overrides
{
  files: ['src/components/**/*.{js,jsx}'],
  rules: {
    'no-restricted-syntax': ['error', {
      selector: "MemberExpression[property.name='stack']",
      message: 'Do not surface .stack in UI. Use formatUserError(err) instead.',
    }],
  },
}
```

- [ ] **Step 2: Verify lint passes**

Run: `npx eslint src/components/`
Expected: PASS (no `.stack` leaks remain after Task 11). If any fail, fix the offending callsite.

- [ ] **Step 3: Commit + push Wave 2**

```bash
git add eslint.config.js  # or .eslintrc.cjs
git commit -m "chore(eslint): forbid .stack access in src/components/"
git push origin main
```

Verify CI green.

---

## Wave 3 — Quota CTA Uniformity

### Task 13: `quotaErrorPayload` and `tierRequiredPayload` server helpers

**Files:**
- Modify: `server/lib/usage-meter.js` — append two new exports
- Test: `server/__tests__/usage-meter.test.js` (extend) or new `server/__tests__/usage-meter-quota-payload.test.js`

- [ ] **Step 1: Write failing tests**

```js
// server/__tests__/usage-meter-quota-payload.test.js
import { describe, it, expect } from 'vitest'
import { quotaErrorPayload, tierRequiredPayload } from '../lib/usage-meter.js'

describe('quotaErrorPayload', () => {
  it('returns a complete payload with code QUOTA_EXCEEDED', () => {
    const p = quotaErrorPayload(
      { current: 100, limit: 100 },
      { feature: 'ai_queries', upgradeTo: 'pro', tier: 'free' },
    )
    expect(p).toMatchObject({
      error: 'Quota exceeded',
      code: 'QUOTA_EXCEEDED',
      feature: 'ai_queries',
      tier: 'free',
      limit: 100,
      used: 100,
      upgradeTo: 'pro',
    })
    expect(new Date(p.resetAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('omits upgradeTo if not provided', () => {
    const p = quotaErrorPayload({ current: 5, limit: 5 }, { feature: 'x', tier: 'pro' })
    expect(p.upgradeTo).toBeNull()
  })
})

describe('tierRequiredPayload', () => {
  it('returns code TIER_REQUIRED_PRO', () => {
    expect(tierRequiredPayload('free', 'pro', 'semantic_search')).toMatchObject({
      code: 'TIER_REQUIRED_PRO',
      currentTier: 'free',
      requiredTier: 'pro',
      feature: 'semantic_search',
    })
  })
})
```

- [ ] **Step 2: Verify tests fail**

Run: `npx vitest run server/__tests__/usage-meter-quota-payload.test.js`
Expected: FAIL with "is not a function"

- [ ] **Step 3: Implement helpers (append to usage-meter.js)**

```js
// server/lib/usage-meter.js — append after existing exports

export function quotaErrorPayload(check, { feature, upgradeTo = null, tier }) {
  const now = new Date()
  // Reset = first day of next month, midnight UTC.
  const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
  return {
    error: 'Quota exceeded',
    code: 'QUOTA_EXCEEDED',
    feature,
    tier,
    limit: check.limit,
    used: check.current,
    resetAt,
    upgradeTo,
  }
}

export function tierRequiredPayload(currentTier, requiredTier, feature) {
  return {
    error: 'Tier required',
    code: `TIER_REQUIRED_${requiredTier.toUpperCase()}`,
    feature,
    currentTier,
    requiredTier,
  }
}
```

- [ ] **Step 4: Verify tests pass**

Run: `npx vitest run server/__tests__/usage-meter-quota-payload.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/usage-meter.js server/__tests__/usage-meter-quota-payload.test.js
git commit -m "feat(server): quotaErrorPayload and tierRequiredPayload helpers"
```

---

### Task 14: Update AI route 429/403 responses

**Files:**
- Modify: `server/routes/ai/core.js`, `indexing.js`, `migration.js`, `dev-toolkit.js`, `shared.js`, `search.js` — every `res.status(429).json(...)` and `res.status(403).json({ error: 'Tier required ...' })` callsite

- [ ] **Step 1: Locate every callsite**

Grep `server/routes/` for `status(429)`, `status(403)`, `Quota exceeded`, `Tier required`. List each file and line.

- [ ] **Step 2: For each 429 callsite, replace**

```js
// Before
return res.status(429).json({ error: 'Quota exceeded' })

// After
import { quotaErrorPayload } from '../../lib/usage-meter.js'
const tier = getUserTier(req.session.user.id)
return res.status(429).json(quotaErrorPayload(check, {
  feature: 'ai_queries',           // or the specific feature being limited
  upgradeTo: tier === 'free' ? 'pro' : tier === 'pro' ? 'enterprise' : null,
  tier,
}))
```

The exact `feature` string per route: `ai_queries`, `ai_readme`, `ai_commit`, `ai_insights`, `ai_migration_risk`, `ai_semantic_search`. Match the metric name passed to `checkUsageLimit()`.

- [ ] **Step 3: For each 403 tier-block callsite, replace**

```js
// Before
return res.status(403).json({ error: 'Tier required: pro' })

// After
import { tierRequiredPayload } from '../../lib/usage-meter.js'
return res.status(403).json(tierRequiredPayload(tier, 'pro', 'semantic_search'))
```

- [ ] **Step 4: Run server tests**

Run: `npx vitest run server/__tests__/`
Expected: PASS. Existing tests assert `status === 429` and `body.error === 'Quota exceeded'` — additive fields don't break those assertions. If a test asserts the exact response shape with `toEqual`, update it to `toMatchObject` so it accepts the new fields.

- [ ] **Step 5: Commit**

```bash
git add server/routes/ai/ server/__tests__/
git commit -m "refactor(api): unify 429/403 payload via quota+tier helpers"
```

---

### Task 15: `<QuotaExceededState />` component

**Files:**
- Create: `src/components/ui/QuotaExceededState.jsx`
- Test: `tests/components/ui/QuotaExceededState.test.jsx`

- [ ] **Step 1: Write failing tests**

```jsx
// tests/components/ui/QuotaExceededState.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QuotaExceededState } from '../../../src/components/ui/QuotaExceededState'

describe('QuotaExceededState', () => {
  beforeEach(() => {
    window.location.hash = ''
  })

  it('renders feature, used/limit, and reset date', () => {
    render(<QuotaExceededState feature="AI queries" currentTier="free" used={100} limit={100} resetAt="2026-05-01T00:00:00Z" upgradeTo="pro" />)
    expect(screen.getByText(/AI queries/)).toBeInTheDocument()
    expect(screen.getByText(/100 \/ 100/)).toBeInTheDocument()
    expect(screen.getByText(/2026-05-01/)).toBeInTheDocument()
  })

  it('shows upgrade CTA when upgradeTo is pro', () => {
    render(<QuotaExceededState feature="AI" currentTier="free" used={100} limit={100} resetAt="2026-05-01T00:00:00Z" upgradeTo="pro" />)
    fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }))
    expect(window.location.hash).toBe('#pricing-pro')
  })

  it('omits upgrade CTA when upgradeTo is null', () => {
    render(<QuotaExceededState feature="AI" currentTier="enterprise" used={100} limit={100} resetAt="2026-05-01T00:00:00Z" upgradeTo={null} />)
    expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument()
    expect(screen.getByText(/quota resets/i)).toBeInTheDocument()
  })

  it('shows BYOK link', () => {
    render(<QuotaExceededState feature="AI" currentTier="free" used={100} limit={100} resetAt="2026-05-01T00:00:00Z" upgradeTo="pro" />)
    expect(screen.getByText(/configure your own ai key/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Verify tests fail**

Run: `npx vitest run tests/components/ui/QuotaExceededState`
Expected: FAIL with "Failed to resolve import"

- [ ] **Step 3: Implement component**

```jsx
// src/components/ui/QuotaExceededState.jsx
import { Gauge, ArrowRight, Key } from 'lucide-react'
import { motion } from 'framer-motion'

const TIER_LABEL = { pro: 'Pro', enterprise: 'Enterprise' }

function openSettings(tab) {
  window.dispatchEvent(new CustomEvent('app:open-settings', { detail: { tab } }))
}

export function QuotaExceededState({ feature, currentTier, used, limit, resetAt, upgradeTo, onClose }) {
  const resetDate = resetAt ? new Date(resetAt).toISOString().slice(0, 10) : null
  const upgradeLabel = upgradeTo && TIER_LABEL[upgradeTo]
  return (
    <motion.div
      data-testid="quota-exceeded"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="ds-card-shimmer p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 max-w-lg mx-auto text-center"
    >
      <div className="w-16 h-16 mb-5 mx-auto rounded-2xl bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center">
        <Gauge className="w-8 h-8 text-white" strokeWidth={2.5} />
      </div>
      <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">Quota reached</h3>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
        You've used your monthly <strong>{feature}</strong> allowance on the <strong>{TIER_LABEL[currentTier] || currentTier}</strong> tier.
      </p>
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 text-xs font-medium mb-2">
        <span>{used} / {limit} used</span>
      </div>
      {resetDate && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">Quota resets on {resetDate}.</p>
      )}
      {upgradeLabel && (
        <button
          onClick={() => { window.location.hash = `#pricing-${upgradeTo}`; onClose?.() }}
          className="ds-border-glow inline-flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:shadow-lg transition-all"
        >
          Upgrade to {upgradeLabel} <ArrowRight className="w-4 h-4" />
        </button>
      )}
      <div className="mt-5 pt-5 border-t border-slate-200 dark:border-slate-800">
        <button
          onClick={() => { openSettings('ai'); onClose?.() }}
          className="inline-flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          <Key className="w-4 h-4" /> Configure your own AI key (BYOK)
        </button>
      </div>
    </motion.div>
  )
}
```

- [ ] **Step 4: Verify tests pass**

Run: `npx vitest run tests/components/ui/QuotaExceededState`
Expected: PASS

- [ ] **Step 5: Mount the modal listener at the App level**

In `src/App.jsx`, add a top-level effect that listens for the `app:show-quota-exceeded` event and renders `<QuotaExceededState />` inside the existing modal infrastructure (ModalContext). Pattern:

```jsx
useEffect(() => {
  const handler = (e) => openModalWithData('showQuotaExceeded', e.detail)
  window.addEventListener('app:show-quota-exceeded', handler)
  return () => window.removeEventListener('app:show-quota-exceeded', handler)
}, [openModalWithData])
```

Register `showQuotaExceeded` in `ModalContext` and render `<Modal><QuotaExceededState {...modalData} onClose={closeModal} /></Modal>` at the bottom of App.jsx alongside other modals.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/QuotaExceededState.jsx src/App.jsx src/contexts/ModalContext.jsx tests/components/ui/QuotaExceededState.test.jsx
git commit -m "feat(quota): QuotaExceededState component with tier-aware CTA"
```

---

### Task 16: Frontend 429/403 sweep

**Files:**
- Modify: every component that handles a 429 or 403 response from `aiApi`. Likely surfaces: `AIAssistant.jsx`, `RepoInsightsModal.jsx`, `CommitGeneratorModal.jsx`, `AIIssuePlanner.jsx`, semantic search drawer.

- [ ] **Step 1: Locate handlers**

Grep `src/` for `status === 429`, `429`, `Quota exceeded`, `'Tier required'`. List each callsite.

- [ ] **Step 2: For each 429 handler, replace with QuotaExceededState dispatch**

```js
// Before
if (err.status === 429) {
  toast.error('Monthly AI quota exceeded. Upgrade to Pro.')
  return
}

// After
if (err.response?.data?.code === 'QUOTA_EXCEEDED') {
  window.dispatchEvent(new CustomEvent('app:show-quota-exceeded', { detail: err.response.data }))
  return
}
// (If the rest of the error handling is identical, leaving formatUserError to handle the unknown case is fine.)
toast.errorFromException(err)
```

- [ ] **Step 3: For each 403 tier-block, route through formatUserError**

```js
// Before
if (err.status === 403) toast.error('Tier required: pro')

// After (handled by formatUserError via the TIER_REQUIRED_PRO map from Task 9)
toast.errorFromException(err)
```

- [ ] **Step 4: Run unit + e2e suites**

Run: `npx vitest run` then `npx playwright test --project=chromium e2e/`
Expected: PASS.

- [ ] **Step 5: Commit + push Wave 3**

```bash
git add src/
git commit -m "refactor(quota): route 429/403 through QuotaExceededState and formatUserError"
git push origin main
```

Verify CI green.

---

## Wave 4 — Verification

### Task 17: Zero-config e2e spec

**Files:**
- Create: `e2e/zero-config-honesty.spec.js`

- [ ] **Step 1: Write the spec**

```js
// e2e/zero-config-honesty.spec.js
import { test, expect } from '@playwright/test'

const FORBIDDEN_TEXTS = [
  'nlp-chatbot-engine',
  'web-assembly-video-editor',
  'design-system-tokens',
  'fintech-dashboard',
  'ai-analytics-platform',
]

test.describe('zero-config honesty', () => {
  test.beforeEach(async ({ page }) => {
    // No mock mode, no auth cookie.
    await page.context().clearCookies()
  })

  test('logged-out landing renders without mock data', async ({ page }) => {
    await page.goto('/')
    for (const text of FORBIDDEN_TEXTS) {
      await expect(page.locator('body')).not.toContainText(text)
    }
  })

  test('logged-in zero-data dashboard shows EmptyStates', async ({ page, browserName: _ }) => {
    test.skip(!process.env.E2E_TEST_TOKEN, 'requires E2E_TEST_TOKEN to inject session')
    await page.goto('/')
    // Inject test session cookie (handled by helpers if available)
    await page.context().addCookies([{ name: 'session', value: process.env.E2E_TEST_TOKEN, domain: 'localhost', path: '/' }])

    for (const route of ['/', '/repos', '/orgs', '/work-board']) {
      await page.goto(route)
      // At least one EmptyState visible
      await expect(page.getByTestId('empty-state').first()).toBeVisible({ timeout: 10_000 })
      // No mock strings rendered
      for (const text of FORBIDDEN_TEXTS) {
        await expect(page.locator('body')).not.toContainText(text)
      }
    }
  })
})
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test e2e/zero-config-honesty.spec.js`
Expected: PASS for the logged-out test. The logged-in test skips unless `E2E_TEST_TOKEN` is configured — that's fine; the logged-out path is the strongest gate against mock leakage.

- [ ] **Step 3: Commit**

```bash
git add e2e/zero-config-honesty.spec.js
git commit -m "test(e2e): zero-config honesty regression spec"
```

---

### Task 18: README/ROADMAP regression test

**Files:**
- Create: `tests/build/readme-honesty.test.js`

- [ ] **Step 1: Write the test**

```js
// tests/build/readme-honesty.test.js
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const FORBIDDEN_IN_README = [
  // Features that are roadmap-only — never advertise them as shipping in README.
  // Each string must NOT appear in README.md outside the explicit ## Roadmap section.
  'Full migration (Azure + GitLab)',
]

describe('README honesty', () => {
  const readme = readFileSync('README.md', 'utf8')
  // Split into sections by H2 headings; ignore the Roadmap section's body.
  const sections = readme.split(/^## /m)
  const nonRoadmap = sections.filter(s => !s.toLowerCase().startsWith('roadmap')).join('\n')

  for (const phrase of FORBIDDEN_IN_README) {
    it(`README must not advertise "${phrase}" outside the Roadmap section`, () => {
      expect(nonRoadmap).not.toContain(phrase)
    })
  }
})
```

- [ ] **Step 2: Run the test**

Run: `RUN_BUILD_TESTS=1 npx vitest run tests/build/readme-honesty.test.js`
Expected: PASS (the 2026-04-11 spec already removed those phrases — this just locks in the regression guard).

- [ ] **Step 3: Commit**

```bash
git add tests/build/readme-honesty.test.js
git commit -m "test(ci): README honesty regression guard"
```

---

### Task 19: Manual smoke pass + push

- [ ] **Step 1: Local smoke**

Run: `npm run build && npm run preview`
Open `http://localhost:4173` (or whatever port preview uses) in a logged-out state. Visit Landing, Pricing, Roadmap. Confirm zero mock strings.

Sign in with a real GitHub account that has zero repos. Visit Dashboard, /repos, /orgs, /work-board, /ai-assistant. Confirm EmptyStates everywhere, no errors in console.

Force a 429: hit the AI assistant 100+ times until the quota error fires. Confirm `<QuotaExceededState />` opens with the right CTA.

Force a 403 tier-block: as a Free user, try to use semantic search. Confirm a toast with "Pro feature" + "See plans" CTA.

- [ ] **Step 2: Push final wave**

```bash
git push origin main
```

Verify CI green including `RUN_BUILD_TESTS=1` step.

- [ ] **Step 3: Update memory with the slice outcome**

If anything notable surfaced (e.g., a hidden vaporware site that survived multiple audits), save a memory note so future audits know to look there.

---

## Self-review

**Spec coverage:**
- Wave 1.1 (`__mocks__/`) → Tasks 2, 3, 4, 5 ✅
- Wave 1.2 (build-time guards) → embedded in Tasks 2-5 ✅
- Wave 1.3 (honest EmptyStates) → Task 6 ✅
- Wave 1.4 (stale comment cleanup) → Task 7 ✅
- Wave 1.5 (build honesty test) → Task 8 ✅
- Wave 2.1 (`formatUserError`) → Task 9 ✅
- Wave 2.2 (toast helper) → Task 10 ✅
- Wave 2.3 (sweep) → Task 11 ✅
- Wave 2.4 (ESLint guardrail) → Task 12 ✅
- Wave 3.1 (server payload helpers) → Tasks 13, 14 ✅
- Wave 3.2 (`<QuotaExceededState />`) → Task 15 ✅
- Wave 3.3 (frontend sweep) → Task 16 ✅
- Wave 3.4 (BYOK invalid handling) → covered by Task 11 sweep + `AI_KEY_INVALID` mapping in Task 9 ✅
- Wave 4.1 (zero-config e2e) → Task 17 ✅
- Wave 4.2 (README/ROADMAP grep) → Task 18 ✅
- Wave 4.3 (manual smoke) → Task 19 ✅
- `data-testid` on EmptyState → Task 1 ✅

**Type consistency:**
- `formatUserError` shape `{ title, body, action, code, raw }` consistent across Tasks 9, 10, 16.
- `quotaErrorPayload({ feature, upgradeTo, tier })` ctx parameter consistent in Tasks 13, 14.
- `QuotaExceededState` props `{ feature, currentTier, used, limit, resetAt, upgradeTo, onClose }` consistent in Tasks 15, 16.
- Mock generator export names match between modules and tests (`generateMockRepos`, `generateMockActivity`, `generateMockOrgRepos`, `mockWorkBoardData`, `mockAnalysis`, `mockQualityReport`, `mockSearchResults`, `mockReadmeEnhancement`, `mockBatchIndexResults`).

**Placeholder scan:** none.
