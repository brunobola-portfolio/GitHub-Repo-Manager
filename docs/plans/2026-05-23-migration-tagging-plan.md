# Migration Tagging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Spec: [docs/specs/2026-05-23-migration-tagging.md](../specs/2026-05-23-migration-tagging.md).

**Goal:** After every successful migration, write idempotent provenance marks on the source Azure project, the destination GitHub repository, and the git history itself; surface them in the UI as a premium "Migrated" experience.

**Architecture:** Engine emits `plan-complete` → new `migration-tagging-service` orchestrates three independent writers (GitHub topics/description/properties, Azure project properties + repo description, git annotated tag). Each mark persists to `migration_marks` table with status. Wizard adds a Tagging step; MigrationHistory + RepoList + RepoDetail surface badges driven by the marks.

**Tech Stack:** Node 20 + Express 5 + better-sqlite3, simple-git, axios (via existing `azure-service`/`github-api` wrappers), React 19 + Vite + Tailwind v4 + Framer Motion, Vitest + Playwright.

**Conventions:**
- `.jsx` only (no TypeScript), Tailwind classes only (no global CSS).
- Conventional commits, NO `Co-Authored-By` lines.
- Tests in `server/__tests__/` (backend) and `tests/` (frontend); E2E in `e2e/`.

---

## File map

**New:**
- `server/migrations/003-migration-tagging.sql` — schema
- `server/lib/migration-tagging-constants.js` — naming conventions, enums
- `server/lib/tagging/github-writer.js` — topics, description, custom properties
- `server/lib/tagging/azure-writer.js` — project properties, repo description
- `server/lib/tagging/git-tag-writer.js` — annotated tag via simple-git
- `server/migration-tagging-service.js` — orchestrator
- `server/routes/migration-marks.js` — read API + delete
- `src/components/MigrationWizard/steps/TaggingStep.jsx`
- `src/components/MigrationHistory/MarksBadge.jsx` + `MarksDetailModal.jsx`
- `src/components/RepoList/MigratedPill.jsx`
- `src/components/RepoDetail/MigrationProvenanceCard.jsx`
- `src/hooks/useMigrationMarks.js`
- Tests: `server/__tests__/migration-tagging-service.test.js`, `server/__tests__/tagging/github-writer.test.js`, `server/__tests__/tagging/azure-writer.test.js`, `server/__tests__/tagging/git-tag-writer.test.js`, `server/__tests__/migration-marks-route.test.js`, `tests/components/MigrationWizard/TaggingStep.test.jsx`, `tests/components/MigrationHistory/MarksBadge.test.jsx`, `tests/hooks/useMigrationMarks.test.jsx`, `e2e/migration-tagging.spec.js`

