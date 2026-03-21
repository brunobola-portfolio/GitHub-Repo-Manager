# Enhanced Migration System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a comprehensive Azure DevOps → GitHub migration platform with repos, work items, wikis, AI orchestration, cascading context menus, and bulletproof reliability.

**Architecture:** Modular decomposition — backend `MigrationEngine` orchestrates plan/task lifecycle with SSE events; frontend `MigrationWizard` decomposes into 9 step components with a shared state machine hook. New services (WorkItemService, WikiService, MigrationPlanner) extend the existing azure-service pattern.

**Tech Stack:** React 19, Vite 7, Tailwind CSS v4, Framer Motion, Express, better-sqlite3, Zod, Vitest, simple-git

**Spec:** `docs/specs/2026-03-21-enhanced-migration-system-design.md`

---

## File Structure

### Backend — New Files

| File | Responsibility |
|------|---------------|
| `server/migration-engine.js` | Plan/task orchestrator, SSE events, retry, cancel, pause, scheduling |
| `server/work-item-service.js` | ADO work items → GitHub Issues (WIQL, mapping, attachments) |
| `server/wiki-service.js` | ADO wiki → GitHub Wiki or docs/ (clone, convert, push) |
| `server/migration-planner.js` | AI analysis via Gemini (risks, suggestions, ordering) |
| `server/lib/credential-encryption.js` | AES-256-GCM encrypt/decrypt for scheduled plan credentials |
| `server/routes/migration.js` | 14 new API endpoints for migration plans |

### Backend — Modified Files

| File | Change |
|------|--------|
| `server/db.js` | Add `migration_plans` + `migration_tasks` tables |
| `server/azure-service.js` | Add `listWikis`, `getWorkItemCounts`, `previewWorkItems`, `fetchWorkItems`, `getWikiCloneUrl` |
| `server/lib/validators.js` | Add `createPlanSchema`, `updatePlanSchema` Zod schemas |
| `server/routes/azure.js` | Add wiki and work-item endpoints |
| `server/index.js` | Mount `migrationRoutes` at `/api`, add shutdown handler |

### Frontend — New Files

| File | Responsibility |
|------|---------------|
| `src/components/MigrationWizard/MigrationWizard.jsx` | Shell: step navigation, modal, animations |
| `src/components/MigrationWizard/steps/SourceStep.jsx` | Azure org/project/PAT input |
| `src/components/MigrationWizard/steps/RepoSelectStep.jsx` | Repo picker with search/filter |
| `src/components/MigrationWizard/steps/RepoConfigStep.jsx` | Target names, visibility, descriptions |
| `src/components/MigrationWizard/steps/WorkItemsStep.jsx` | Work item type selection, label mapping |
| `src/components/MigrationWizard/steps/WikiStep.jsx` | Wiki destination selection |
| `src/components/MigrationWizard/steps/AIReviewStep.jsx` | AI plan review, risks, suggestions |
| `src/components/MigrationWizard/steps/ScheduleStep.jsx` | Schedule/now, dry-run toggle |
| `src/components/MigrationWizard/steps/ProgressStep.jsx` | SSE timeline, cancel/pause |
| `src/components/MigrationWizard/steps/SummaryStep.jsx` | Report, export, links |
| `src/hooks/useMigrationWizard.js` | State machine, validation, API calls |
| `src/hooks/useMigrationPlanner.js` | AI planning interface |
| `src/hooks/useSSE.js` | SSE connection + reconnection hook |
| `src/components/ui/ContextMenu.jsx` | Reusable cascading context menu |
| `src/components/RepoContextMenu.jsx` | Repo-specific menu configuration |
| `src/api/migration.js` | Migration API client wrapper |

### Frontend — Modified Files

| File | Change |
|------|--------|
| `src/contexts/ModalContext.jsx` | Add `'showMigrationWizard'` to `MODAL_NAMES` |
| `src/hooks/useKeyboardShortcuts.js` | Remap `i` from `onImport` to `onMigrate` |
| `src/components/RepoList.jsx` | Replace inline menu with `RepoContextMenu` |
| `src/components/MigrationHistory.jsx` | Fix `data.jobs` → `data.migrations`, add plans view |
| `src/components/TransferModal.jsx` | Add SSE progress, dry-run, AI conflict suggestions |
| `src/components/CreateRepoModal.jsx` | Add real-time name validation |
| `src/components/SettingsModal.jsx` | Add Migration + AI sections |
| `src/config.js` | Add migration API endpoints |
| `src/App.jsx` | Lazy-load MigrationWizard, pass new props |

### Test Files

| File | Coverage |
|------|----------|
| `server/__tests__/migration-engine.test.js` | Plan lifecycle, concurrency, retry, cancel |
| `server/__tests__/work-item-service.test.js` | WIQL queries, mapping, rate limiting |
| `server/__tests__/wiki-service.test.js` | Content conversion rules |
| `server/__tests__/migration-planner.test.js` | AI prompt building, fallback |
| `server/__tests__/credential-encryption.test.js` | Encrypt/decrypt, TTL cleanup |
| `server/__tests__/migration-routes.test.js` | API endpoint validation |
| `tests/hooks/useMigrationWizard.test.jsx` | State machine, step validation |
| `tests/components/ui/ContextMenu.test.jsx` | Submenus, keyboard nav, positioning |
| `tests/components/MigrationWizard/SourceStep.test.jsx` | Form validation, PAT toggle |
| `tests/components/MigrationWizard/ProgressStep.test.jsx` | SSE events, task rendering |

---

## Phase 1: Foundation

### Task 1: Database Schema — migration_plans + migration_tasks

**Files:**
- Modify: `server/db.js`
- Test: `server/__tests__/migration-engine.test.js`

- [ ] **Step 1: Write test for table creation**

```javascript
// server/__tests__/migration-engine.test.js
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

function createTestDb() {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // Copy the table creation SQL from db.js
  return db
}

describe('migration_plans schema', () => {
  let db
  beforeEach(() => { db = createTestDb() })

  it('creates migration_plans table with all columns', () => {
    const info = db.pragma("table_info('migration_plans')")
    const columns = info.map(c => c.name)
    expect(columns).toContain('id')
    expect(columns).toContain('user_id')
    expect(columns).toContain('status')
    expect(columns).toContain('source_type')
    expect(columns).toContain('source_org')
    expect(columns).toContain('source_project')
    expect(columns).toContain('target_org')
    expect(columns).toContain('is_dry_run')
    expect(columns).toContain('scheduled_at')
    expect(columns).toContain('credentials_enc')
    expect(columns).toContain('ai_analysis')
    expect(columns).toContain('summary')
  })

  it('creates migration_tasks table with all columns', () => {
    const info = db.pragma("table_info('migration_tasks')")
    const columns = info.map(c => c.name)
    expect(columns).toContain('id')
    expect(columns).toContain('plan_id')
    expect(columns).toContain('type')
    expect(columns).toContain('execution_order')
    expect(columns).toContain('config')
    expect(columns).toContain('progress_pct')
    expect(columns).toContain('retries')
    expect(columns).toContain('max_retries')
  })

  it('enforces foreign key from tasks to plans', () => {
    expect(() => {
      db.prepare('INSERT INTO migration_tasks (plan_id, type, source_ref) VALUES (999, ?, ?)').run('repo', 'test')
    }).toThrow()
  })

  it('defaults status to draft for plans', () => {
    db.prepare('INSERT INTO migration_plans (user_id, source_org, source_project) VALUES (1, ?, ?)').run('org', 'proj')
    const plan = db.prepare('SELECT status FROM migration_plans WHERE id = 1').get()
    expect(plan.status).toBe('draft')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/migration-engine.test.js`
Expected: FAIL — tables don't exist yet

- [ ] **Step 3: Add tables to server/db.js**

Add inside the existing `db.transaction(...)` block in `server/db.js`, after the last `CREATE TABLE`:

```sql
CREATE TABLE IF NOT EXISTS migration_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft',
  source_type TEXT NOT NULL DEFAULT 'azure',
  source_org TEXT NOT NULL,
  source_project TEXT NOT NULL,
  target_org TEXT,
  is_dry_run INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT,
  credentials_enc TEXT,
  started_at TEXT,
  completed_at TEXT,
  ai_analysis TEXT,
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plan_user ON migration_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_status ON migration_plans(status);
CREATE INDEX IF NOT EXISTS idx_plan_scheduled ON migration_plans(scheduled_at)
  WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS migration_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES migration_plans(id),
  type TEXT NOT NULL,
  execution_order INTEGER NOT NULL DEFAULT 0,
  source_ref TEXT NOT NULL,
  target_ref TEXT,
  config TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  progress_pct INTEGER NOT NULL DEFAULT 0,
  progress_message TEXT,
  error_message TEXT,
  retries INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  started_at TEXT,
  completed_at TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_plan ON migration_tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_task_status ON migration_tasks(status);
```

