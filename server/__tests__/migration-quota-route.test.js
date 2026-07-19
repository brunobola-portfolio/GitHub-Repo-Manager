// @vitest-environment node
/**
 * Route-level enforcement of the Free-tier "1 full migration / month" meter.
 *
 * migration-quota.test.js covers the pure migrationQuotaDecision(); this suite
 * locks the WIRING in routes/migration.js: that requireMigrationQuota actually
 * (a) returns the canonical 403 MIGRATION_QUOTA_EXCEEDED when the meter denies,
 * (b) lets allowed plans through and charges exactly one monthly unit on a
 * genuine first execute, and (c) never charges Pro / dry-run / already-charged
 * plans. The heavy migration graph (engine, tagging, planner, creds vault) is
 * mocked so the test stays focused on the gate; feature-flags + migration-quota
 * stay REAL so the cap and decision are the production ones.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const h = vi.hoisted(() => ({
  state: {
    tier: 'free',
    currentUsage: 0,
    planForQuota: null, // { is_dry_run, quota_charged } | null  (middleware lookup)
    planFull: null,     // full row | null                       (handler lookup)
    statusChanges: 1,   // rows changed by the draft/paused -> running transition
    chargeChanges: 1,   // rows changed by the quota_charged UPDATE
  },
  getUserTier: vi.fn(),
  getCurrentUsage: vi.fn(),
  incrementUsage: vi.fn(),
  executePlan: vi.fn(),
}))

vi.mock('../middleware/require-tier.js', () => ({ getUserTier: h.getUserTier }))
vi.mock('../lib/usage-meter.js', () => ({
  getCurrentUsage: h.getCurrentUsage,
  incrementUsage: h.incrementUsage,
}))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (_req, _res, next) => next(),
  safeError: (_err, fallback) => fallback,
  // routes/migration.js now imports ./ai/shared.js (for guardedGenerate on
  // POST /analyze), which instantiates requireAI via createRequireAI at
  // module load — the wholesale mock must supply it or importing the router
  // throws before any test in this file runs.
  createRequireAI: () => (_req, _res, next) => next(),
}))
vi.mock('../db.js', () => ({
  default: {
    prepare: (sql) => {
      const s = String(sql)
      if (s.includes('SELECT is_dry_run, quota_charged')) return { get: () => h.state.planForQuota }
      if (s.includes('SELECT * FROM migration_plans')) return { get: () => h.state.planFull }
      if (s.includes('status IN')) return { run: () => ({ changes: h.state.statusChanges }) }
      if (s.includes('quota_charged = 1')) return { run: () => ({ changes: h.state.chargeChanges }) }
      return { get: () => null, all: () => [], run: () => ({ changes: 0 }) }
    },
    transaction: (fn) => (...args) => fn(...args),
  },
}))

// Heavy module-load deps — stubbed so importing the router doesn't pull in the
// real engine / tagging / planner graph. None are exercised by the gate path.
vi.mock('../migration-engine.js', () => ({
  MigrationEngine: class {
    constructor() { this.credentials = { retrieve: () => null, forget: () => {} } }
    on() { return this }
    executePlan(...a) { return h.executePlan(...a) }
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

const FULL_PLAN = { id: 5, user_id: 1, status: 'draft', is_dry_run: 0, source_org: 'contoso', source_project: 'p', azure_host: 'dev.azure.com' }

beforeEach(() => {
  vi.clearAllMocks()
  h.state.tier = 'free'
  h.state.currentUsage = 0
  h.state.planForQuota = { is_dry_run: 0, quota_charged: 0 }
  h.state.planFull = { ...FULL_PLAN }
  h.state.statusChanges = 1
  h.state.chargeChanges = 1
  h.getUserTier.mockImplementation(() => h.state.tier)
  h.getCurrentUsage.mockImplementation(() => h.state.currentUsage)
  h.executePlan.mockResolvedValue(undefined)
})

const execute = (id = 5, body = {}) =>
  request(makeApp()).post(`/api/migration/plans/${id}/execute`).send(body)

describe('requireMigrationQuota — Free-tier "5 full migrations / month" enforcement', () => {
  it('denies a free full plan once the monthly allowance is used (403)', async () => {
    h.state.currentUsage = 5 // cap is 5 for free
    const res = await execute()
    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({
      code: 'MIGRATION_QUOTA_EXCEEDED',
      currentTier: 'free',
      requiredTier: 'pro',
      upgradeUrl: '/pricing',
    })
    expect(h.executePlan).not.toHaveBeenCalled()
    expect(h.incrementUsage).not.toHaveBeenCalled()
  })

  it('allows + charges one unit on a free first full execute', async () => {
    h.state.currentUsage = 0
    const res = await execute()
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true })
    expect(h.executePlan).toHaveBeenCalledTimes(1)
    expect(h.incrementUsage).toHaveBeenCalledTimes(1)
    expect(h.incrementUsage).toHaveBeenCalledWith(1, 'migration_full_executions')
  })

  it('allows Pro full plans without charging, even past the free cap', async () => {
    h.state.tier = 'pro'
    h.state.currentUsage = 99
    const res = await execute()
    expect(res.status).toBe(200)
    expect(h.executePlan).toHaveBeenCalledTimes(1)
    expect(h.incrementUsage).not.toHaveBeenCalled()
  })

  it('allows dry-run plans free + unmetered, even past the cap', async () => {
    h.state.planForQuota = { is_dry_run: 1, quota_charged: 0 }
    h.state.planFull = { ...FULL_PLAN, is_dry_run: 1 }
    h.state.currentUsage = 99
    const res = await execute()
    expect(res.status).toBe(200)
    expect(h.executePlan).toHaveBeenCalledTimes(1)
    expect(h.incrementUsage).not.toHaveBeenCalled()
  })

  it('never re-charges a plan already charged (resume/retry of same plan)', async () => {
    h.state.planForQuota = { is_dry_run: 0, quota_charged: 1 }
    h.state.currentUsage = 1
    const res = await execute()
    expect(res.status).toBe(200)
    expect(h.incrementUsage).not.toHaveBeenCalled()
  })

  it('returns 404 when the plan is missing (scoped to the caller)', async () => {
    h.state.planForQuota = null
    const res = await execute()
    expect(res.status).toBe(404)
    expect(h.executePlan).not.toHaveBeenCalled()
  })

  it('does not charge when the running-transition loses the race (409)', async () => {
    h.state.currentUsage = 0
    h.state.statusChanges = 0 // plan already running / not draft|paused
    const res = await execute()
    expect(res.status).toBe(409)
    expect(h.incrementUsage).not.toHaveBeenCalled()
    expect(h.executePlan).not.toHaveBeenCalled()
  })
})

describe('requireMigrationQuota — same gate guards resume + task retry', () => {
  it('denies resume when the free allowance is exhausted (403)', async () => {
    h.state.currentUsage = 5
    const res = await request(makeApp()).post('/api/migration/plans/5/resume').send({})
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('MIGRATION_QUOTA_EXCEEDED')
  })

  it('denies task retry when the free allowance is exhausted (403)', async () => {
    h.state.currentUsage = 5
    const res = await request(makeApp()).post('/api/migration/plans/5/tasks/9/retry').send({})
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('MIGRATION_QUOTA_EXCEEDED')
  })
})