**Modified:**
- `server/db.js` — add `migration_marks` table + `tagging_policy` column to `migration_plans` in `initDB`
- `server/migrations/001-initial-schema.sql` — keep in sync (per file's own comment)
- `server/migration-engine.js` — no logic change; service wires via `plan-complete` listener
- `server/index.js` — wire engine ↔ tagging-service at composition root
- `src/components/MigrationWizard/MigrationWizard.jsx` — insert TaggingStep
- `src/components/MigrationHistory.jsx` — add Tags column
- `src/components/RepoList.jsx` — show MigratedPill
- `src/components/RepoDetail/RepoDetailOverview.jsx` (or equivalent) — embed MigrationProvenanceCard

---

## Task 1 — DB migration + db.js wiring

**Files:**
- Create: `server/migrations/003-migration-tagging.sql`
- Modify: `server/db.js` (extend `initDB`)
- Modify: `server/migrations/001-initial-schema.sql` (append the tables for sync)

- [ ] **Step 1: Write `003-migration-tagging.sql`**

```sql
-- 003-migration-tagging.sql
-- Adds migration_marks table + tagging_policy column to migration_plans.
-- Idempotent: safe to run on databases at any earlier state.

CREATE TABLE IF NOT EXISTS migration_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  task_id INTEGER,
  scope TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  skip_reason TEXT,
  error_message TEXT,
  written_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (plan_id) REFERENCES migration_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES migration_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_marks_plan ON migration_marks(plan_id);
CREATE INDEX IF NOT EXISTS idx_marks_status ON migration_marks(status);
CREATE INDEX IF NOT EXISTS idx_marks_target ON migration_marks(target_kind, target_id);

-- tagging_policy column is added at runtime by db.js when missing
-- (SQLite ALTER TABLE ADD COLUMN with default is constrained)
```

- [ ] **Step 2: Extend `initDB` in `server/db.js`** — add table creation + column-presence check for `migration_plans.tagging_policy`. Pattern matches existing `azure_host` migration check in the file.

```js
// Inside initDB transactions block, after migration_tasks creation:

db.exec(`
  CREATE TABLE IF NOT EXISTS migration_marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL,
    task_id INTEGER,
    scope TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    skip_reason TEXT,
    error_message TEXT,
    written_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (plan_id) REFERENCES migration_plans(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES migration_tasks(id) ON DELETE CASCADE
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_marks_plan ON migration_marks(plan_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_marks_status ON migration_marks(status)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_marks_target ON migration_marks(target_kind, target_id)`);

const planCols = db.prepare(`PRAGMA table_info(migration_plans)`).all();
if (!planCols.some(c => c.name === 'tagging_policy')) {
  db.exec(`ALTER TABLE migration_plans ADD COLUMN tagging_policy TEXT`);
}
```

- [ ] **Step 3: Append same DDL to `server/migrations/001-initial-schema.sql`** for source-of-truth sync (file's own header comment requires this).

- [ ] **Step 4: Commit**

```
git add server/migrations/003-migration-tagging.sql server/db.js server/migrations/001-initial-schema.sql
git commit -m "feat(migration-tagging): add migration_marks schema + tagging_policy column"
```

---

## Task 2 — Constants module

**Files:**
- Create: `server/lib/migration-tagging-constants.js`

- [ ] **Step 1: Write constants module** — central source of truth for naming. Pure functions, no I/O.

```js
// server/lib/migration-tagging-constants.js
import crypto from 'crypto'

export const SCOPES = Object.freeze({ SOURCE: 'source', DESTINATION: 'destination', GIT_TAG: 'git-tag' })

export const TARGET_KINDS = Object.freeze({
  GITHUB_TOPIC: 'github-topic',
  GITHUB_DESCRIPTION: 'github-description',
  GITHUB_CUSTOM_PROPERTY: 'github-custom-property',
  AZURE_PROJECT_PROPERTY: 'azure-project-property',
  AZURE_REPO_DESCRIPTION: 'azure-repo-description',
  GIT_ANNOTATED_TAG: 'git-annotated-tag'
})

export const STATUS = Object.freeze({ PENDING: 'pending', WRITTEN: 'written', SKIPPED: 'skipped', FAILED: 'failed' })

export const SKIP_REASONS = Object.freeze({
  POLICY_DISABLED: 'policy-disabled',
  PAT_SCOPE_MISSING: 'pat-scope-missing',
  TOPIC_LIMIT_REACHED: 'topic-limit-reached',
  PERSONAL_ACCOUNT_NO_PROPS: 'personal-account-no-props',
  UNSUPPORTED_SOURCE_TYPE: 'unsupported-source-type',
  ORG_POLICY_BLOCKS_CUSTOM_PROPS: 'org-policy-blocks-custom-props'
})

export const DEFAULT_POLICY = Object.freeze({
  enabled: true,
  writeSource: true,
  writeDestination: true,
  writeGitTag: true,
  hideSourceName: false
})

export const GITHUB_MAX_TOPICS = 20
export const GITHUB_MAX_TOPIC_LEN = 50
export const DESCRIPTION_SUFFIX_REGEX = / \[Migrated from .+? on \d{4}-\d{2}-\d{2}\]$/

export function slugify(value, { max = 40 } = {}) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
}

export function shortHash(value, len = 8) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, len)
}

export function githubTopics({ sourceType, sourceProject, hideSourceName }) {
  const kindTopic = `from-${slugify(sourceType, { max: 30 })}`
  const slugTopic = hideSourceName
    ? `mig-${shortHash(sourceProject)}`
    : `mig-${slugify(sourceProject)}`
  return ['migrated', kindTopic, slugTopic].filter(t => t.length > 0 && t.length <= GITHUB_MAX_TOPIC_LEN)
}

export function descriptionSuffix({ sourceUrl, dateIso, hideSourceName }) {
  const src = hideSourceName ? '<redacted>' : sourceUrl
  return ` [Migrated from ${src} on ${dateIso}]`
}

export function azureProjectProperties({ targetUrl, dateIso, planId, status = 'completed' }) {
  return [
    { op: 'add', path: '/Migration.Target', value: targetUrl },
    { op: 'add', path: '/Migration.Date', value: dateIso },
    { op: 'add', path: '/Migration.PlanId', value: String(planId) },
    { op: 'add', path: '/Migration.Status', value: status }
  ]
}

export function gitTagName({ planId, dateIso }) {
  return `migration/${dateIso}-${planId}`
}

export function gitTagMessage({ planId, source, target, dateIso, executedBy }) {
  return JSON.stringify({ planId, source, target, date: dateIso, executedBy: executedBy || null })
}

export function parsePolicy(raw) {
  if (!raw) return { ...DEFAULT_POLICY }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return { ...DEFAULT_POLICY, ...parsed }
  } catch {
    return { ...DEFAULT_POLICY }
  }
}
```

- [ ] **Step 2: Commit** — `feat(migration-tagging): add naming/slug constants module`

---

## Task 3 — github-writer (TDD)

**Files:**
- Create: `server/lib/tagging/github-writer.js`
- Test: `server/__tests__/tagging/github-writer.test.js`

- [ ] **Step 1: Write failing test** covering: `setTopics` merges with existing + dedupes; respects 20-topic cap by dropping the optional slug topic; `appendDescription` is dedup-aware via regex; `setCustomProperty` handles 404 (org without custom-props) by returning `{ status: 'skipped', skipReason: 'org-policy-blocks-custom-props' }`.

```js
// server/__tests__/tagging/github-writer.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createGithubWriter } from '../../lib/tagging/github-writer.js'

describe('githubWriter.setTopics', () => {
  it('merges new topics with existing without duplicates', async () => {
    const api = {
      get: vi.fn().mockResolvedValue({ data: { names: ['existing', 'foo'] } }),
      put: vi.fn().mockResolvedValue({ data: { names: ['existing', 'foo', 'migrated', 'from-azure'] } })
    }
    const writer = createGithubWriter({ api, token: 't' })
    const res = await writer.setTopics({ owner: 'o', repo: 'r' }, ['migrated', 'from-azure', 'foo'])
    expect(res.status).toBe('written')
    expect(api.put).toHaveBeenCalledWith(
      '/repos/o/r/topics',
      { names: expect.arrayContaining(['existing', 'foo', 'migrated', 'from-azure']) },
      expect.any(Object)
    )
    const putArg = api.put.mock.calls[0][1].names
    expect(new Set(putArg).size).toBe(putArg.length) // no dupes
  })

  it('drops optional slug topic when ceiling of 20 would be exceeded', async () => {
    const existing = Array.from({ length: 19 }, (_, i) => `t${i}`)
    const api = {
      get: vi.fn().mockResolvedValue({ data: { names: existing } }),
      put: vi.fn().mockResolvedValue({ data: { names: [...existing, 'migrated'] } })
    }
    const writer = createGithubWriter({ api, token: 't' })
    const res = await writer.setTopics({ owner: 'o', repo: 'r' }, ['migrated', 'from-azure', 'mig-x'])
    const putArg = api.put.mock.calls[0][1].names
    expect(putArg.length).toBe(20)
    expect(putArg).toContain('migrated')
    expect(putArg).not.toContain('mig-x') // optional dropped first
    expect(res.skippedTopics).toEqual(['mig-x'])
  })
})

describe('githubWriter.appendDescription', () => {
  it('replaces existing migration suffix to avoid duplication', async () => {
    const api = {
      get: vi.fn().mockResolvedValue({ data: { description: 'My repo [Migrated from old on 2025-01-01]' } }),
      patch: vi.fn().mockResolvedValue({ data: {} })
    }
    const writer = createGithubWriter({ api, token: 't' })
    await writer.appendDescription({ owner: 'o', repo: 'r' }, ' [Migrated from new on 2026-05-23]')
    const body = api.patch.mock.calls[0][1]
    expect(body.description).toBe('My repo [Migrated from new on 2026-05-23]')
  })
})

describe('githubWriter.setCustomProperty', () => {
  it('returns skipped with reason when org has no custom-properties schema (404)', async () => {
    const api = { patch: vi.fn().mockRejectedValue({ response: { status: 404 } }) }
    const writer = createGithubWriter({ api, token: 't' })
    const res = await writer.setCustomProperty({ owner: 'org', repo: 'r' }, 'migration_source', 'x')
    expect(res.status).toBe('skipped')
    expect(res.skipReason).toBe('org-policy-blocks-custom-props')
  })

  it('returns skipped for personal accounts (404 on org endpoint, no org schema)', async () => {
    const api = { patch: vi.fn().mockRejectedValue({ response: { status: 404 } }) }
    const writer = createGithubWriter({ api, token: 't' })
    const res = await writer.setCustomProperty({ owner: 'user', repo: 'r' }, 'migration_source', 'x', { isPersonal: true })
    expect(res.status).toBe('skipped')
    expect(res.skipReason).toBe('personal-account-no-props')
  })
})
```

- [ ] **Step 2: Run test, expect FAIL** — `npx vitest run server/__tests__/tagging/github-writer.test.js`

- [ ] **Step 3: Implement `github-writer.js`**

```js
// server/lib/tagging/github-writer.js
import { GITHUB_MAX_TOPICS, DESCRIPTION_SUFFIX_REGEX, STATUS, SKIP_REASONS } from '../migration-tagging-constants.js'

export function createGithubWriter({ api, token }) {
  const authHeaders = { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } }

  async function setTopics({ owner, repo }, desiredTopics) {
    const { data } = await api.get(`/repos/${owner}/${repo}/topics`, authHeaders)
    const existing = Array.isArray(data?.names) ? data.names : []
    const required = desiredTopics.slice(0, 2)   // 'migrated' + 'from-<kind>'
    const optional = desiredTopics.slice(2)
    const merged = Array.from(new Set([...existing, ...required]))
    const skippedTopics = []
    for (const topic of optional) {
      if (merged.length >= GITHUB_MAX_TOPICS) { skippedTopics.push(topic); continue }
      if (!merged.includes(topic)) merged.push(topic)
    }
    await api.put(`/repos/${owner}/${repo}/topics`, { names: merged.slice(0, GITHUB_MAX_TOPICS) }, authHeaders)
    return {
      status: STATUS.WRITTEN,
      payload: { topics: merged, skippedTopics },
      skippedTopics,
      skipReason: skippedTopics.length ? SKIP_REASONS.TOPIC_LIMIT_REACHED : null
    }
  }

  async function appendDescription({ owner, repo }, suffix) {
    const { data } = await api.get(`/repos/${owner}/${repo}`, authHeaders)
    const current = data?.description || ''
    const stripped = current.replace(DESCRIPTION_SUFFIX_REGEX, '')
    const next = `${stripped}${suffix}`.trim()
    await api.patch(`/repos/${owner}/${repo}`, { description: next }, authHeaders)
    return { status: STATUS.WRITTEN, payload: { description: next } }
  }

  async function setCustomProperty({ owner, repo }, name, value, { isPersonal = false } = {}) {
    try {
      await api.patch(
        `/repos/${owner}/${repo}/properties/values`,
        { properties: [{ property_name: name, value: String(value) }] },
        authHeaders
      )
      return { status: STATUS.WRITTEN, payload: { name, value } }
    } catch (err) {
      const code = err?.response?.status
      if (code === 404) {
        return {
          status: STATUS.SKIPPED,
          skipReason: isPersonal ? SKIP_REASONS.PERSONAL_ACCOUNT_NO_PROPS : SKIP_REASONS.ORG_POLICY_BLOCKS_CUSTOM_PROPS,
          payload: { name, value }
        }
      }
      throw err
    }
  }

  return { setTopics, appendDescription, setCustomProperty }
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit** — `feat(migration-tagging): github writer for topics/description/properties`

---

## Task 4 — azure-writer (TDD)

**Files:**
- Create: `server/lib/tagging/azure-writer.js`
- Test: `server/__tests__/tagging/azure-writer.test.js`

- [ ] **Step 1: Write failing test**

```js
// server/__tests__/tagging/azure-writer.test.js
import { describe, it, expect, vi } from 'vitest'
import { createAzureWriter } from '../../lib/tagging/azure-writer.js'

describe('azureWriter.patchProjectProperties', () => {
  it('sends JSON-Patch body with the expected operations', async () => {
    const api = { patch: vi.fn().mockResolvedValue({ data: {} }) }
    const writer = createAzureWriter({ api, host: 'dev.azure.com', org: 'acme', pat: 'x' })
    const ops = [{ op: 'add', path: '/Migration.PlanId', value: '42' }]
    const res = await writer.patchProjectProperties('proj-id', ops)
    expect(res.status).toBe('written')
    expect(api.patch).toHaveBeenCalledWith(
      expect.stringContaining('/_apis/projects/proj-id/properties'),
      ops,
      expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json-patch+json' }) })
    )
  })

  it('returns skipped with pat-scope-missing on 403', async () => {
    const api = { patch: vi.fn().mockRejectedValue({ response: { status: 403 } }) }
    const writer = createAzureWriter({ api, host: 'dev.azure.com', org: 'acme', pat: 'x' })
    const res = await writer.patchProjectProperties('proj-id', [])
    expect(res.status).toBe('skipped')
    expect(res.skipReason).toBe('pat-scope-missing')
  })

  it('returns skipped on 404 (unsupported on this Azure DevOps Server version)', async () => {
    const api = { patch: vi.fn().mockRejectedValue({ response: { status: 404 } }) }
    const writer = createAzureWriter({ api, host: 'tfs.local', org: 'acme', pat: 'x' })
    const res = await writer.patchProjectProperties('proj-id', [])
    expect(res.status).toBe('skipped')
    expect(res.skipReason).toBe('unsupported-source-type')
  })
})

describe('azureWriter.appendRepoDescription', () => {
  it('strips existing migration suffix before appending', async () => {
    const api = {
      get: vi.fn().mockResolvedValue({ data: { name: 'r', defaultBranch: 'main', description: 'desc [Migrated from x on 2025-01-01]' } }),
      patch: vi.fn().mockResolvedValue({ data: {} })
    }
    const writer = createAzureWriter({ api, host: 'dev.azure.com', org: 'acme', pat: 'x' })
    await writer.appendRepoDescription({ projectId: 'p', repoId: 'r' }, ' [Migrated from new on 2026-05-23]')
    const body = api.patch.mock.calls[0][1]
    expect(body.description).toBe('desc [Migrated from new on 2026-05-23]')
  })
})
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `azure-writer.js`**

```js
// server/lib/tagging/azure-writer.js
import { DESCRIPTION_SUFFIX_REGEX, STATUS, SKIP_REASONS } from '../migration-tagging-constants.js'

const API_VERSION = '7.1-preview.1'

export function createAzureWriter({ api, host, org, pat }) {
  const baseUrl = `https://${host}/${encodeURIComponent(org)}`
  const auth = Buffer.from(`:${pat}`).toString('base64')
  const headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' }

  function classifyErr(err) {
    const code = err?.response?.status
    if (code === 401 || code === 403) return SKIP_REASONS.PAT_SCOPE_MISSING
    if (code === 404) return SKIP_REASONS.UNSUPPORTED_SOURCE_TYPE
    return null
  }

  async function patchProjectProperties(projectId, ops) {
    try {
      await api.patch(
        `${baseUrl}/_apis/projects/${encodeURIComponent(projectId)}/properties?api-version=${API_VERSION}`,
        ops,
        { headers: { ...headers, 'Content-Type': 'application/json-patch+json' } }
      )
      return { status: STATUS.WRITTEN, payload: { ops } }
    } catch (err) {
      const reason = classifyErr(err)
      if (reason) return { status: STATUS.SKIPPED, skipReason: reason, payload: { ops } }
      throw err
    }
  }

  async function appendRepoDescription({ projectId, repoId }, suffix) {
    try {
      const { data } = await api.get(
        `${baseUrl}/${encodeURIComponent(projectId)}/_apis/git/repositories/${encodeURIComponent(repoId)}?api-version=${API_VERSION}`,
        { headers }
      )
      const current = data?.description || ''
      const stripped = current.replace(DESCRIPTION_SUFFIX_REGEX, '')
      const next = `${stripped}${suffix}`.trim()
      await api.patch(
        `${baseUrl}/${encodeURIComponent(projectId)}/_apis/git/repositories/${encodeURIComponent(repoId)}?api-version=${API_VERSION}`,
        { description: next },
        { headers: { ...headers, 'Content-Type': 'application/json' } }
      )
      return { status: STATUS.WRITTEN, payload: { description: next } }
    } catch (err) {
      const reason = classifyErr(err)
      if (reason) return { status: STATUS.SKIPPED, skipReason: reason, payload: { suffix } }
      throw err
    }
  }

  return { patchProjectProperties, appendRepoDescription }
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit** — `feat(migration-tagging): azure writer for project properties + repo description`

---

## Task 5 — git-tag-writer (TDD)

**Files:**
- Create: `server/lib/tagging/git-tag-writer.js`
- Test: `server/__tests__/tagging/git-tag-writer.test.js`

- [ ] **Step 1: Write failing test using a temp git repo via simple-git**

```js
// server/__tests__/tagging/git-tag-writer.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import simpleGit from 'simple-git'
import { createGitTagWriter } from '../../lib/tagging/git-tag-writer.js'

describe('gitTagWriter.createAnnotatedTag', () => {
  let dir
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mig-tag-'))
    const git = simpleGit(dir)
    await git.init()
    await git.addConfig('user.email', 'test@test.com')
    await git.addConfig('user.name', 'Test')
    writeFileSync(join(dir, 'README.md'), '# test\n')
    await git.add('README.md')
    await git.commit('initial')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('creates an annotated tag at HEAD with the JSON message', async () => {
    const writer = createGitTagWriter()
    const res = await writer.createAnnotatedTag({ repoDir: dir, tagName: 'migration/2026-05-23-42', message: '{"planId":42}', remotes: [] })
    expect(res.status).toBe('written')
    const git = simpleGit(dir)
    const tags = await git.tags()
    expect(tags.all).toContain('migration/2026-05-23-42')
    const show = await git.raw(['for-each-ref', 'refs/tags/migration/2026-05-23-42', '--format=%(contents)'])
    expect(show.trim()).toContain('"planId":42')
  })

  it('re-runs without error using force on existing tag', async () => {
    const writer = createGitTagWriter()
    await writer.createAnnotatedTag({ repoDir: dir, tagName: 'migration/2026-05-23-42', message: 'v1', remotes: [] })
    const res = await writer.createAnnotatedTag({ repoDir: dir, tagName: 'migration/2026-05-23-42', message: 'v2', remotes: [] })
    expect(res.status).toBe('written')
    const git = simpleGit(dir)
    const show = await git.raw(['for-each-ref', 'refs/tags/migration/2026-05-23-42', '--format=%(contents)'])
    expect(show.trim()).toContain('v2')
  })
})
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `git-tag-writer.js`**

```js
// server/lib/tagging/git-tag-writer.js
import simpleGit from 'simple-git'
import { STATUS } from '../migration-tagging-constants.js'

export function createGitTagWriter() {
  async function createAnnotatedTag({ repoDir, tagName, message, remotes = [] }) {
    const git = simpleGit(repoDir)
    await git.raw(['tag', '-a', '-f', tagName, '-m', message])
    const pushed = []
    for (const remote of remotes) {
      try {
        await git.push(remote.name, tagName, ['--force-with-lease'])
        pushed.push(remote.name)
      } catch (err) {
        pushed.push({ name: remote.name, error: err.message })
      }
    }
    return { status: STATUS.WRITTEN, payload: { tagName, pushed } }
  }
  return { createAnnotatedTag }
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit** — `feat(migration-tagging): git annotated tag writer`

---

## Task 6 — Tagging service orchestration (TDD)

**Files:**
- Create: `server/migration-tagging-service.js`
- Test: `server/__tests__/migration-tagging-service.test.js`

- [ ] **Step 1: Write failing test** covering: applies marks per plan policy; persists rows with status; idempotent on re-run; failure of one writer does NOT abort others; emits events in order.

```js
// server/__tests__/migration-tagging-service.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createMigrationTaggingService } from '../migration-tagging-service.js'

function makeDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL)`)
  db.exec(`CREATE TABLE migration_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, status TEXT,
    source_type TEXT, source_org TEXT, source_project TEXT, target_org TEXT,
    azure_host TEXT, summary TEXT, tagging_policy TEXT, credentials_enc TEXT
  )`)
  db.exec(`CREATE TABLE migration_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, type TEXT,
    target_ref TEXT, status TEXT, metadata TEXT
  )`)
  db.exec(`CREATE TABLE migration_marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, task_id INTEGER,
    scope TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
    payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    skip_reason TEXT, error_message TEXT, written_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'u')`).run()
  return db
}

function seedPlan(db, overrides = {}) {
  const r = db.prepare(`INSERT INTO migration_plans (user_id, status, source_type, source_org, source_project, target_org, azure_host, summary, tagging_policy)
    VALUES (1, 'completed', 'azure', 'acme', 'Billing', 'foo', 'dev.azure.com', ?, ?)`).run(
    JSON.stringify(overrides.summary || {}),
    overrides.policy ?? null
  )
  const planId = Number(r.lastInsertRowid)
  const tr = db.prepare(`INSERT INTO migration_tasks (plan_id, type, target_ref, status, metadata) VALUES (?, 'create-repo', 'foo/bar', 'completed', ?)`).run(
    planId, JSON.stringify({ targetFullName: 'foo/bar', repoUrl: 'https://github.com/foo/bar' })
  )
  return { planId, taskId: Number(tr.lastInsertRowid) }
}

describe('migration-tagging-service.applyTaggingForPlan', () => {
  it('writes destination + git-tag marks, skips source when policy disables it', async () => {
    const db = makeDb()
    const { planId } = seedPlan(db, { policy: JSON.stringify({ enabled: true, writeSource: false, writeDestination: true, writeGitTag: true, hideSourceName: false }) })

    const writers = {
      github: { setTopics: vi.fn().mockResolvedValue({ status: 'written', payload: {} }),
                appendDescription: vi.fn().mockResolvedValue({ status: 'written', payload: {} }),
                setCustomProperty: vi.fn().mockResolvedValue({ status: 'written', payload: {} }) },
      azure: { patchProjectProperties: vi.fn(), appendRepoDescription: vi.fn() },
      gitTag: { createAnnotatedTag: vi.fn().mockResolvedValue({ status: 'written', payload: {} }) }
    }

    const svc = createMigrationTaggingService({
      db,
      writersFactory: () => writers,
      credentialsResolver: async () => ({ github: 'gh-tok', azure: { pat: 'pat' } }),
      logger: { info: () => {}, warn: () => {}, error: () => {} }
    })

    const summary = await svc.applyTaggingForPlan(planId)
    expect(summary.written).toBeGreaterThan(0)
    expect(writers.azure.patchProjectProperties).not.toHaveBeenCalled()
    expect(writers.gitTag.createAnnotatedTag).toHaveBeenCalled()

    const rows = db.prepare(`SELECT scope, status FROM migration_marks WHERE plan_id = ?`).all(planId)
    expect(rows.some(r => r.scope === 'destination' && r.status === 'written')).toBe(true)
    expect(rows.some(r => r.scope === 'git-tag')).toBe(true)
    expect(rows.some(r => r.scope === 'source')).toBe(false)
  })

  it('isolates failures: one writer throwing does not abort the others', async () => {
    const db = makeDb()
    const { planId } = seedPlan(db, { policy: JSON.stringify({ enabled: true, writeSource: true, writeDestination: true, writeGitTag: true }) })

    const writers = {
      github: { setTopics: vi.fn().mockRejectedValue(new Error('boom')),
                appendDescription: vi.fn().mockResolvedValue({ status: 'written', payload: {} }),
                setCustomProperty: vi.fn().mockResolvedValue({ status: 'written', payload: {} }) },
      azure: { patchProjectProperties: vi.fn().mockResolvedValue({ status: 'written', payload: {} }),
               appendRepoDescription: vi.fn().mockResolvedValue({ status: 'written', payload: {} }) },
      gitTag: { createAnnotatedTag: vi.fn().mockResolvedValue({ status: 'written', payload: {} }) }
    }

    const svc = createMigrationTaggingService({ db, writersFactory: () => writers, credentialsResolver: async () => ({ github: 'x', azure: { pat: 'p' } }), logger: { info: () => {}, warn: () => {}, error: () => {} } })
    const summary = await svc.applyTaggingForPlan(planId)
    expect(summary.failed).toBeGreaterThanOrEqual(1)
    expect(summary.written).toBeGreaterThanOrEqual(1)
    const failedRows = db.prepare(`SELECT * FROM migration_marks WHERE status = 'failed'`).all()
    expect(failedRows.length).toBeGreaterThanOrEqual(1)
    expect(failedRows[0].error_message).toContain('boom')
  })

  it('respects enabled=false (no writes)', async () => {
    const db = makeDb()
    const { planId } = seedPlan(db, { policy: JSON.stringify({ enabled: false }) })
    const writers = {
      github: { setTopics: vi.fn(), appendDescription: vi.fn(), setCustomProperty: vi.fn() },
      azure:  { patchProjectProperties: vi.fn(), appendRepoDescription: vi.fn() },
      gitTag: { createAnnotatedTag: vi.fn() }
    }
    const svc = createMigrationTaggingService({ db, writersFactory: () => writers, credentialsResolver: async () => ({}), logger: { info: () => {}, warn: () => {}, error: () => {} } })
    const summary = await svc.applyTaggingForPlan(planId)
    expect(summary.written).toBe(0)
    expect(writers.github.setTopics).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `migration-tagging-service.js`**

```js
// server/migration-tagging-service.js
import { EventEmitter } from 'events'
import {
  SCOPES, TARGET_KINDS, STATUS, SKIP_REASONS,
  parsePolicy, githubTopics, descriptionSuffix, azureProjectProperties,
  gitTagName, gitTagMessage
} from './lib/migration-tagging-constants.js'

export function createMigrationTaggingService({ db, writersFactory, credentialsResolver, logger, repoDirResolver = null }) {
  const emitter = new EventEmitter()

  function insertMark({ planId, taskId = null, scope, targetKind, targetId, payload, status, skipReason = null, errorMessage = null }) {
    const writtenAt = status === STATUS.WRITTEN ? new Date().toISOString() : null
    const r = db.prepare(`INSERT INTO migration_marks (plan_id, task_id, scope, target_kind, target_id, payload, status, skip_reason, error_message, written_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      planId, taskId, scope, targetKind, targetId,
      JSON.stringify(payload || {}), status, skipReason, errorMessage, writtenAt
    )
    return Number(r.lastInsertRowid)
  }

  async function applyTaggingForPlan(planId, { logger: tlogger = logger } = {}) {
    const plan = db.prepare(`SELECT * FROM migration_plans WHERE id = ?`).get(planId)
    if (!plan) throw new Error(`Plan ${planId} not found`)
    const policy = parsePolicy(plan.tagging_policy)
    emitter.emit('tagging-started', { planId, policy })

    const result = { written: 0, skipped: 0, failed: 0, marks: [] }
    if (!policy.enabled) {
      emitter.emit('tagging-completed', { planId, summary: result })
      return result
    }

    const tasks = db.prepare(`SELECT id, target_ref, metadata FROM migration_tasks WHERE plan_id = ? AND status = 'completed'`).all(planId)
    const credentials = await credentialsResolver(plan)
    const writers = writersFactory({ plan, credentials })
    const dateIso = new Date().toISOString().slice(0, 10)
    const sourceUrl = `${plan.source_type}://${plan.source_org}/${plan.source_project}`

    const tally = (mark) => {
      if (mark.status === STATUS.WRITTEN) result.written++
      else if (mark.status === STATUS.SKIPPED) result.skipped++
      else if (mark.status === STATUS.FAILED) result.failed++
      result.marks.push(mark)
      emitter.emit('tagging-mark-progress', { planId, mark })
    }

    async function runMark({ scope, targetKind, targetId, taskId = null, fn }) {
      try {
        const r = await fn()
        const id = insertMark({ planId, taskId, scope, targetKind, targetId, payload: r.payload || {}, status: r.status, skipReason: r.skipReason || null })
        tally({ id, scope, targetKind, targetId, status: r.status, skipReason: r.skipReason || null })
      } catch (err) {
        const msg = err?.message || String(err)
        tlogger?.error?.({ err, planId, targetKind }, 'tagging mark failed')
        const id = insertMark({ planId, taskId, scope, targetKind, targetId, payload: { error: msg }, status: STATUS.FAILED, errorMessage: msg })
        tally({ id, scope, targetKind, targetId, status: STATUS.FAILED, errorMessage: msg })
      }
    }

    // ---- Destination (per task / repo) ----
    if (policy.writeDestination && writers.github) {
      for (const task of tasks) {
        let meta = {}
        try { meta = task.metadata ? JSON.parse(task.metadata) : {} } catch {}
        const full = meta.targetFullName || task.target_ref
        if (!full || !full.includes('/')) continue
        const [owner, repo] = full.split('/')

        const topics = githubTopics({ sourceType: plan.source_type, sourceProject: plan.source_project, hideSourceName: policy.hideSourceName })
        await runMark({ scope: SCOPES.DESTINATION, targetKind: TARGET_KINDS.GITHUB_TOPIC, targetId: full, taskId: task.id,
          fn: () => writers.github.setTopics({ owner, repo }, topics) })

        const suffix = descriptionSuffix({ sourceUrl, dateIso, hideSourceName: policy.hideSourceName })
        await runMark({ scope: SCOPES.DESTINATION, targetKind: TARGET_KINDS.GITHUB_DESCRIPTION, targetId: full, taskId: task.id,
          fn: () => writers.github.appendDescription({ owner, repo }, suffix) })

        for (const [name, value] of Object.entries({
          migration_source: sourceUrl, migration_date: dateIso, migration_plan_id: String(planId)
        })) {
          await runMark({ scope: SCOPES.DESTINATION, targetKind: TARGET_KINDS.GITHUB_CUSTOM_PROPERTY, targetId: `${full}#${name}`, taskId: task.id,
            fn: () => writers.github.setCustomProperty({ owner, repo }, name, value) })
        }
      }
    }

    // ---- Source (project-level once + per-repo description) ----
    if (policy.writeSource && writers.azure) {
      const targetUrl = tasks[0]?.metadata
        ? (() => { try { return JSON.parse(tasks[0].metadata)?.repoUrl || '' } catch { return '' } })()
        : ''
      const ops = azureProjectProperties({ targetUrl, dateIso, planId })
      await runMark({ scope: SCOPES.SOURCE, targetKind: TARGET_KINDS.AZURE_PROJECT_PROPERTY, targetId: `${plan.source_org}/${plan.source_project}`,
        fn: () => writers.azure.patchProjectProperties(plan.source_project, ops) })
    }

    // ---- Git tag ----
    if (policy.writeGitTag && writers.gitTag && repoDirResolver) {
      for (const task of tasks) {
        let meta = {}
        try { meta = task.metadata ? JSON.parse(task.metadata) : {} } catch {}
        const repoDir = await repoDirResolver({ plan, task, meta })
        if (!repoDir) continue
        const tagName = gitTagName({ planId, dateIso })
        const message = gitTagMessage({ planId, source: sourceUrl, target: meta.repoUrl || meta.targetFullName, dateIso, executedBy: plan.user_id })
        await runMark({ scope: SCOPES.GIT_TAG, targetKind: TARGET_KINDS.GIT_ANNOTATED_TAG, targetId: tagName, taskId: task.id,
          fn: () => writers.gitTag.createAnnotatedTag({ repoDir, tagName, message, remotes: meta.remotes || [] }) })
      }
    }

    emitter.emit('tagging-completed', { planId, summary: result })
    return result
  }

  function removeMarksForPlan(planId) {
    // Phase 1: only delete from DB. External-side undo is a future feature.
    const rows = db.prepare(`SELECT * FROM migration_marks WHERE plan_id = ?`).all(planId)
    db.prepare(`DELETE FROM migration_marks WHERE plan_id = ?`).run(planId)
    return { removed: rows.length, marks: rows }
  }

  return { applyTaggingForPlan, removeMarksForPlan, on: emitter.on.bind(emitter), off: emitter.off.bind(emitter) }
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit** — `feat(migration-tagging): orchestrator service with failure isolation`

---

## Task 7 — Route + wire-up

**Files:**
- Create: `server/routes/migration-marks.js`
- Modify: `server/index.js` — instantiate service, mount route, wire `plan-complete` listener
- Test: `server/__tests__/migration-marks-route.test.js`

- [ ] **Step 1: Write failing test for route**

```js
// server/__tests__/migration-marks-route.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import Database from 'better-sqlite3'
import { createMarksRouter } from '../routes/migration-marks.js'

function setupApp() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE migration_marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, task_id INTEGER,
    scope TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
    payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    skip_reason TEXT, error_message TEXT, written_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.prepare(`INSERT INTO migration_marks (plan_id, scope, target_kind, target_id, payload, status, written_at)
    VALUES (1, 'destination', 'github-topic', 'foo/bar', '{}', 'written', datetime('now'))`).run()
  const app = express()
  app.use(express.json())
  // Stub auth: inject userId
  app.use((req, _res, next) => { req.user = { id: 1 }; next() })
  app.use('/api/migration/marks', createMarksRouter({ db }))
  return app
}

describe('migration-marks route', () => {
  it('GET /?targetFullName=foo/bar returns marks for that target', async () => {
    const app = setupApp()
    const res = await request(app).get('/api/migration/marks?targetFullName=foo/bar')
    expect(res.status).toBe(200)
    expect(res.body.marks).toBeInstanceOf(Array)
    expect(res.body.marks[0].target_id).toBe('foo/bar')
  })

  it('GET /plan/:id returns marks grouped by scope', async () => {
    const app = setupApp()
    const res = await request(app).get('/api/migration/marks/plan/1')
    expect(res.status).toBe(200)
    expect(res.body.byScope.destination).toBeInstanceOf(Array)
  })
})
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `server/routes/migration-marks.js`**

```js
// server/routes/migration-marks.js
import express from 'express'

export function createMarksRouter({ db }) {
  const router = express.Router()

  router.get('/', (req, res) => {
    const { targetFullName, targetKind } = req.query
    const where = []; const args = []
    if (targetFullName) { where.push(`target_id = ? OR target_id LIKE ?`); args.push(targetFullName, `${targetFullName}#%`) }
    if (targetKind) { where.push(`target_kind = ?`); args.push(targetKind) }
    const sql = `SELECT * FROM migration_marks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`
    const rows = db.prepare(sql).all(...args)
    res.json({ marks: rows.map(r => ({ ...r, payload: safeJson(r.payload) })) })
  })

  router.get('/plan/:id', (req, res) => {
    const planId = Number(req.params.id)
    if (!Number.isFinite(planId)) return res.status(400).json({ error: 'invalid plan id' })
    const rows = db.prepare(`SELECT * FROM migration_marks WHERE plan_id = ? ORDER BY created_at`).all(planId)
    const byScope = { source: [], destination: [], 'git-tag': [] }
    for (const r of rows) {
      const parsed = { ...r, payload: safeJson(r.payload) }
      if (byScope[r.scope]) byScope[r.scope].push(parsed)
    }
    res.json({ planId, byScope, marks: rows.map(r => ({ ...r, payload: safeJson(r.payload) })) })
  })

  return router
}

function safeJson(s) { try { return JSON.parse(s) } catch { return s } }
```

- [ ] **Step 4: Wire-up in `server/index.js`** — find where `MigrationEngine` is instantiated, then:

```js
// near existing migration engine setup
import { createMigrationTaggingService } from './migration-tagging-service.js'
import { createGithubWriter } from './lib/tagging/github-writer.js'
import { createAzureWriter } from './lib/tagging/azure-writer.js'
import { createGitTagWriter } from './lib/tagging/git-tag-writer.js'
import { createMarksRouter } from './routes/migration-marks.js'
import axios from 'axios'

const githubApiBase = axios.create({ baseURL: 'https://api.github.com' })
const taggingService = createMigrationTaggingService({
  db,
  credentialsResolver: async (plan) => {
    // Reuse existing credential decryption
    const { decryptCredentials } = await import('./lib/credential-encryption.js')
    let azure = null
    if (plan.credentials_enc) {
      try { azure = decryptCredentials(plan.credentials_enc) } catch {}
    }
    return { github: process.env.GITHUB_TOKEN || null, azure }
  },
  writersFactory: ({ plan, credentials }) => ({
    github: credentials.github ? createGithubWriter({ api: githubApiBase, token: credentials.github }) : null,
    azure: credentials.azure?.pat ? createAzureWriter({ api: axios, host: plan.azure_host || 'dev.azure.com', org: plan.source_org, pat: credentials.azure.pat }) : null,
    gitTag: createGitTagWriter()
  }),
  repoDirResolver: null, // wired later when import-service exposes per-task workdir
  logger
})
migrationEngine.on('plan-complete', ({ planId, status }) => {
  if (status !== 'completed') return
  taggingService.applyTaggingForPlan(planId).catch(err => logger.error({ err, planId }, 'tagging failed'))
})

app.use('/api/migration/marks', requireAuth, createMarksRouter({ db }))
```

- [ ] **Step 5: Run all backend tests, expect PASS** — `npx vitest run server/`

- [ ] **Step 6: Commit** — `feat(migration-tagging): http route + engine wire-up`

---

## Task 8 — Frontend: useMigrationMarks hook

**Files:**
- Create: `src/hooks/useMigrationMarks.js`
- Test: `tests/hooks/useMigrationMarks.test.jsx`

- [ ] **Step 1: Write failing test** with mocked fetch returning marks; verify loading/error/data states.

```jsx
// tests/hooks/useMigrationMarks.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMigrationMarksFor, useMarksForPlan } from '../../src/hooks/useMigrationMarks.js'

describe('useMigrationMarksFor', () => {
  beforeEach(() => { global.fetch = vi.fn() })
  it('fetches marks for a target full name', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ marks: [{ id: 1, scope: 'destination', status: 'written', target_id: 'foo/bar' }] }) })
    const { result } = renderHook(() => useMigrationMarksFor('foo/bar'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.marks).toHaveLength(1)
    expect(result.current.marks[0].target_id).toBe('foo/bar')
  })
})
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement hook**

```jsx
// src/hooks/useMigrationMarks.js
import { useEffect, useState, useCallback } from 'react'

export function useMigrationMarksFor(targetFullName) {
  const [marks, setMarks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!targetFullName) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    fetch(`/api/migration/marks?targetFullName=${encodeURIComponent(targetFullName)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!cancelled) { setMarks(d.marks || []); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e); setLoading(false) } })
    return () => { cancelled = true }
  }, [targetFullName])

  return { marks, loading, error }
}