Also add a shutdown handler in `server/index.js` (there is no existing one for `migration_jobs`, so create it):

```javascript
// In server/index.js, after app.listen():
function gracefulShutdown() {
  db.prepare(`UPDATE migration_plans SET status = 'interrupted', updated_at = datetime('now')
    WHERE status IN ('running', 'paused')`).run()
  db.prepare(`UPDATE migration_jobs SET status = 'interrupted'
    WHERE status IN ('pending', 'running')`).run()
  process.exit(0)
}
process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/migration-engine.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/db.js server/__tests__/migration-engine.test.js
git commit -m "feat(db): add migration_plans and migration_tasks tables"
```

---

### Task 2: Credential Encryption Service

**Files:**
- Create: `server/lib/credential-encryption.js`
- Test: `server/__tests__/credential-encryption.test.js`

- [ ] **Step 1: Write tests**

```javascript
// server/__tests__/credential-encryption.test.js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { encryptCredentials, decryptCredentials, isSchedulingEnabled } from '../lib/credential-encryption.js'

describe('credential-encryption', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-at-least-32-chars-long!!'
  })

  it('encrypts and decrypts credentials roundtrip', () => {
    const creds = { githubToken: 'ghp_abc123', azurePat: 'pat_xyz789' }
    const encrypted = encryptCredentials(creds)
    expect(encrypted).not.toContain('ghp_abc123')
    expect(encrypted).not.toContain('pat_xyz789')
    const decrypted = decryptCredentials(encrypted)
    expect(decrypted).toEqual(creds)
  })

  it('produces different ciphertext each time (random IV)', () => {
    const creds = { githubToken: 'token' }
    const a = encryptCredentials(creds)
    const b = encryptCredentials(creds)
    expect(a).not.toBe(b)
  })

  it('throws on tampered ciphertext', () => {
    const creds = { githubToken: 'token' }
    const encrypted = encryptCredentials(creds)
    const tampered = encrypted.slice(0, -4) + 'XXXX'
    expect(() => decryptCredentials(tampered)).toThrow()
  })

  it('reports scheduling disabled when SESSION_SECRET missing', () => {
    delete process.env.SESSION_SECRET
    expect(isSchedulingEnabled()).toBe(false)
  })

  it('reports scheduling enabled when SESSION_SECRET set', () => {
    expect(isSchedulingEnabled()).toBe(true)
  })
})

// Note: credential TTL cleanup (48h) is tested in migration-engine.test.js
// under the scheduling section (Task 17), verifying that
// credentials_enc is cleared for plans older than 48 hours.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/credential-encryption.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement credential encryption**

```javascript
// server/lib/credential-encryption.js
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const SALT = 'migration-cred-salt'
const ITERATIONS = 100000
const KEY_LENGTH = 32

function deriveKey() {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET not configured')
  return crypto.pbkdf2Sync(secret, SALT, ITERATIONS, KEY_LENGTH, 'sha256')
}

