// @vitest-environment node
/**
 * Route-level coverage for POST .../replace-retry and .../retry-lfs: they
 * persist a destructive config mutation (onConflict='replace' / LFS
 * sizeStrategy) into migration_tasks.config, THEN kick off engine.retryTask()
 * fire-and-forget. If retryTask rejects before the task ever transitions out
 * of 'failed' (engine.retryTask's own guard clauses all run before that
 * reset — see migration-engine.js), the mutation must be rolled back so a
 * later plain /retry doesn't silently inherit the destructive config for an
 * attempt that never actually started. If the task DID transition (a genuine
 * attempt began and failed later), the config must be left as-is.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const h = vi.hoisted(() => ({
  state: {
    plan: { id: 5, user_id: 1, status: 'failed', is_dry_run: 0, source_org: 'contoso', source_project: 'p', azure_host: 'dev.azure.com' },
    planForQuota: { is_dry_run: 0, quota_charged: 1 }, // already charged so requireMigrationQuota lets it through
    tasks: new Map(), // taskId -> { id, plan_id, status, config, type, target_ref }
  },
  retryTask: vi.fn(),
}))

function seedTask(overrides = {}) {
  const task = {
    id: 9,
    plan_id: 5,
    status: 'failed',
    type: 'repo',
    target_ref: 'org/repo',
    config: JSON.stringify({ makePrivate: true }),
    ...overrides,
  }
  h.state.tasks.set(task.id, task)
  return task
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
  getCurrentUsage: () => 0,
  incrementUsage: vi.fn(),
}))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (_req, _res, next) => next(),
  safeError: (_err, fallback) => fallback,
}))
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))
vi.mock('../lib/pat-resolver.js', () => ({
  resolveAzurePat: () => ({ pat: 'test-pat', source: 'pasted', error: null }),
}))
vi.mock('../lib/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../db.js', () => ({
  default: {
    prepare: (sql) => {
      const s = String(sql)
      if (s.includes('SELECT is_dry_run, quota_charged')) {
        return { get: () => h.state.planForQuota }
      }
      if (s.includes('SELECT * FROM migration_plans')) {
        return { get: () => h.state.plan }
      }
      if (s.includes('SELECT * FROM migration_tasks')) {
        return { get: (taskId, planId) => {
          const t = h.state.tasks.get(taskId)
          return t && t.plan_id === planId ? t : undefined
        } }
      }
      if (s.includes('SELECT status FROM migration_tasks')) {
        return { get: (taskId) => {
          const t = h.state.tasks.get(taskId)
          return t ? { status: t.status } : undefined
        } }
      }
      if (s.includes('UPDATE migration_tasks SET config')) {
        return { run: (config, taskId) => {
          const t = h.state.tasks.get(taskId)
          if (t) t.config = config
          return { changes: t ? 1 : 0 }
        } }
      }
      return { get: () => null, all: () => [], run: () => ({ changes: 0 }) }
    },
    transaction: (fn) => (...args) => fn(...args),
  },
}))

vi.mock('../migration-engine.js', () => ({
  MigrationEngine: class {
    constructor() { this.credentials = { retrieve: () => null, forget: () => {} } }
    on() { return this }
    retryTask(...a) { return h.retryTask(...a) }
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

const { default: migrationRouter } = await import('../routes/migration.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.session = { userId: 1, accessToken: 'ghp_test' }
    req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
    next()
  })
  app.use('/api/migration', migrationRouter)
  return app
}

// Flush the fire-and-forget engine.retryTask(...).catch(...) chain so the
// rollback (or lack thereof) has definitely run before assertions.
async function flushMicrotasks() {
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.tasks = new Map()
  h.retryTask.mockReset()
})

describe('POST .../tasks/:taskId/replace-retry — config rollback on a retry that never started', () => {
  it('rolls back onConflict=replace when retryTask rejects and the task is still "failed"', async () => {
    const task = seedTask({ config: JSON.stringify({ makePrivate: true }) })
    // Simulate engine.retryTask's own guard clauses rejecting BEFORE it ever
    // resets the task out of 'failed' (e.g. the plan's status changed out
    // from under a concurrent request).
    h.retryTask.mockImplementation(async () => {
      throw new Error("Cannot retry tasks for plan with status 'running'")
    })

    const res = await request(makeApp())
      .post('/api/migration/plans/5/tasks/9/replace-retry')
      .send({ pat: 'x' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true })
    // The route wrote the destructive config BEFORE calling retryTask (so
    // retryTask's own DB read sees it) — confirmed by retryTask being called.
    expect(h.retryTask).toHaveBeenCalledTimes(1)

    await flushMicrotasks()

    const persisted = JSON.parse(task.config)
    expect(persisted.onConflict).toBeUndefined()
    expect(persisted.makePrivate).toBe(true)
  })

  it('keeps onConflict=replace when retryTask rejects AFTER the task left "failed" (a genuine attempt ran)', async () => {
    const task = seedTask({ config: JSON.stringify({ makePrivate: true }) })
    h.retryTask.mockImplementation(async () => {
      // Simulate the real engine: task transitions to pending, execution
      // starts, then fails deep inside (e.g. a network error) — the retry
      // genuinely happened with the replace config.
      task.status = 'pending'
      throw new Error('network error during clone')
    })

    const res = await request(makeApp())
      .post('/api/migration/plans/5/tasks/9/replace-retry')
      .send({ pat: 'x' })
    expect(res.status).toBe(200)

    await flushMicrotasks()

    const persisted = JSON.parse(task.config)
    expect(persisted.onConflict).toBe('replace')
  })

  it('leaves onConflict=replace persisted when retryTask succeeds', async () => {
    const task = seedTask({ config: JSON.stringify({ makePrivate: true }) })
    h.retryTask.mockResolvedValue(undefined)

    const res = await request(makeApp())
      .post('/api/migration/plans/5/tasks/9/replace-retry')
      .send({ pat: 'x' })
    expect(res.status).toBe(200)

    await flushMicrotasks()

    const persisted = JSON.parse(task.config)
    expect(persisted.onConflict).toBe('replace')
  })
})

describe('POST .../tasks/:taskId/retry-lfs — config rollback on a retry that never started', () => {
  it('rolls back sizeStrategy=lfs-migrate when retryTask rejects and the task is still "failed"', async () => {
    const task = seedTask({ config: JSON.stringify({ makePrivate: true }) })
    h.retryTask.mockImplementation(async () => {
      throw new Error("Cannot retry tasks for plan with status 'running'")
    })

    const res = await request(makeApp())
      .post('/api/migration/plans/5/tasks/9/retry-lfs')
      .send({ pat: 'x' })
    expect(res.status).toBe(200)

    await flushMicrotasks()

    const persisted = JSON.parse(task.config)
    expect(persisted.sizeStrategy).toBeUndefined()
    expect(persisted.makePrivate).toBe(true)
  })

  it('keeps sizeStrategy=lfs-migrate when the task transitioned out of "failed" before rejecting', async () => {
    const task = seedTask({ config: JSON.stringify({ makePrivate: true }) })
    h.retryTask.mockImplementation(async () => {
      task.status = 'pending'
      throw new Error('lfs push failed')
    })

    const res = await request(makeApp())
      .post('/api/migration/plans/5/tasks/9/retry-lfs')
      .send({ pat: 'x' })
    expect(res.status).toBe(200)

    await flushMicrotasks()

    const persisted = JSON.parse(task.config)
    expect(persisted.sizeStrategy).toBe('lfs-migrate')
  })
})
