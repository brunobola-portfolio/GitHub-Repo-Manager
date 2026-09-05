// @vitest-environment node
/**
 * Route coverage for GET /api/migration/plans/:id/report?format=md|json — the
 * migration-report artifact (G10). Uses a real in-memory better-sqlite3 db
 * (not a hand-rolled prepare() mock) because the route's ownership check,
 * engine.getPlanStatus() and the marks query all run real SQL against the
 * same tables MigrationHistory reads in production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import Database from 'better-sqlite3'

const h = vi.hoisted(() => ({ db: null }))

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE migration_plans (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, status TEXT NOT NULL,
      source_type TEXT, source_org TEXT, source_project TEXT, azure_host TEXT,
      target_org TEXT, is_dry_run INTEGER DEFAULT 0, started_at TEXT, completed_at TEXT,
      summary TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE migration_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, type TEXT NOT NULL,
      execution_order INTEGER DEFAULT 0, source_ref TEXT, target_ref TEXT, config TEXT,
      status TEXT NOT NULL, progress_pct INTEGER DEFAULT 0, error_message TEXT,
      retries INTEGER DEFAULT 0, started_at TEXT, completed_at TEXT, metadata TEXT
    );
    CREATE TABLE migration_marks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, task_id INTEGER,
      scope TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
      skip_reason TEXT, error_message TEXT, written_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)
  return db
}

vi.mock('../middleware/require-tier.js', () => ({
  getUserTier: () => 'free',
  getTierOrder: () => 0,
}))
vi.mock('../lib/feature-flags.js', () => ({
  getTierOrder: (t) => ({ free: 0, pro: 1, enterprise: 2 }[t] ?? 0),
  getFeatures: () => ({ migrationFullPerMonth: 1 }),
}))
vi.mock('../lib/usage-meter.js', () => ({
  guardedIncrementAIUsage: vi.fn(() => ({ allowed: true })),
  releaseGuardedAIUsage: vi.fn(),
  getCurrentUsage: () => 0,
  incrementUsage: vi.fn(),
  quotaExceededResponse: (c) => ({ error: 'quota', ...c }),
}))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    if (!req.session?.userId) return res.status(401).json({ error: 'unauthenticated' })
    next()
  },
  safeError: (_err, fallback) => fallback,
  createRequireAI: () => (_req, _res, next) => next(),
}))
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))
vi.mock('../lib/pat-resolver.js', () => ({
  resolveAzurePat: () => ({ pat: 'test-pat', source: 'pasted', error: null }),
}))
vi.mock('../lib/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../db.js', () => ({ default: h.db }))
vi.mock('../migration-engine.js', () => ({
  // Faithful-enough re-implementation of getPlanStatus against the real
  // injected db, since the route under test depends on its exact shape
  // (snake_case row + parsed tasks[]).
  MigrationEngine: class {
    constructor(db) { this.db = db; this.credentials = { retrieve: () => null, forget: () => {} } }
    on() { return this }
    getPlanStatus(planId) {
      const plan = this.db.prepare('SELECT * FROM migration_plans WHERE id = ?').get(planId)
      if (!plan) throw new Error(`Plan ${planId} not found`)
      if (plan.summary) { try { plan.summary = JSON.parse(plan.summary) } catch { /* leave raw */ } }
      const tasks = this.db.prepare('SELECT * FROM migration_tasks WHERE plan_id = ? ORDER BY execution_order').all(planId)
      for (const t of tasks) {
        if (t.config) { try { t.config = JSON.parse(t.config) } catch { /* leave raw */ } }
        if (t.metadata) { try { t.metadata = JSON.parse(t.metadata) } catch { /* leave raw */ } }
      }
      return { ...plan, tasks }
    }
  },
}))
vi.mock('../migration-tagging-service.js', () => ({ createMigrationTaggingService: () => ({}) }))
vi.mock('../lib/tagging/github-writer.js', () => ({ createGithubWriter: () => ({}) }))
vi.mock('../lib/tagging/azure-writer.js', () => ({ createAzureWriter: () => ({}) }))
vi.mock('../lib/tagging/git-tag-writer.js', () => ({ createGitTagWriter: () => ({}) }))
vi.mock('../lib/tagging/http-shim.js', () => ({ createHttpShim: () => ({}) }))
vi.mock('../lib/tagging/tagging-workdir-resolver.js', () => ({ createTaggingWorkdirResolver: () => () => null }))
vi.mock('../lib/migration-plan-complete.js', () => ({ handlePlanComplete: () => {} }))
vi.mock('../migration-planner.js', () => ({ analyzeMigration: () => ({}) }))
vi.mock('../lib/azure-credentials-manager.js', () => ({ decryptForUse: () => null }))