export function encryptCredentials(credentials) {
  const key = deriveKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const plaintext = JSON.stringify(credentials)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decryptCredentials(encoded) {
  const key = deriveKey()
  const buf = Buffer.from(encoded, 'base64')
  const iv = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return JSON.parse(decrypted.toString('utf8'))
}

export function isSchedulingEnabled() {
  return !!process.env.SESSION_SECRET
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/credential-encryption.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/credential-encryption.js server/__tests__/credential-encryption.test.js
git commit -m "feat(security): add AES-256-GCM credential encryption for scheduled migrations"
```

---

### Task 3: Zod Validation Schemas

**Files:**
- Modify: `server/lib/validators.js`
- Test: `server/__tests__/validators-migration.test.js`

- [ ] **Step 1: Write tests for validation schemas**

```javascript
// server/__tests__/validators-migration.test.js
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createPlanSchema } from '../lib/validators.js'

describe('createPlanSchema', () => {
  const validPlan = {
    source: { type: 'azure', org: 'myorg', project: 'myproj' },
    tasks: [{ type: 'repo', sourceRef: 'org/proj/repo', targetRef: 'gh-org/repo', config: {} }]
  }

  it('accepts valid minimal plan', () => {
    const result = createPlanSchema.safeParse(validPlan)
    expect(result.success).toBe(true)
  })

  it('rejects plan without source org', () => {
    const plan = { ...validPlan, source: { type: 'azure', org: '', project: 'p' } }
    expect(createPlanSchema.safeParse(plan).success).toBe(false)
  })

  it('rejects plan with no tasks', () => {
    const plan = { ...validPlan, tasks: [] }
    expect(createPlanSchema.safeParse(plan).success).toBe(false)
  })

  it('rejects plan with >60 tasks', () => {
    const tasks = Array.from({ length: 61 }, (_, i) => ({
      type: 'repo', sourceRef: `ref${i}`, targetRef: `t${i}`
    }))
    const plan = { ...validPlan, tasks }
    expect(createPlanSchema.safeParse(plan).success).toBe(false)
  })

  it('accepts work-items task with valid config', () => {
    const plan = {
      ...validPlan,
      tasks: [{
        type: 'work-items', sourceRef: 'org/proj', targetRef: 'gh/repo',
        config: { types: ['Bug'], includeComments: true }
      }]
    }
    expect(createPlanSchema.safeParse(plan).success).toBe(true)
  })

  it('accepts wiki task with valid config', () => {
    const plan = {
      ...validPlan,
      tasks: [{
        type: 'wiki', sourceRef: 'org/proj/wiki', targetRef: 'gh/repo',
        config: { destination: 'docs' }
      }]
    }
    expect(createPlanSchema.safeParse(plan).success).toBe(true)
  })

  it('rejects wiki task with invalid destination', () => {
    const plan = {
      ...validPlan,
      tasks: [{
        type: 'wiki', sourceRef: 'ref', targetRef: 'ref',
        config: { destination: 'invalid' }
      }]
    }
    expect(createPlanSchema.safeParse(plan).success).toBe(false)
  })

  it('applies defaults for schedule', () => {
    const result = createPlanSchema.parse(validPlan)
    expect(result.schedule.mode).toBe('now')
    expect(result.schedule.isDryRun).toBe(false)
  })

  it('validates rollback policy enum', () => {
    const plan = {
      ...validPlan,
      tasks: [{
        type: 'repo', sourceRef: 'ref', targetRef: 'ref',
        config: { rollbackPolicy: 'invalid' }
      }]
    }
    expect(createPlanSchema.safeParse(plan).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/validators-migration.test.js`
Expected: FAIL — `createPlanSchema` not exported

- [ ] **Step 3: Add schemas to validators.js**

Append to `server/lib/validators.js` (uses existing `z` import at the top):

```javascript
// --- Migration Plan Schemas ---

export const createPlanSchema = z.object({
  source: z.object({
    type: z.literal('azure'),
    org: z.string().min(1).max(100),
    project: z.string().min(1).max(100),
    pat: z.string().min(1).optional()
  }),
  targetOrg: z.string().max(39).optional(),
  tasks: z.array(z.discriminatedUnion('type', [
    z.object({
      type: z.literal('repo'),
      sourceRef: z.string().min(1),
      targetRef: z.string().min(1).max(100),
      config: z.object({
        makePrivate: z.boolean().default(true),
        description: z.string().max(350).default(''),
        rollbackPolicy: z.enum(['delete', 'keep-empty']).default('delete'),
        timeout: z.number().min(60000).max(3600000).default(1800000)
      }).default({})
    }),
    z.object({
      type: z.literal('work-items'),
      sourceRef: z.string().min(1),
      targetRef: z.string().min(1),
      config: z.object({
        types: z.array(z.string()).min(1),
        includeComments: z.boolean().default(true),
        includeAttachments: z.boolean().default(true),
        includeHistory: z.boolean().default(false),
        createProjectBoard: z.boolean().default(false),
        labelMapping: z.record(z.string(), z.string()).default({})
      })
    }),
    z.object({
      type: z.literal('wiki'),
      sourceRef: z.string().min(1),
      targetRef: z.string().min(1),
      config: z.object({
        destination: z.enum(['wiki', 'docs']),
        createPR: z.boolean().default(true),
        branch: z.string().default('docs/wiki-migration')
      })
    })
  ])).min(1).max(60),
  schedule: z.object({
    mode: z.enum(['now', 'scheduled']).default('now'),
    scheduledAt: z.string().datetime().optional(),
    isDryRun: z.boolean().default(false)
  }).default({})
})

export const updatePlanSchema = createPlanSchema.partial()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/validators-migration.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/validators.js server/__tests__/validators-migration.test.js
git commit -m "feat(validation): add Zod schemas for migration plan endpoints"
```

---

### Task 4: MigrationEngine Core — Create, Validate, Get, Delete

**Files:**
- Create: `server/migration-engine.js`
- Test: `server/__tests__/migration-engine.test.js` (extend)

- [ ] **Step 1: Write tests for plan CRUD**

Add to `server/__tests__/migration-engine.test.js`:

```javascript
import { MigrationEngine } from '../migration-engine.js'

describe('MigrationEngine', () => {
  let engine, db

  beforeEach(() => {
    db = createTestDb()
    // Insert a test user
    db.prepare('INSERT INTO users (id, username) VALUES (1, ?)').run('testuser')
    engine = new MigrationEngine(db)
  })

  describe('createPlan', () => {
    it('creates a plan with tasks', () => {
      const planId = engine.createPlan(1, {
        type: 'azure', org: 'myorg', project: 'myproj'
      }, [
        { type: 'repo', sourceRef: 'org/proj/repo1', targetRef: 'gh/repo1', config: {} }
      ])
      expect(planId).toBeGreaterThan(0)
      const plan = engine.getPlanStatus(planId)
      expect(plan.status).toBe('draft')
      expect(plan.tasks).toHaveLength(1)
      expect(plan.tasks[0].type).toBe('repo')
    })
  })

  describe('validatePlan', () => {
    it('returns valid for well-formed plan', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      const result = engine.validatePlan(planId)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('returns errors for plan with no tasks', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' }, []
      )
      const result = engine.validatePlan(planId)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })

  describe('deletePlan', () => {
    it('deletes draft plan and its tasks', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      engine.deletePlan(planId)
      expect(() => engine.getPlanStatus(planId)).toThrow()
    })

    it('refuses to delete running plan', () => {
      const planId = engine.createPlan(1,
        { type: 'azure', org: 'o', project: 'p' },
        [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
      )
      db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('running', planId)
      expect(() => engine.deletePlan(planId)).toThrow()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/migration-engine.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement MigrationEngine CRUD**

Create `server/migration-engine.js` with the `MigrationEngine` class extending `EventEmitter`. Implement `createPlan`, `validatePlan`, `getPlanStatus`, `deletePlan`. Use parameterized queries with the `db` instance passed to constructor.

Key implementation details:
- `createPlan` — wraps in `db.transaction()`, inserts plan then tasks
- `validatePlan` — checks tasks exist, source refs not empty, no duplicate target refs
- `getPlanStatus` — joins `migration_plans` with `migration_tasks`, parses JSON fields
- `deletePlan` — checks status is `draft` or `failed`, deletes tasks then plan in transaction

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/migration-engine.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/migration-engine.js server/__tests__/migration-engine.test.js
git commit -m "feat(engine): add MigrationEngine with plan CRUD operations"
```

---

### Task 5: MigrationEngine — Execute, Cancel, Pause/Resume

**Files:**
- Modify: `server/migration-engine.js`
- Test: `server/__tests__/migration-engine.test.js` (extend)

- [ ] **Step 1: Write tests for execution lifecycle**

```javascript
describe('executePlan', () => {
  it('transitions plan from draft to running', async () => {
    const planId = engine.createPlan(1,
      { type: 'azure', org: 'o', project: 'p' },
      [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
    )
    // Mock the actual task execution
    engine._executeTask = vi.fn().mockResolvedValue({ branches: 5 })
    await engine.executePlan(planId)
    const plan = engine.getPlanStatus(planId)
    expect(plan.status).toBe('completed')
  })

  it('emits task-progress events', async () => {
    const planId = engine.createPlan(1,
      { type: 'azure', org: 'o', project: 'p' },
      [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
    )
    engine._executeTask = vi.fn().mockResolvedValue({})
    const events = []
    engine.on('plan-status', e => events.push(e))
    await engine.executePlan(planId)
    expect(events.some(e => e.status === 'running')).toBe(true)
    expect(events.some(e => e.status === 'completed')).toBe(true)
  })
})

describe('cancelPlan', () => {
  it('sets cancelled flag', () => {
    const planId = engine.createPlan(1,
      { type: 'azure', org: 'o', project: 'p' },
      [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
    )
    db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('running', planId)
    engine.cancelPlan(planId)
    const plan = engine.getPlanStatus(planId)
    expect(plan.status).toBe('cancelled')
  })
})

describe('pausePlan / resumePlan', () => {
  it('pauses a running plan', () => {
    const planId = engine.createPlan(1,
      { type: 'azure', org: 'o', project: 'p' },
      [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
    )
    db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('running', planId)
    engine.pausePlan(planId)
    expect(engine.getPlanStatus(planId).status).toBe('paused')
  })

  it('resumes a paused plan', () => {
    const planId = engine.createPlan(1,
      { type: 'azure', org: 'o', project: 'p' },
      [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
    )
    db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run('paused', planId)
    engine._executeTask = vi.fn().mockResolvedValue({})
    engine.resumePlan(planId)
    expect(engine.getPlanStatus(planId).status).not.toBe('paused')
  })
})
```

- [ ] **Step 2: Run test, verify fails, implement, verify passes**

Implement `executePlan` (processes tasks in `execution_order`, respects concurrency limits, emits events), `cancelPlan`, `pausePlan`, `resumePlan`. Add `_isCancelled(planId)` helper. Add retry logic with exponential backoff. Add DB write throttling (1 write/sec per task using `Date.now()` comparison).

- [ ] **Step 3: Commit**

```bash
git add server/migration-engine.js server/__tests__/migration-engine.test.js
git commit -m "feat(engine): add plan execution, cancel, pause/resume with retry"
```

---

### Task 6: SSE Endpoint + Client Hook

**Files:**
- Create: `src/hooks/useSSE.js`
- Modify: `server/migration-engine.js` (add SSE handler method)
- Will be wired into routes in Task 7

- [ ] **Step 1: Write test for useSSE hook**

```javascript
// tests/hooks/useSSE.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSSE } from '../../src/hooks/useSSE'

// Mock EventSource
class MockEventSource {
  constructor(url) {
    this.url = url; this.listeners = {}
    // Simulate async connection open
    setTimeout(() => { if (this.onopen) this.onopen() }, 0)
  }
  addEventListener(event, fn) { this.listeners[event] = fn }
  removeEventListener() {}
  close() { this.closed = true }
}

describe('useSSE', () => {
  beforeEach(() => { globalThis.EventSource = MockEventSource })
  afterEach(() => { delete globalThis.EventSource })

  it('connects to the SSE URL', () => {
    const { result } = renderHook(() => useSSE('/api/migration/stream/1'))
    expect(result.current.connected).toBe(true)
  })

  it('returns null events initially', () => {
    const { result } = renderHook(() => useSSE(null))
    expect(result.current.events).toEqual([])
    expect(result.current.connected).toBe(false)
  })
})
```

- [ ] **Step 2: Implement useSSE hook**

```javascript
// src/hooks/useSSE.js
import { useState, useEffect, useRef, useCallback } from 'react'

export function useSSE(url) {
  const [events, setEvents] = useState([])
  const [connected, setConnected] = useState(false)
  const [lastPlanState, setLastPlanState] = useState(null)
  const esRef = useRef(null)

  useEffect(() => {
    if (!url) return
    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    const eventTypes = [
      'task-progress', 'task-status', 'task-complete',
      'task-failed', 'plan-status', 'plan-complete',
      'catch-up', 'plan-interrupted'
    ]

    eventTypes.forEach(type => {
      es.addEventListener(type, (e) => {
        const data = JSON.parse(e.data)
        setEvents(prev => [...prev, { type, data, id: e.lastEventId }])
        if (type === 'catch-up') setLastPlanState(data)
      })
    })

    return () => { es.close(); setConnected(false) }
  }, [url])

  const clearEvents = useCallback(() => setEvents([]), [])

  return { events, connected, lastPlanState, clearEvents }
}
```

- [ ] **Step 3: Add SSE handler to MigrationEngine**

Add `handleSSEConnection(planId, res)` method to `MigrationEngine`:
- Sets response headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`)
- On connect: checks plan status — if `interrupted`, emit `plan-interrupted` event immediately
- On connect: if `Last-Event-ID` header present, emit `catch-up` event with full current plan state, then resume normal stream
- Registers event listeners on the engine's `EventEmitter` filtered by `planId`
- Each event includes monotonic `id` field for resumption
- Sends keepalive (`:keepalive\n\n`) every 15s
- Closes when plan reaches terminal state (completed/failed/cancelled)
- Cleans up listeners on response close

- [ ] **Step 4: Run tests, verify passes, commit**

```bash
git add src/hooks/useSSE.js tests/hooks/useSSE.test.jsx server/migration-engine.js
git commit -m "feat(sse): add SSE endpoint handler and useSSE client hook"
```

---

### Task 7: Migration API Routes

**Files:**
- Create: `server/routes/migration.js`
- Modify: `server/index.js` (mount routes)
- Modify: `src/config.js` (add endpoints)
- Create: `src/api/migration.js` (client wrapper)

- [ ] **Step 1: Create route file with all 14 endpoints**

Create `server/routes/migration.js` following the pattern in `server/routes/import.js`:
- Import `express`, `requireAuth` middleware, `MigrationEngine`, validators
- Each route: `router.METHOD(path, requireAuth, async (req, res) => { ... })`
- Use Zod validation with `createPlanSchema.safeParse(req.body)` for POST/PUT
- SSE endpoint: `router.get('/migration/stream/:id', requireAuth, (req, res) => { engine.handleSSEConnection(...) })`
- Error handling with `safeError()` pattern

- [ ] **Step 2: Mount routes in server/index.js**

```javascript
import migrationRoutes from './routes/migration.js'
// Add with other route mounts:
app.use('/api', migrationRoutes)
```

- [ ] **Step 3: Add endpoints to src/config.js**

```javascript
// Add to API_ENDPOINTS:
migrationPlans: `${API_BASE_URL}/api/migration/plans`,
migrationStream: `${API_BASE_URL}/api/migration/stream`,
migrationAnalyze: `${API_BASE_URL}/api/migration/analyze`,
azureWikis: `${API_BASE_URL}/api/azure/wikis`,
azureWorkItemCounts: `${API_BASE_URL}/api/azure/work-items/counts`,
azureWorkItemPreview: `${API_BASE_URL}/api/azure/work-items/preview`,
```

- [ ] **Step 4: Create client API wrapper**

```javascript
// src/api/migration.js
import { API_ENDPOINTS } from '../config'

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || err.message || `HTTP ${res.status}`)
  }
  return res.json()
}

export const migrationApi = {
  createPlan: (data) => fetchJson(API_ENDPOINTS.migrationPlans, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  listPlans: (page = 1) => fetchJson(`${API_ENDPOINTS.migrationPlans}?page=${page}`),
  getPlan: (id) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}`),
  updatePlan: (id, data) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  deletePlan: (id) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}`, { method: 'DELETE' }),
  validatePlan: (id) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}/validate`, { method: 'POST' }),
  executePlan: (id) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}/execute`, { method: 'POST' }),
  cancelPlan: (id) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}/cancel`, { method: 'POST' }),
  pausePlan: (id) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}/pause`, { method: 'POST' }),
  resumePlan: (id) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}/resume`, { method: 'POST' }),
  retryTask: (id, taskId) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}/tasks/${taskId}/retry`, { method: 'POST' }),
  analyze: (data) => fetchJson(API_ENDPOINTS.migrationAnalyze, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  getReport: (id) => fetchJson(`${API_ENDPOINTS.migrationPlans}/${id}/report`),
  streamUrl: (id) => `${API_ENDPOINTS.migrationStream}/${id}`
}
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/migration.js server/index.js src/config.js src/api/migration.js
git commit -m "feat(api): add migration plan API routes and client wrapper"
```

---

### Task 8: ModalContext + Keyboard Shortcut Updates

**Files:**
- Modify: `src/contexts/ModalContext.jsx`
- Modify: `src/hooks/useKeyboardShortcuts.js`

- [ ] **Step 1: Add 'showMigrationWizard' to MODAL_NAMES**

In `src/contexts/ModalContext.jsx`, find the `MODAL_NAMES` array and add `'showMigrationWizard'`.

- [ ] **Step 2: Remap 'i' shortcut**

In `src/hooks/useKeyboardShortcuts.js`, find the `i` key handler that calls `onImport` and change it to call `onMigrate` (which opens the MigrationWizard). Add `onMigrate` to the destructured callbacks parameter.

- [ ] **Step 3: Commit**

```bash
git add src/contexts/ModalContext.jsx src/hooks/useKeyboardShortcuts.js
git commit -m "feat(ui): register MigrationWizard modal and remap 'i' shortcut"
```

---

### Task 9: useMigrationWizard State Machine Hook

**Files:**
- Create: `src/hooks/useMigrationWizard.js`
- Test: `tests/hooks/useMigrationWizard.test.jsx`

- [ ] **Step 1: Write tests for state machine**

```javascript
// tests/hooks/useMigrationWizard.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMigrationWizard } from '../../src/hooks/useMigrationWizard'

describe('useMigrationWizard', () => {
  it('starts at source step', () => {
    const { result } = renderHook(() => useMigrationWizard())
    expect(result.current.currentStep).toBe('source')
  })

  it('does not advance from source without valid org/project', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() => result.current.nextStep())
    expect(result.current.currentStep).toBe('source')
    expect(result.current.error).toBeTruthy()
  })

  it('advances to repoSelect when source is valid', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() => {
      result.current.updateSource({ org: 'myorg', project: 'myproj', pat: 'pat', validated: true })
    })
    act(() => result.current.nextStep())
    expect(result.current.currentStep).toBe('repoSelect')
  })

  it('goes back to previous step', () => {
    const { result } = renderHook(() => useMigrationWizard())
    act(() => {
      result.current.updateSource({ org: 'o', project: 'p', pat: 'p', validated: true })
    })
    act(() => result.current.nextStep())
    act(() => result.current.prevStep())
    expect(result.current.currentStep).toBe('source')
  })

  it('skips workItems and wiki steps when disabled', () => {
    const { result } = renderHook(() => useMigrationWizard())
    // Navigate through to workItems step
    act(() => {
      result.current.updateSource({ org: 'o', project: 'p', pat: 'p', validated: true })
    })
    act(() => result.current.nextStep()) // → repoSelect
    act(() => {
      result.current.setRepos([{ name: 'r', selected: true, targetName: 'r', visibility: 'private' }])
    })
    act(() => result.current.nextStep()) // → repoConfig
    act(() => result.current.nextStep()) // → should skip workItems → skip wiki → aiReview
    expect(result.current.currentStep).toBe('aiReview')
  })

  it('step list includes all 9 steps', () => {
    const { result } = renderHook(() => useMigrationWizard())
    expect(result.current.steps).toEqual([
      'source', 'repoSelect', 'repoConfig', 'workItems', 'wiki',
      'aiReview', 'schedule', 'progress', 'summary'
    ])
  })
})
```

- [ ] **Step 2: Implement the hook**

Create `src/hooks/useMigrationWizard.js` with:
- Full state shape from spec §4.2
- `steps` array, `currentStep`, step navigation (`nextStep`, `prevStep`, `goToStep`)
- Skip logic for disabled workItems/wiki steps
- Per-step validation functions
- State update methods: `updateSource`, `setRepos`, `updateWorkItems`, `updateWiki`, `updateAiPlan`, `updateSchedule`
- `resetWizard` to start over
- Error state management

- [ ] **Step 3: Run tests, verify passes, commit**

```bash
git add src/hooks/useMigrationWizard.js tests/hooks/useMigrationWizard.test.jsx
git commit -m "feat(wizard): add useMigrationWizard state machine hook"
```

---

### Task 10: MigrationWizard Shell + SourceStep

**Files:**
- Create: `src/components/MigrationWizard/MigrationWizard.jsx`
- Create: `src/components/MigrationWizard/steps/SourceStep.jsx`
- Modify: `src/App.jsx` (lazy-load MigrationWizard)

- [ ] **Step 1: Create MigrationWizard shell**

Build the shell component inside `Modal.jsx` (size `xl`):

- Step indicator bar (horizontal dots with labels on desktop; vertical step list on mobile via `md:` breakpoint)
- Back/Next buttons
- Framer Motion `AnimatePresence` for step transitions (slide left/right)
- Renders current step component via switch/map
- Uses `useMigrationWizard` hook
- ARIA: `role="form"`, `aria-label="Migration Wizard"`, `aria-current="step"`

- [ ] **Step 2: Create SourceStep**

Port and simplify from existing `ImportWizard.jsx` step 1:
- Azure org input (text field with validation)
- Project dropdown (fetched after org validates via `POST /api/azure/projects`)
- PAT input with show/hide toggle
- "Use server PAT" toggle (check `GET /api/azure/env-auth`)
- Inline validation icons (green check / red X)
- "Validate" button that calls `POST /api/azure/validate`

- [ ] **Step 3: Write SourceStep test**

```javascript
// tests/components/MigrationWizard/SourceStep.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SourceStep from '../../../src/components/MigrationWizard/steps/SourceStep'

describe('SourceStep', () => {
  it('renders org and project inputs', () => {
    render(<SourceStep source={{ org: '', project: '', pat: '' }} onChange={vi.fn()} />)
    expect(screen.getByLabelText(/organization/i)).toBeInTheDocument()
  })

  it('shows PAT field with toggle visibility', () => {
    render(<SourceStep source={{ org: '', project: '', pat: 'secret' }} onChange={vi.fn()} />)
    const patInput = screen.getByLabelText(/pat/i)
    expect(patInput.type).toBe('password')
  })
})
```

- [ ] **Step 4: Wire into App.jsx**

Add lazy import and render inside modal section:
```jsx
const MigrationWizard = lazy(() => import('./components/MigrationWizard/MigrationWizard'))
// In render, alongside other modals:
{modalStates.showMigrationWizard && (
  <Suspense fallback={null}>
    <MigrationWizard onClose={() => closeModal('showMigrationWizard')} />
  </Suspense>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/MigrationWizard/ src/App.jsx tests/components/MigrationWizard/
git commit -m "feat(wizard): add MigrationWizard shell and SourceStep"
```

---

### Task 11: RepoSelectStep + RepoConfigStep

**Files:**
- Create: `src/components/MigrationWizard/steps/RepoSelectStep.jsx`
- Create: `src/components/MigrationWizard/steps/RepoConfigStep.jsx`

- [ ] **Step 1: Build RepoSelectStep**

- Fetches repos via `POST /api/azure/repos` (existing endpoint)
- Checkbox list with search/filter
- Per-repo: name, size badge, branch count, language, LFS indicator
- "Already migrated" badge (query `migration_tasks` via new endpoint)
- Select All / Deselect All / Invert Selection
- Sort dropdown (name, size, last updated)
- Calls `wizard.setRepos()` on selection change

- [ ] **Step 2: Build RepoConfigStep**

- Editable table: target name, visibility toggle, description input
- Conflict check: debounced 500ms, calls `POST /api/import/check-duplicates`
- Conflict indicator per row (green/yellow/red)
- Inline conflict resolution (Replace/Rename/Skip) using ConflictPanel pattern
- Bulk actions bar: "Make All Private", "Check All Conflicts"
- "✨ AI Suggest" button per row (calls AI endpoint, fills name + description)

- [ ] **Step 3: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoSelectStep.jsx src/components/MigrationWizard/steps/RepoConfigStep.jsx
git commit -m "feat(wizard): add RepoSelectStep and RepoConfigStep"
```

---

## Phase 2: Migration Types

### Task 12: Azure Service Extensions

**Files:**
- Modify: `server/azure-service.js`
- Test: `server/__tests__/azure-service.test.js` (create if needed)

- [ ] **Step 1: Write tests for new azure-service functions**

```javascript
describe('listWikis', () => {
  it('fetches wikis from ADO API v7.1', async () => {
    // Mock fetch to return wiki list
    const wikis = await listWikis('org', 'project', 'pat')
    expect(Array.isArray(wikis)).toBe(true)
  })
})

describe('getWorkItemCounts', () => {
  it('returns counts by type using WIQL', async () => {
    const counts = await getWorkItemCounts('org', 'project', 'pat')
    expect(typeof counts).toBe('object')
  })
})
```

- [ ] **Step 2: Implement 5 new functions**

Add to `server/azure-service.js`:
- `listWikis(org, project, pat)` — `GET /_apis/wiki/wikis?api-version=7.1`
- `getWorkItemCounts(org, project, pat)` — WIQL query grouped by type
- `previewWorkItems(org, project, pat, types)` — WIQL query with `$top=10` per type
- `fetchWorkItems(org, project, pat, ids, expand)` — batch `GET /_apis/wit/workitems?ids=...`
- `getWikiCloneUrl(org, project, pat, wikiId)` — extracts `remoteUrl` from wiki details

Add corresponding routes in `server/routes/azure.js`:
- `POST /api/azure/wikis`
- `POST /api/azure/work-items/counts`
- `POST /api/azure/work-items/preview`

- [ ] **Step 3: Run tests, commit**

```bash
git add server/azure-service.js server/routes/azure.js server/__tests__/azure-service.test.js
git commit -m "feat(azure): add wiki and work item API functions"
```

---

### Task 13: Work Item Service

**Files:**
- Create: `server/work-item-service.js`
- Test: `server/__tests__/work-item-service.test.js`

- [ ] **Step 1: Write tests for work item mapping**

```javascript
describe('WorkItemService', () => {
  describe('buildIssueBody', () => {
    it('converts work item to GitHub issue body with metadata table', () => {
      const body = buildIssueBody({
        id: 1234, title: 'Fix bug', type: 'Bug', state: 'Active',
        description: '<p>HTML description</p>',
        assignedTo: 'jane@co.com', areaPath: 'Proj\\Backend', iteration: 'Sprint 42'
      })
      expect(body).toContain('| **Type** | Bug |')
      expect(body).toContain('| **Original ID** | 1234 |')
      expect(body).toContain('HTML description') // converted to MD
      expect(body).not.toContain('<p>') // HTML stripped
    })
  })

  describe('buildLabels', () => {
    it('creates labels from type, state, priority', () => {
      const labels = buildLabels('Bug', 'Active', 2, { Bug: 'bug' })
      expect(labels).toContain('bug')
      expect(labels).toContain('active')
      expect(labels).toContain('priority:2')
    })
  })

  describe('buildDependencyTree', () => {
    it('orders parents before children', () => {
      const items = [
        { id: 2, relations: [{ type: 'parent', targetId: 1 }] },
        { id: 1, relations: [] }
      ]
      const ordered = buildDependencyTree(items)
      expect(ordered[0].id).toBe(1)
      expect(ordered[1].id).toBe(2)
    })
  })
})
```

- [ ] **Step 2: Implement WorkItemService**

Create `server/work-item-service.js`:
- `migrateWorkItems(config, azureCreds, githubToken, callbacks)` — main entry point
- `queryWorkItems(org, project, pat, types)` — WIQL query
- `fetchWorkItemDetails(org, project, pat, ids)` — batch fetch with 200/request
- `buildDependencyTree(items)` — topological sort by parent/child relations
- `buildIssueBody(item)` — HTML→MD conversion + metadata table
- `buildLabels(type, state, priority, mapping)` — label generation
- `createGitHubIssue(owner, repo, token, issue)` — creates issue via GitHub API
- `downloadAttachment(url, pat)` — downloads with SSRF validation
- Rate limit tracking via `X-RateLimit-Remaining` header
- Progress callback: `callbacks.onProgress(current, total, message)`
- Cancellation check: `callbacks.isCancelled()` called between items

For HTML→MD conversion, use a simple regex-based converter (or consider `turndown` library):
```javascript
function htmlToMarkdown(html) {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<em>(.*?)<\/em>/gi, '*$1*')
    .replace(/<code>(.*?)<\/code>/gi, '`$1`')
    .replace(/<a href="(.*?)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<[^>]+>/g, '')
    .trim()
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git add server/work-item-service.js server/__tests__/work-item-service.test.js
git commit -m "feat(migration): add WorkItemService for ADO work items → GitHub Issues"
```

---

### Task 14: Wiki Service

**Files:**
- Create: `server/wiki-service.js`
- Test: `server/__tests__/wiki-service.test.js`

- [ ] **Step 1: Write tests for content conversion**

```javascript
describe('WikiService', () => {
  describe('convertContent', () => {
    it('converts ADO internal links to GitHub wiki format', () => {
      const result = convertContent('[Link](/Page-Name)', 'wiki')
      expect(result).toBe('[[Page-Name]]')
    })

    it('converts ADO internal links to docs format', () => {
      const result = convertContent('[Link](/Page-Name)', 'docs')
      expect(result).toBe('[Link](Page-Name.md)')
    })

    it('converts attachment paths for docs', () => {
      const result = convertContent('![img](/.attachments/pic.png)', 'docs')
      expect(result).toBe('![img](attachments/pic.png)')
    })

    it('removes [[_TOC_]]', () => {
      const result = convertContent('Before\n[[_TOC_]]\nAfter', 'wiki')
      expect(result).not.toContain('[[_TOC_]]')
    })

    it('converts ::: note to blockquote', () => {
      const result = convertContent('::: note\nImportant info\n:::', 'wiki')
      expect(result).toContain('> **Note:**')
    })

    it('converts ::: mermaid to fenced block', () => {
      const result = convertContent('::: mermaid\ngraph TD\n:::', 'wiki')
      expect(result).toContain('```mermaid')
    })

    it('converts @WorkItem:1234 to absolute link', () => {
      const result = convertContent('See @WorkItem:1234', 'wiki', 'org', 'proj')
      expect(result).toContain('https://dev.azure.com/org/proj/_workitems/edit/1234')
    })

    it('removes @query:GUID with comment', () => {
      const result = convertContent('@query:abc-def-123', 'wiki')
      expect(result).toContain('<!-- ADO query embed removed -->')
    })
  })

  describe('convertOrderFile', () => {
    it('generates _Sidebar.md from .order content', () => {
      const sidebar = convertOrderFile('Page-One\nPage-Two\nSub-Section')
      expect(sidebar).toContain('[[Page-One]]')
      expect(sidebar).toContain('[[Page-Two]]')
    })
  })
})
```

- [ ] **Step 2: Implement WikiService**

Create `server/wiki-service.js`:
- `migrateWiki(config, azureCreds, githubToken, callbacks)` — main entry
- `cloneWikiRepo(cloneUrl, pat, destDir)` — `git clone` the wiki repo
- `convertContent(content, destination, org, project)` — apply all conversion rules from spec §3.5
- `convertOrderFile(orderContent)` — `.order` → `_Sidebar.md`
- `processWikiDirectory(dir, destination, org, project)` — walk files, convert each
- `pushToGitHubWiki(repoFullName, sourceDir, token)` — push to `repo.wiki.git`
- `pushToDocsFolder(repoFullName, sourceDir, token, branch, createPR)` — create branch, commit docs/, optionally create PR

- [ ] **Step 3: Run tests, commit**

```bash
git add server/wiki-service.js server/__tests__/wiki-service.test.js
git commit -m "feat(migration): add WikiService with content conversion"
```

---

### Task 15: WorkItemsStep + WikiStep UI Components

**Files:**
- Create: `src/components/MigrationWizard/steps/WorkItemsStep.jsx`
- Create: `src/components/MigrationWizard/steps/WikiStep.jsx`

- [ ] **Step 1: Build WorkItemsStep**

Per spec §4.3:
- Master toggle for enabling work item migration
- Fetches type counts via `POST /api/azure/work-items/counts` on mount
- Checkbox per type with count badge
- Options toggles (comments, attachments, history)
- Editable label mapping table
- "Create GitHub Project Board" toggle
- Preview summary: "142 items → 142 Issues with 5 labels"
- "✨ Suggest Labels" AI button

- [ ] **Step 2: Build WikiStep**

Per spec §4.3:
- Master toggle for enabling wiki migration
- Fetches wikis via `POST /api/azure/wikis` on mount
- Per wiki: radio group (GitHub Wiki / Docs Folder)
- Conversion preview example
- Large attachment warning
- AI recommendation badge

- [ ] **Step 3: Commit**

```bash
git add src/components/MigrationWizard/steps/WorkItemsStep.jsx src/components/MigrationWizard/steps/WikiStep.jsx
git commit -m "feat(wizard): add WorkItemsStep and WikiStep components"
```

---

### Task 16: Wire Task Execution into Engine

**Files:**
- Modify: `server/migration-engine.js`

- [ ] **Step 1: Implement `_executeTask` dispatch**

The `_executeTask(task, credentials)` method dispatches to the right service based on `task.type`:

```javascript
async _executeTask(task, credentials) {
  const callbacks = {
    onProgress: (pct, msg) => this._updateTaskProgress(task.id, pct, msg),
    isCancelled: () => this._isCancelled(task.plan_id)
  }

  switch (task.type) {
    case 'repo':
      return await importRepository({ /* existing import-service params */ }, callbacks)
    case 'work-items':
      return await migrateWorkItems(JSON.parse(task.config), credentials, callbacks)
    case 'wiki':
      return await migrateWiki(JSON.parse(task.config), credentials, callbacks)
    default:
      throw new Error(`Unknown task type: ${task.type}`)
  }
}
```

- [ ] **Step 2: Add pre-flight validation to `validatePlan`**

Enhance `validatePlan` to run pre-flight checks from spec §5.1:
- Git available check
- GitHub rate limit check
- Repo size warnings
- Name conflict detection

- [ ] **Step 3: Commit**

```bash
git add server/migration-engine.js
git commit -m "feat(engine): wire task execution dispatch and pre-flight validation"
```

---

## Phase 3: Robustness

### Task 17: Scheduling + Credential Persistence

**Files:**
- Modify: `server/migration-engine.js`

- [ ] **Step 1: Add scheduling support**

Implement in `MigrationEngine`:
- `schedulePlan(planId, scheduledAt, credentials)` — encrypts creds, sets `scheduled_at`
- `_startScheduler()` — `setInterval(30000)` checks for due plans
- `_credentialCleanup()` — `setInterval(3600000)` clears `credentials_enc` older than 48h
- `_runCredentialCleanup()` — executes the cleanup query directly (used by interval and tests)
- Called from constructor: `this._startScheduler(); this._credentialCleanup()`

Credential cleanup implementation:

```javascript
_runCredentialCleanup() {
  this.db.prepare(`UPDATE migration_plans SET credentials_enc = NULL
    WHERE credentials_enc IS NOT NULL
    AND created_at < datetime('now', '-48 hours')`).run()
}

_credentialCleanup() {
  setInterval(() => this._runCredentialCleanup(), 3600000)
}
```

Add test for TTL cleanup in `server/__tests__/migration-engine.test.js`:

```javascript
describe('credential cleanup', () => {
  it('clears credentials_enc older than 48 hours', () => {
    const planId = engine.createPlan(1,
      { type: 'azure', org: 'o', project: 'p' },
      [{ type: 'repo', sourceRef: 'r', targetRef: 't', config: {} }]
    )
    // Set credentials and backdate
    db.prepare(`UPDATE migration_plans SET credentials_enc = 'encrypted',
      created_at = datetime('now', '-49 hours') WHERE id = ?`).run(planId)
    // Run cleanup directly
    engine._runCredentialCleanup()
    const plan = db.prepare('SELECT credentials_enc FROM migration_plans WHERE id = ?').get(planId)
    expect(plan.credentials_enc).toBeNull()
  })
})
```

- [ ] **Step 2: Add dry-run mode**

In `executePlan`, check `plan.is_dry_run`. If true:
- Repo tasks: run `git ls-remote` only, check target conflicts, skip clone/push
- Work-items tasks: count query only, skip issue creation
- Wiki tasks: list pages only, skip clone/push
- Generate report as if everything succeeded with estimated metrics

- [ ] **Step 3: Add rollback support**

After task failure, check `config.rollbackPolicy`:
- `'delete'`: delete the GitHub repo created by this task
- `'keep-empty'`: leave it
- For wiki: delete wiki content or branch

- [ ] **Step 4: Commit**

```bash
git add server/migration-engine.js
git commit -m "feat(engine): add scheduling, dry-run mode, and rollback support"
```

---

### Task 18: ProgressStep + SummaryStep

**Files:**
- Create: `src/components/MigrationWizard/steps/ProgressStep.jsx`
- Create: `src/components/MigrationWizard/steps/SummaryStep.jsx`
- Test: `tests/components/MigrationWizard/ProgressStep.test.jsx`

- [ ] **Step 1: Write test for ProgressStep**

```javascript
describe('ProgressStep', () => {
  it('renders task timeline with status badges', () => {
    const tasks = [
      { id: 1, type: 'repo', status: 'completed', progress_pct: 100, source_ref: 'r1', target_ref: 't1' },
      { id: 2, type: 'work-items', status: 'running', progress_pct: 45, source_ref: 'r2', target_ref: 't2' }
    ]
    render(<ProgressStep tasks={tasks} />)
    expect(screen.getByText('t1')).toBeInTheDocument()
    expect(screen.getByText('45%')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Build ProgressStep**

Per spec §4.3:
- Uses `useSSE(migrationApi.streamUrl(planId))` for real-time updates
- Vertical timeline with task rows
- Per task: type icon, source→target, progress bar, status badge, message, duration
- Failed tasks: error + "Retry" button
- Expandable log per task
- Global: Pause/Cancel buttons, overall progress counter
- Auto-scroll to active task

- [ ] **Step 3: Build SummaryStep**

Per spec §4.3:
- Overall score with progress ring
- Per-task results: status, duration, metrics, direct links
- Failed tasks: error + suggested resolution
- Actions: Export Report (JSON download), New Migration, View in History
- Dry-run banner + "Run for Real" button

- [ ] **Step 4: Run tests, commit**

```bash
git add src/components/MigrationWizard/steps/ProgressStep.jsx src/components/MigrationWizard/steps/SummaryStep.jsx tests/components/MigrationWizard/ProgressStep.test.jsx
git commit -m "feat(wizard): add ProgressStep with SSE and SummaryStep with report"
```

---

### Task 19: ScheduleStep + AIReviewStep

**Files:**
- Create: `src/components/MigrationWizard/steps/ScheduleStep.jsx`
- Create: `src/components/MigrationWizard/steps/AIReviewStep.jsx`

- [ ] **Step 1: Build ScheduleStep**

Per spec §4.3:
- Radio: "Execute Now" / "Schedule for Later"
- DateTimePicker (min = now + 5 min)
- Dry-run checkbox
- Summary card (repo count, work items, wiki pages, target org, estimate, mode)
- "Start Migration" / "Schedule Migration" button
- Scheduling notice about credential storage
- Disable scheduling if `isSchedulingEnabled()` returns false

- [ ] **Step 2: Build AIReviewStep**

Per spec §4.3:
- Calls `migrationApi.analyze()` on mount with full wizard state
- Sections: Migration Plan (ordered list), Risks (severity cards), Suggestions (accept/reject per repo), Estimate
- "Re-analyze" button
- "Approve Plan" button (required before Next)
- Without AI: basic validation only (conflicts, size warnings)
- Uses `useMigrationPlanner` hook

- [ ] **Step 3: Commit**

```bash
git add src/components/MigrationWizard/steps/ScheduleStep.jsx src/components/MigrationWizard/steps/AIReviewStep.jsx
git commit -m "feat(wizard): add ScheduleStep and AIReviewStep"
```

---

## Phase 4: AI Integration

### Task 20: Migration Planner Service

**Files:**
- Create: `server/migration-planner.js`
- Test: `server/__tests__/migration-planner.test.js`

- [ ] **Step 1: Write tests**

```javascript
describe('MigrationPlanner', () => {
  describe('buildPrompt', () => {
    it('includes repo metadata in prompt context', () => {
      const prompt = buildPrompt({
        repos: [{ name: 'api', size: 50000, hasSubmodules: true, submoduleRefs: ['core'] }],
        workItems: { counts: { Bug: 10 } },
        wikis: [{ repoName: 'api', pageCount: 5 }],
        target: { org: 'gh-org', existingRepos: [] }
      })
      expect(prompt).toContain('api')
      expect(prompt).toContain('submodule')
      expect(prompt).toContain('Bug')
    })
  })

  describe('fallbackAnalysis', () => {
    it('detects large repos as risks', () => {
      const result = fallbackAnalysis({
        repos: [{ name: 'big', size: 2000000 }],
        target: { existingRepos: [] }
      })
      expect(result.risks.some(r => r.severity === 'high')).toBe(true)
    })

    it('detects name conflicts', () => {
      const result = fallbackAnalysis({
        repos: [{ name: 'existing' }],
        target: { existingRepos: ['existing'] }
      })
      expect(result.risks.some(r => r.title.includes('conflict'))).toBe(true)
    })

    it('estimates duration based on size heuristic', () => {
      const result = fallbackAnalysis({
        repos: [{ name: 'r', size: 100000 }],
        workItems: { counts: { Bug: 50 } },
        wikis: [{ pageCount: 20 }]
      })
      expect(result.estimatedMinutes).toBeGreaterThan(0)
    })
  })
})
```

- [ ] **Step 2: Implement migration-planner.js**

- `analyzeMigration(context)` — if AI configured, call Gemini; else `fallbackAnalysis`
- `buildPrompt(context)` — construct system + user prompt per spec §3.8
- `callGemini(prompt)` — call Gemini API, parse JSON response, validate structure
- `fallbackAnalysis(context)` — programmatic analysis (alphabetical order, size/LFS/conflict detection, duration heuristic)
- Add route `POST /api/migration/analyze` in `server/routes/migration.js`

- [ ] **Step 3: Run tests, commit**

```bash
git add server/migration-planner.js server/__tests__/migration-planner.test.js server/routes/migration.js
git commit -m "feat(ai): add MigrationPlanner service with Gemini and fallback analysis"
```

---

### Task 21: useMigrationPlanner Hook

**Files:**
- Create: `src/hooks/useMigrationPlanner.js`

- [ ] **Step 1: Implement the hook**

```javascript
// src/hooks/useMigrationPlanner.js
import { useState, useCallback } from 'react'
import { migrationApi } from '../api/migration'

export function useMigrationPlanner() {
  const [analyzing, setAnalyzing] = useState(false)
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState(null)

  const analyzeMigration = useCallback(async (context) => {
    setAnalyzing(true)
    setError(null)
    try {
      const result = await migrationApi.analyze(context)
      setPlan(result)
      return result
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setAnalyzing(false)
    }
  }, [])

  const reset = useCallback(() => {
    setPlan(null)
    setError(null)
  }, [])

  return { analyzeMigration, analyzing, plan, error, reset }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useMigrationPlanner.js
git commit -m "feat(ai): add useMigrationPlanner hook"
```

---

## Phase 5: Context Menu

### Task 22: Reusable ContextMenu Component

**Files:**
- Create: `src/components/ui/ContextMenu.jsx`
- Test: `tests/components/ui/ContextMenu.test.jsx`

- [ ] **Step 1: Write tests for context menu**

```javascript
describe('ContextMenu', () => {
  const items = [
    { label: 'Action 1', onClick: vi.fn() },
    { type: 'separator' },
    { label: 'Submenu', children: [
      { label: 'Sub 1', onClick: vi.fn() },
      { label: 'Sub 2', onClick: vi.fn() }
    ]}
  ]

  it('renders menu items', () => {
    render(<ContextMenu items={items} x={100} y={100} onClose={vi.fn()} />)
    expect(screen.getByText('Action 1')).toBeInTheDocument()
    expect(screen.getByText('Submenu')).toBeInTheDocument()
  })

  it('shows submenu on hover', async () => {
    render(<ContextMenu items={items} x={100} y={100} onClose={vi.fn()} />)
    await userEvent.hover(screen.getByText('Submenu'))
    expect(screen.getByText('Sub 1')).toBeInTheDocument()
  })

  it('navigates with arrow keys', async () => {
    render(<ContextMenu items={items} x={100} y={100} onClose={vi.fn()} />)
    await userEvent.keyboard('{ArrowDown}')
    // First actionable item should be focused
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<ContextMenu items={items} x={100} y={100} onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('renders disabled items with tooltip', () => {
    const disabledItems = [
      { label: 'Disabled', disabled: true, tooltip: 'Not available' }
    ]
    render(<ContextMenu items={disabledItems} x={100} y={100} onClose={vi.fn()} />)
    expect(screen.getByText('Disabled')).toHaveClass('opacity-50')
  })
})
```

- [ ] **Step 2: Implement ContextMenu**

Build `src/components/ui/ContextMenu.jsx`:
- Props: `items`, `x`, `y`, `onClose`
- Item shape: `{ label, icon?, onClick?, children?, disabled?, tooltip?, type: 'item'|'separator'|'header' }`
- Viewport clamping (menu + submenus never overflow viewport)
- Submenu positioning: right by default, left if insufficient space
- Keyboard: ↑↓ navigate, → open submenu, ← close submenu, Enter execute, Escape close, Home/End jump to first/last item, type-ahead search (typing characters jumps to matching item)
- Framer Motion: scale + opacity animation
- ARIA: `role="menu"`, `role="menuitem"`, `aria-haspopup` for submenu triggers, `aria-disabled`
- Click outside closes
- Chevron indicator ▸ for items with children

- [ ] **Step 3: Run tests, commit**

```bash
git add src/components/ui/ContextMenu.jsx tests/components/ui/ContextMenu.test.jsx
git commit -m "feat(ui): add reusable ContextMenu component with cascading submenus"
```

---

### Task 23: RepoContextMenu + Integration

**Files:**
- Create: `src/components/RepoContextMenu.jsx`
- Modify: `src/components/RepoList.jsx`

- [ ] **Step 1: Build RepoContextMenu**

Creates the full menu structure from spec §6.2/§6.3:
- Single repo: header with name/badge, GitHub section, Migration submenu, AI submenu, Management submenu, actions, delete
- Batch selection: adapted menu per spec §6.3
- Disabled states per spec §6.4
- Wires to existing actions (openModalWithData, performAction, etc.)
- Wires migration submenu to open MigrationWizard with pre-filled source

- [ ] **Step 2: Replace inline menu in RepoList.jsx**

In `src/components/RepoList.jsx`:
- Remove the `RepoActionsMenu` inline component (~lines 720-808)
- Import `RepoContextMenu`
- Wire `onContextMenu` to open `RepoContextMenu` instead
- Keep the `⋯` button trigger that opens the same menu

- [ ] **Step 3: Add keyboard shortcut**

In `useKeyboardShortcuts.js`, add `Shift+F10` handler that opens context menu on focused repo.

- [ ] **Step 4: Commit**

```bash
git add src/components/RepoContextMenu.jsx src/components/RepoList.jsx src/hooks/useKeyboardShortcuts.js
git commit -m "feat(ui): add cascading RepoContextMenu with submenus, replace inline menu"
```

---

## Phase 6: Dialog Improvements

### Task 24: MigrationHistory Upgrade

**Files:**
- Modify: `src/components/MigrationHistory.jsx`

- [ ] **Step 1: Fix data key mismatch**

Change `data.jobs` to `data.migrations` for the legacy endpoint.

- [ ] **Step 2: Add plans view**

- Fetch plans via `migrationApi.listPlans()`
- Tab toggle: "Plans" | "Legacy Jobs"
- Plan rows: status badge, source info, task count, created date
- Expandable plan detail: show all tasks with status, progress, duration
- Filter by: status, type, date range
- "Re-run" button for failed plans
- "Export Report" button
- Timeline visualization per plan (colored segments for each task)

- [ ] **Step 3: Commit**

```bash
git add src/components/MigrationHistory.jsx
git commit -m "fix(ui): fix MigrationHistory data key and add plans view"
```

---

### Task 25: TransferModal Enhancements

**Files:**
- Modify: `src/components/TransferModal.jsx`

- [ ] **Step 1: Add SSE progress**

Replace the current progress polling with `useSSE` for transfer operations. When transfer starts, backend should emit events via the existing progress pattern.

- [ ] **Step 2: Add dry-run toggle**

Add checkbox "Simulate transfer (dry-run)" before the action button. When checked, call a validate-only endpoint instead of the actual transfer.

- [ ] **Step 3: Add AI conflict suggestion**

When conflicts are detected, show an AI recommendation badge per conflict:
- "AI recommends: Replace (source is 3 months newer)"
- "AI recommends: Skip (repos appear identical)"
- Uses existing `aiApi.getSuggestions()` or new migration planner

- [ ] **Step 4: Debounce conflict check**

Wrap the existing conflict check `useEffect` with a 500ms debounce on `targetOrg` change.

- [ ] **Step 5: Commit**

```bash
git add src/components/TransferModal.jsx
git commit -m "feat(ui): enhance TransferModal with SSE, dry-run, AI suggestions"
```

---

### Task 26: CreateRepoModal + SettingsModal Enhancements

**Files:**
- Modify: `src/components/CreateRepoModal.jsx`
- Modify: `src/components/SettingsModal.jsx`

- [ ] **Step 1: Add real-time name validation to CreateRepoModal**

Add debounced (500ms) check against GitHub API when name changes:
- Green check icon: name available
- Red X icon: name taken
- Spinner: checking
- Uses `POST /api/import/check-duplicates` existing endpoint

- [ ] **Step 2: Add Migration section to SettingsModal**

New tab/section with:
- Default target org selector (dropdown from existing orgs)
- Default visibility toggle (public/private)
- Retry policy: slider for max retries (1-5)
- Timeout sliders: repo (10-60 min), work items (5-30 min), wiki (5-20 min)
- Cleanup policy: temp dir retention selector (1h/24h/7d/manual)

Save to localStorage with key `migration-settings`.

- [ ] **Step 3: Add AI section to SettingsModal**

Enhance existing AI settings:
- Toggle per feature: Suggestions, Risk Analysis, Planning, Security Scan
- Save to localStorage

- [ ] **Step 4: Commit**

```bash
git add src/components/CreateRepoModal.jsx src/components/SettingsModal.jsx
git commit -m "feat(ui): enhance CreateRepoModal name validation and SettingsModal sections"
```

---

## Phase 7: Integration & Polish

### Task 27: End-to-End Wiring

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/MigrationWizard/MigrationWizard.jsx`

- [ ] **Step 1: Wire all wizard steps**

Ensure MigrationWizard renders all 9 steps correctly:
- Source → RepoSelect → RepoConfig → WorkItems → Wiki → AIReview → Schedule → Progress → Summary
- Skip logic for disabled steps
- State persistence through the hook
- Proper props passing to each step

- [ ] **Step 2: Wire App.jsx integration**

- Ensure lazy-loaded MigrationWizard renders correctly
- Wire `onMigrate` callback from keyboard shortcuts
- Ensure modal opens from context menu "Migrate" actions
- Pass required callbacks (refresh repos on completion, etc.)

- [ ] **Step 3: Test full flow manually**

Start dev server, open the app, test:
1. Open MigrationWizard via `i` shortcut
2. Enter Azure org/project/PAT
3. Select repos
4. Configure targets
5. Enable/disable work items and wiki
6. Review AI plan
7. Execute migration
8. Verify SSE progress updates
9. Check summary report

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx src/components/MigrationWizard/
git commit -m "feat(wizard): complete end-to-end MigrationWizard integration"
```

---

### Task 28: E2E Test Skeletons

**Files:**
- Create: `e2e/migration-wizard.spec.js`
- Create: `e2e/context-menu.spec.js`
- Create: `e2e/migration-history.spec.js`

- [ ] **Step 1: Create migration wizard E2E test**

Follow the pattern from existing `e2e/modals.spec.js`:

```javascript
// e2e/migration-wizard.spec.js
import { test, expect } from '@playwright/test'

test.describe('Migration Wizard', () => {
  test('opens via keyboard shortcut i', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('i')
    await expect(page.getByRole('dialog', { name: /migration wizard/i })).toBeVisible()
  })

  test('shows source step as first step', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('i')
    await expect(page.getByLabel(/organization/i)).toBeVisible()
  })
})
```

- [ ] **Step 2: Create context menu E2E test**

```javascript
// e2e/context-menu.spec.js
import { test, expect } from '@playwright/test'

test.describe('Context Menu', () => {
  test('opens on right-click on repo card', async ({ page }) => {
    await page.goto('/')
    const repoCard = page.locator('[data-testid="repo-card"]').first()
    await repoCard.click({ button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible()
  })

  test('shows migration submenu', async ({ page }) => {
    await page.goto('/')
    const repoCard = page.locator('[data-testid="repo-card"]').first()
    await repoCard.click({ button: 'right' })
    await page.getByText(/migration/i).hover()
    await expect(page.getByText(/migrate to github/i)).toBeVisible()
  })
})
```

- [ ] **Step 3: Create migration history E2E test**

```javascript
// e2e/migration-history.spec.js
import { test, expect } from '@playwright/test'

test.describe('Migration History', () => {
  test('displays plans tab', async ({ page }) => {
    await page.goto('/')
    // Open migration history
    await expect(page.getByText(/plans/i)).toBeVisible()
  })
})
```

- [ ] **Step 4: Commit**

```bash
git add e2e/migration-wizard.spec.js e2e/context-menu.spec.js e2e/migration-history.spec.js
git commit -m "test(e2e): add skeleton E2E tests for migration wizard, context menu, history"
```

---

### Task 29: Comprehensive Test Suite

**Files:**
- All test files created in previous tasks

- [ ] **Step 1: Run full backend test suite**

```bash
npx vitest run server/__tests__/ --reporter=verbose
```

Fix any failures.

- [ ] **Step 2: Run full frontend test suite**

```bash
npx vitest run tests/ --reporter=verbose
```

Fix any failures.

- [ ] **Step 3: Run build**

```bash
npx vite build
```

Verify no build errors.

- [ ] **Step 4: Commit any fixes**

Review `git status` first, then stage only the files you changed:

```bash
git add <specific-files-that-were-fixed>
git commit -m "test: fix test suite issues and ensure clean build"
```

---

## Appendix: Key References

| Document | Purpose |
|----------|---------|
| `docs/specs/2026-03-21-enhanced-migration-system-design.md` | Full design spec |
| `server/azure-service.js` | Existing Azure DevOps API patterns |
| `server/import-service.js` | Existing git clone/push patterns + SSRF protection |
| `server/routes/import.js` | Existing route patterns for migration |
| `server/lib/validators.js` | Existing Zod schema patterns |
| `src/components/ImportWizard.jsx` | Existing wizard patterns (deprecated by this plan) |
| `src/components/TransferModal.jsx` | Conflict detection patterns |
| `src/components/ui/Modal.jsx` | Base modal component to use |
| `src/contexts/ModalContext.jsx` | Modal state management |
| `src/hooks/useKeyboardShortcuts.js` | Keyboard shortcut patterns |