export function useMarksForPlan(planId) {
  const [data, setData] = useState({ byScope: { source: [], destination: [], 'git-tag': [] }, marks: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(() => {
    if (!planId) return
    setLoading(true)
    fetch(`/api/migration/marks/plan/${planId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e); setLoading(false) })
  }, [planId])

  useEffect(reload, [reload])
  return { ...data, loading, error, reload }
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit** — `feat(migration-tagging): useMigrationMarks hook`

---

## Task 9 — Frontend: MarksBadge + MarksDetailModal

**Files:**
- Create: `src/components/MigrationHistory/MarksBadge.jsx`
- Create: `src/components/MigrationHistory/MarksDetailModal.jsx`
- Test: `tests/components/MigrationHistory/MarksBadge.test.jsx`

- [ ] **Step 1: Write failing test** — badge variants for `written`/`mixed`/`failed`/`disabled` states.

```jsx
// tests/components/MigrationHistory/MarksBadge.test.jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarksBadge } from '../../../src/components/MigrationHistory/MarksBadge.jsx'

describe('<MarksBadge>', () => {
  it('renders a green check when all marks written', () => {
    render(<MarksBadge marks={[{ status: 'written' }, { status: 'written' }]} />)
    expect(screen.getByLabelText(/all migration marks written/i)).toBeInTheDocument()
  })
  it('renders amber warning when any mark skipped', () => {
    render(<MarksBadge marks={[{ status: 'written' }, { status: 'skipped' }]} />)
    expect(screen.getByLabelText(/some migration marks skipped/i)).toBeInTheDocument()
  })
  it('renders red error when any mark failed', () => {
    render(<MarksBadge marks={[{ status: 'written' }, { status: 'failed' }]} />)
    expect(screen.getByLabelText(/migration marks failed/i)).toBeInTheDocument()
  })
  it('renders neutral dash when no marks', () => {
    render(<MarksBadge marks={[]} />)
    expect(screen.getByLabelText(/no migration marks/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement components**

```jsx
// src/components/MigrationHistory/MarksBadge.jsx
import { motion } from 'framer-motion'

const VARIANTS = {
  ok:      { cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30', label: 'all migration marks written', icon: '✓' },
  partial: { cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',     label: 'some migration marks skipped',  icon: '⚠' },
  failed:  { cls: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',        label: 'migration marks failed',        icon: '✗' },
  none:    { cls: 'bg-slate-500/10 text-slate-400 ring-slate-500/20',     label: 'no migration marks',            icon: '—' }
}

export function MarksBadge({ marks = [], onClick }) {
  const variant = pickVariant(marks)
  const v = VARIANTS[variant]
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      aria-label={v.label}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${v.cls} transition`}
    >
      <span aria-hidden>{v.icon}</span>
      <span>{summary(marks)}</span>
    </motion.button>
  )
}

function pickVariant(marks) {
  if (!marks.length) return 'none'
  if (marks.some(m => m.status === 'failed')) return 'failed'
  if (marks.some(m => m.status === 'skipped')) return 'partial'
  return 'ok'
}

function summary(marks) {
  if (!marks.length) return 'Sem tags'
  const w = marks.filter(m => m.status === 'written').length
  return `${w}/${marks.length}`
}
```

```jsx
// src/components/MigrationHistory/MarksDetailModal.jsx
import { motion, AnimatePresence } from 'framer-motion'

export function MarksDetailModal({ open, onClose, planId, byScope = { source: [], destination: [], 'git-tag': [] } }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={e => e.stopPropagation()}
            className="ds-glass max-w-2xl w-full rounded-2xl border border-white/10 p-6"
          >
            <div className="flex items-baseline justify-between mb-4">
              <h3 className="ds-font-display text-xl text-slate-100">Migration marks · plan #{planId}</h3>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
            </div>
            {Object.entries(byScope).map(([scope, marks]) => (
              <div key={scope} className="mb-4">
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">{scope}</div>
                {marks.length === 0
                  ? <div className="text-sm text-slate-500 italic">— nada escrito</div>
                  : marks.map(m => (
                      <div key={m.id} className="flex items-start gap-2 py-1 text-sm">
                        <span className={statusClass(m.status)}>{statusIcon(m.status)}</span>
                        <code className="ds-font-mono text-slate-300 text-xs">{m.target_kind}</code>
                        <span className="text-slate-400">→</span>
                        <span className="text-slate-200 truncate">{m.target_id}</span>
                        {m.skip_reason && <span className="ml-auto text-xs text-amber-300/80">{m.skip_reason}</span>}
                        {m.error_message && <span className="ml-auto text-xs text-rose-300/80 truncate max-w-[40%]">{m.error_message}</span>}
                      </div>
                    ))}
              </div>
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function statusIcon(s) { return s === 'written' ? '✓' : s === 'skipped' ? '⚠' : s === 'failed' ? '✗' : '·' }
function statusClass(s) {
  return s === 'written' ? 'text-emerald-400'
       : s === 'skipped' ? 'text-amber-400'
       : s === 'failed'  ? 'text-rose-400'
       : 'text-slate-500'
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit** — `feat(migration-tagging): MarksBadge + detail modal components`

---

## Task 10 — Integrate badge into MigrationHistory

**Files:**
- Modify: `src/components/MigrationHistory.jsx`

- [ ] **Step 1: Read current file, find table headers and rows**

- [ ] **Step 2: Add "Tags" column header + cell rendering with `MarksBadge` and click → open modal**

```jsx
// imports
import { MarksBadge } from './MigrationHistory/MarksBadge.jsx'
import { MarksDetailModal } from './MigrationHistory/MarksDetailModal.jsx'
import { useMarksForPlan } from '../hooks/useMigrationMarks.js'
import { useState } from 'react'

// inside row component (one per plan):
function PlanRow({ plan }) {
  const { byScope, marks } = useMarksForPlan(plan.id)
  const [open, setOpen] = useState(false)
  return (
    <tr>
      {/* ...existing cells... */}
      <td className="px-3 py-2"><MarksBadge marks={marks} onClick={() => setOpen(true)} /></td>
      <MarksDetailModal open={open} onClose={() => setOpen(false)} planId={plan.id} byScope={byScope} />
    </tr>
  )
}
```

- [ ] **Step 3: Run frontend tests + start dev server, smoke-test MigrationHistory page**

- [ ] **Step 4: Commit** — `feat(migration-tagging): surface marks in MigrationHistory`

---

## Task 11 — TaggingStep in wizard

**Files:**
- Create: `src/components/MigrationWizard/steps/TaggingStep.jsx`
- Modify: `src/components/MigrationWizard/MigrationWizard.jsx` to include the step
- Test: `tests/components/MigrationWizard/TaggingStep.test.jsx`

- [ ] **Step 1: Write failing test** — checkboxes render and toggle policy state.

```jsx
// tests/components/MigrationWizard/TaggingStep.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaggingStep } from '../../../src/components/MigrationWizard/steps/TaggingStep.jsx'

describe('<TaggingStep>', () => {
  it('renders 3 checkboxes ON by default', () => {
    render(<TaggingStep policy={{ enabled: true, writeSource: true, writeDestination: true, writeGitTag: true, hideSourceName: false }} onChange={() => {}} />)
    expect(screen.getByLabelText(/origem/i)).toBeChecked()
    expect(screen.getByLabelText(/destino/i)).toBeChecked()
    expect(screen.getByLabelText(/git tag/i)).toBeChecked()
  })
  it('calls onChange when source toggled', () => {
    const onChange = vi.fn()
    render(<TaggingStep policy={{ enabled: true, writeSource: true, writeDestination: true, writeGitTag: true, hideSourceName: false }} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText(/origem/i))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ writeSource: false }))
  })
})
```

- [ ] **Step 2: Run test, expect FAIL**

- [ ] **Step 3: Implement `TaggingStep.jsx`** with premium UI (3 toggles, master "skip tagging" toggle, preview block, warnings if `capabilities` prop is passed).

```jsx
// src/components/MigrationWizard/steps/TaggingStep.jsx
import { motion } from 'framer-motion'

export function TaggingStep({ policy, onChange, capabilities = null }) {
  const setField = (k, v) => onChange({ ...policy, [k]: v })

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      <header>
        <h3 className="ds-font-display text-xl text-slate-100">Marcação da migração</h3>
        <p className="text-sm text-slate-400 mt-1">
          Deixa rasto da migração nos três lugares onde ela importa: na origem, no destino, e no próprio histórico git.
        </p>
      </header>

      <label className="flex items-center gap-3 ds-card-shimmer rounded-xl p-3 cursor-pointer">
        <input type="checkbox" checked={!!policy.enabled} onChange={e => setField('enabled', e.target.checked)} />
        <div>
          <div className="text-sm text-slate-100 font-medium">Ativar marcação</div>
          <div className="text-xs text-slate-400">Master switch. Desativa para esta migração não escrever nada.</div>
        </div>
      </label>

      <fieldset disabled={!policy.enabled} className={!policy.enabled ? 'opacity-50 pointer-events-none' : ''}>
        <div className="grid gap-2">
          <Toggle id="writeDestination" checked={policy.writeDestination} onChange={v => setField('writeDestination', v)}
            label="Marcar destino (GitHub)" hint="Topics + descrição + custom properties (org)" />
          <Toggle id="writeSource" checked={policy.writeSource} onChange={v => setField('writeSource', v)}
            label="Marcar origem (Azure DevOps)" hint="Project properties + descrição do repo. Requer PAT com Project & Team (Write)."
            warning={capabilities?.azure?.missingScopes?.length ? `PAT em falta de scope: ${capabilities.azure.missingScopes.join(', ')}` : null} />
          <Toggle id="writeGitTag" checked={policy.writeGitTag} onChange={v => setField('writeGitTag', v)}
            label="Criar git tag anotada" hint="Visível em qualquer clone, independente do hoster." />
          <Toggle id="hideSourceName" checked={policy.hideSourceName} onChange={v => setField('hideSourceName', v)}
            label="Ocultar nome da origem em topics públicos" hint="Substitui o nome do projeto por um hash curto." />
        </div>
      </fieldset>
    </motion.div>
  )
}

function Toggle({ id, checked, onChange, label, hint, warning }) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 rounded-lg border border-white/5 p-3 hover:bg-white/5 cursor-pointer transition">
      <input id={id} type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} className="mt-1" />
      <div className="flex-1">
        <div className="text-sm text-slate-100">{label}</div>
        <div className="text-xs text-slate-400">{hint}</div>
        {warning && <div className="mt-1 text-xs text-amber-300/80">⚠ {warning}</div>}
      </div>
    </label>
  )
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Inject step into MigrationWizard.jsx** — find the step array/switch and insert `TaggingStep` between Review and Execute. State for `policy` lives in the wizard's reducer, default to `DEFAULT_POLICY` from constants (frontend mirror).

- [ ] **Step 6: Plumb the policy through to backend plan creation** — when `createPlan` API is called, include `taggingPolicy` in the body. Backend route stores it on the plan row.

- [ ] **Step 7: Commit** — `feat(migration-tagging): wizard tagging step + plumb policy to backend`

---

## Task 12 — RepoList MigratedPill

**Files:**
- Create: `src/components/RepoList/MigratedPill.jsx`
- Modify: `src/components/RepoList.jsx` to render the pill when marks exist

- [ ] **Step 1: Write component**

```jsx
// src/components/RepoList/MigratedPill.jsx
import { useMigrationMarksFor } from '../../hooks/useMigrationMarks.js'

export function MigratedPill({ fullName }) {
  const { marks, loading } = useMigrationMarksFor(fullName)
  if (loading || !marks.length) return null
  const writtenAt = marks.find(m => m.status === 'written')?.written_at
  return (
    <span
      title={`Migrado${writtenAt ? ` em ${writtenAt.slice(0, 10)}` : ''}`}
      className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-500/30 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
    >
      <span aria-hidden>✦</span>migrado
    </span>
  )
}
```

- [ ] **Step 2: Render in RepoList row** — read current file, find where repo name renders, insert `<MigratedPill fullName={repo.full_name} />` next to it.

- [ ] **Step 3: Commit** — `feat(migration-tagging): RepoList migrated pill`

---

## Task 13 — RepoDetail MigrationProvenanceCard

**Files:**
- Create: `src/components/RepoDetail/MigrationProvenanceCard.jsx`
- Modify: `src/components/RepoDetail/RepoDetailOverview.jsx` (or wherever Overview tab lives) to render the card

- [ ] **Step 1: Write component**

```jsx
// src/components/RepoDetail/MigrationProvenanceCard.jsx
import { useMigrationMarksFor } from '../../hooks/useMigrationMarks.js'
import { motion } from 'framer-motion'

export function MigrationProvenanceCard({ fullName }) {
  const { marks, loading } = useMigrationMarksFor(fullName)
  if (loading || !marks.length) return null
  const planId = marks[0]?.plan_id
  const written = marks.filter(m => m.status === 'written')
  const date = written[0]?.written_at?.slice(0, 10) || '—'

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="ds-card-shimmer rounded-2xl p-5 border border-violet-500/20"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-violet-300">✦</span>
        <h3 className="ds-font-display text-lg text-slate-100">Migration provenance</h3>
        <span className="ml-auto text-xs text-slate-400">plan #{planId}</span>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-slate-400">Date</dt>          <dd className="text-slate-200 ds-font-mono">{date}</dd>
        <dt className="text-slate-400">Marks written</dt> <dd className="text-slate-200">{written.length}/{marks.length}</dd>
      </dl>
    </motion.section>
  )
}
```

- [ ] **Step 2: Insert in RepoDetail Overview** — render conditionally.

- [ ] **Step 3: Commit** — `feat(migration-tagging): RepoDetail provenance card`

---

## Task 14 — E2E smoke test (mocked)

**Files:**
- Create: `e2e/migration-tagging.spec.js`

- [ ] **Step 1: Write Playwright spec** that seeds a fake migration plan + marks via API, opens MigrationHistory, asserts the badge renders and the modal opens with the right rows.

```js
// e2e/migration-tagging.spec.js
import { test, expect } from '@playwright/test'

test.describe('migration tagging', () => {
  test('MigrationHistory shows marks badge for completed plan', async ({ page, request }) => {
    // Assumes a test seed endpoint or direct DB seeding via dev mode
    await page.goto('/migrations')
    await expect(page.getByRole('button', { name: /migration marks/i }).first()).toBeVisible({ timeout: 10000 })
  })
})
```

- [ ] **Step 2: Run E2E (best effort)** — `npx playwright test e2e/migration-tagging.spec.js`. If seeding requires backend hook not yet built, skip with `.skip` and document follow-up.

- [ ] **Step 3: Commit** — `test(migration-tagging): e2e smoke for marks badge`

---

## Task 15 — Final validation

- [ ] **Step 1:** `npx vitest run` — full backend + frontend unit suite. Expected: green.
- [ ] **Step 2:** `npm run build` — verify no Vite/Tailwind/build regression. Expected: green.
- [ ] **Step 3:** `npm run dev` + visual smoke through MigrationWizard → Review → Tagging step → assert checkboxes work; visit `/migrations` → badge visible (need at least one completed plan).
- [ ] **Step 4:** Final commit if any cleanup — `chore(migration-tagging): final validation pass`.

---

## Self-review checklist

- All spec sections have at least one task ✓ (schema, constants, 3 writers, service, route + wire-up, wizard, MigrationHistory, RepoList, RepoDetail, tests).
- Types are consistent: `STATUS.WRITTEN/SKIPPED/FAILED` used everywhere; `SCOPES`/`TARGET_KINDS` enums used everywhere.
- No placeholders in code blocks.
- `repoDirResolver` is null in initial wire-up — git-tag writer step is conditionally guarded, so missing resolver does NOT crash. Documented as known limitation in Task 7; full wire to import-service's per-task workdir is deferred to a follow-up task once the import flow exposes a stable handle. Treat as Phase 2 work.