// The mocked db.js module resolves `h.db` once, at import time — so the same
// Database instance must live for the whole file; beforeEach clears and
// reseeds its tables rather than swapping in a fresh instance.
h.db = makeDb()

const { default: migrationRouter } = await import('../routes/migration.js')

function makeApp(userId) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.session = userId ? { userId, accessToken: 'ghp_test' } : {}
    req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
    next()
  })
  app.use('/api/migration', migrationRouter)
  return app
}

function seed() {
  const db = h.db
  db.exec('DELETE FROM migration_marks; DELETE FROM migration_tasks; DELETE FROM migration_plans;')
  db.prepare(`INSERT INTO migration_plans
      (id, user_id, status, source_type, source_org, source_project, azure_host, target_org, is_dry_run, started_at, completed_at)
      VALUES (1, 1, 'completed', 'azure', 'contoso', 'Platform', 'dev.azure.com', 'contoso-gh', 0, '2026-08-01T10:00:00Z', '2026-08-01T10:05:00Z')`).run()
  // Another tenant's plan — must be invisible to user 1.
  db.prepare(`INSERT INTO migration_plans
      (id, user_id, status, source_type, source_org, source_project, is_dry_run)
      VALUES (2, 2, 'completed', 'azure', 'other', 'Proj', 0)`).run()

  const insTask = db.prepare(`INSERT INTO migration_tasks
      (plan_id, type, execution_order, source_ref, target_ref, config, status, retries, started_at, completed_at, error_message, metadata)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
  // Succeeded, replaced an existing non-empty target.
  insTask.run(1, 'repo', 0, 'contoso/Platform/repo-a', 'contoso-gh/repo-a',
    JSON.stringify({ onConflict: 'replace' }), 'completed', 0,
    '2026-08-01T10:00:00Z', '2026-08-01T10:02:00Z', null,
    JSON.stringify({ replacedExistingRepo: true, branchCount: 3 }))
  // Succeeded, LFS migrate with a push failure recorded.
  insTask.run(1, 'repo', 1, 'contoso/Platform/repo-b', 'contoso-gh/repo-b',
    JSON.stringify({ sizeStrategy: 'lfs-migrate' }), 'completed', 1,
    '2026-08-01T10:02:00Z', '2026-08-01T10:04:00Z', null,
    JSON.stringify({ lfsPushFailed: true, branchCount: 5 }))
  // Failed task with an auth-shaped error message (exercises the suggestion engine).
  insTask.run(1, 'repo-tfvc', 2, 'contoso/Platform/repo-c', 'contoso-gh/repo-c',
    JSON.stringify({}), 'failed', 0,
    '2026-08-01T10:04:00Z', '2026-08-01T10:05:00Z', 'Authentication failed: 401', null)
  // Skipped task.
  insTask.run(1, 'wiki', 3, 'contoso/Platform/wiki', null,
    JSON.stringify({}), 'skipped', 0, null, null, 'No active wiki found', null)

  db.prepare(`INSERT INTO migration_marks
      (plan_id, task_id, scope, target_kind, target_id, payload, status, written_at)
      VALUES (1, NULL, 'destination', 'github-topic', 'contoso-gh/repo-a', '{}', 'written', '2026-08-01T10:02:30Z')`).run()

  return db
}

beforeEach(() => { seed() })

describe('GET /api/migration/plans/:id/report — JSON (default)', () => {
  it('requires auth', async () => {
    const res = await request(makeApp(null)).get('/api/migration/plans/1/report')
    expect(res.status).toBe(401)
  })

  it('404s for a plan owned by another tenant (no IDOR)', async () => {
    const res = await request(makeApp(1)).get('/api/migration/plans/2/report')
    expect(res.status).toBe(404)
  })

  it('returns the plan, source/target, tasks, conflicts, lfs, marks and errors', async () => {
    const res = await request(makeApp(1)).get('/api/migration/plans/1/report')
    expect(res.status).toBe(200)
    expect(res.body.plan).toMatchObject({
      id: 1, status: 'completed',
      source: { org: 'contoso', project: 'Platform', host: 'dev.azure.com' },
      targetOrg: 'contoso-gh',
      durationSeconds: 300,
    })
    expect(res.body.tasks).toHaveLength(4)
    // Back-compat: SummaryStep.jsx reads task.metadata.* directly.
    expect(res.body.tasks[0].metadata).toEqual({ replacedExistingRepo: true, branchCount: 3 })

    expect(res.body.conflicts).toHaveLength(1)
    expect(res.body.conflicts[0].targetRef).toBe('contoso-gh/repo-a')

    expect(res.body.lfs).toHaveLength(1)
    expect(res.body.lfs[0].targetRef).toBe('contoso-gh/repo-b')

    expect(res.body.skipped).toHaveLength(1)
    expect(res.body.skipped[0].reason).toBe('No active wiki found')

    expect(res.body.marks).toHaveLength(1)
    expect(res.body.marks[0].targetId).toBe('contoso-gh/repo-a')

    expect(res.body.errors).toHaveLength(1)
    expect(res.body.errors[0].error).toMatch(/Authentication failed/)
    expect(res.body.errors[0].suggestion).toMatch(/PAT/)
  })

  it('scopes marks to the requested plan only', async () => {
    // A mark on a plan the user doesn't own must never surface even if a
    // future bug removed the ownership check upstream of the marks query.
    h.db.prepare(`INSERT INTO migration_marks (plan_id, scope, target_kind, target_id, payload, status)
      VALUES (2, 'destination', 'github-topic', 'other/proj', '{}', 'written')`).run()
    const res = await request(makeApp(1)).get('/api/migration/plans/1/report')
    expect(res.body.marks).toHaveLength(1)
  })
})

describe('GET /api/migration/plans/:id/report?format=md', () => {
  it('requires auth', async () => {
    const res = await request(makeApp(null)).get('/api/migration/plans/1/report?format=md')
    expect(res.status).toBe(401)
  })

  it('404s for another tenant\'s plan', async () => {
    const res = await request(makeApp(1)).get('/api/migration/plans/2/report?format=md')
    expect(res.status).toBe(404)
  })

  it('renders a Markdown document with the key sections and downloadable headers', async () => {
    const res = await request(makeApp(1)).get('/api/migration/plans/1/report?format=md')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/markdown/)
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="migration-report-1\.md"/)
    const md = res.text
    expect(md).toMatch(/# Migration Report — Plan #1/)
    expect(md).toMatch(/## What moved/)
    expect(md).toMatch(/## What was skipped, and why/)
    expect(md).toMatch(/## Conflicts and their resolutions/)
    expect(md).toMatch(/## Git LFS/)
    expect(md).toMatch(/## Provenance marks/)
    expect(md).toMatch(/contoso-gh\/repo-a/)
    expect(md).toMatch(/contoso-gh\/repo-b/)
    expect(md).toMatch(/No active wiki found/)
  })

  it('also accepts format=markdown', async () => {
    const res = await request(makeApp(1)).get('/api/migration/plans/1/report?format=markdown')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/markdown/)
  })
})
