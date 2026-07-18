// @vitest-environment node
//
// Simple-import parity: cancel + crash recovery for the non-Azure
// "Import Repository" path (migration_jobs table, server/routes/import/url.js).
//
// Covers:
//   1. The in-memory cancellation registry (requestJobCancel/isJobCancelled/
//      clearJobCancel) in isolation.
//   2. recoverInterruptedImportJobs() — the startup sweep that mirrors
//      MigrationEngine.recoverInterruptedPlans() for the task-less
//      migration_jobs shape.
//   3. POST /import/:id/cancel end-to-end against a real in-memory SQLite db,
//      including the full wiring through importRepository's isCancelled
//      callback to the terminal 'cancelled' status write.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import express from 'express'
import request from 'supertest'

// Real in-memory DB stands in for server/db.js, matching the migration_jobs
// schema in server/db.js (see the migration-status-vocabulary test for the
// same pattern).
const mockDb = new Database(':memory:')
mockDb.exec(`
  CREATE TABLE migration_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_name TEXT NOT NULL,
    target_owner TEXT NOT NULL,
    target_repo TEXT NOT NULL,
    target_full_name TEXT,
    status TEXT DEFAULT 'pending',
    progress_pct INTEGER DEFAULT 0,
    progress_message TEXT,
    error_message TEXT,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    metadata TEXT
  )
`)

vi.mock('../db.js', () => ({ default: mockDb }))
vi.mock('../middleware/auth.js', async () => {
  const actual = await vi.importActual('../middleware/auth.js')
  return {
    ...actual,
    requireAuth: (req, _res, next) => {
      req.session = req.session || { userId: 1, accessToken: 'gh-token' }
      next()
    },
  }
})
vi.mock('../lib/url-validator.js', () => ({
  assertSafeExternalUrl: vi.fn(() => true),
  resolveAndValidateHost: vi.fn(async () => true),
  isInternalUrl: vi.fn(() => false),
}))
vi.mock('../lib/github-api.js', () => ({
  githubApi: vi.fn(async () => ({ data: {}, headers: {} })),
}))

const importRepositoryMock = vi.fn()
vi.mock('../import-service.js', () => ({
  importRepository: (...args) => importRepositoryMock(...args),
  validateSourceUrl: vi.fn(async () => ({ valid: true })),
  sanitizeRepoName: vi.fn((n) => n),
  safeUrl: vi.fn((u) => u),
  checkGitInstalled: vi.fn(async () => ({ installed: true })),
}))

// Dynamic imports run after the mocks above are registered (module-body
// execution order), so every module under test sees the mocked db/import-service.
const {
  requestJobCancel,
  isJobCancelled,
  clearJobCancel,
  recoverInterruptedImportJobs,
} = await import('../routes/import/_shared.js')
const { default: urlRouter } = await import('../routes/import/url.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api', urlRouter)
  return app
}

function insertJob(status, overrides = {}) {
  const row = {
    user_id: 1,
    source_type: 'url',
    source_url: 'https://example.com/src.git',
    source_name: 'src',
    target_owner: 'acme',
    target_repo: 'src',
    status,
    ...overrides,
  }
  const { lastInsertRowid } = mockDb.prepare(`
    INSERT INTO migration_jobs (user_id, source_type, source_url, source_name, target_owner, target_repo, status, error_message)
    VALUES (@user_id, @source_type, @source_url, @source_name, @target_owner, @target_repo, @status, @error_message)
  `).run({ error_message: null, ...row })
  return lastInsertRowid
}

beforeEach(() => {
  mockDb.exec('DELETE FROM migration_jobs')
  importRepositoryMock.mockReset()
  // The registry is a module-level Set shared across tests — clear any id
  // that might have leaked from a previous test's cancel request.
  for (let i = 1; i <= 20; i++) clearJobCancel(i)
})

describe('cancellation registry', () => {
  it('starts clear, flips on request, and clears on demand', () => {
    expect(isJobCancelled(42)).toBe(false)
    requestJobCancel(42)
    expect(isJobCancelled(42)).toBe(true)
    clearJobCancel(42)
    expect(isJobCancelled(42)).toBe(false)
  })

  it('tracks multiple ids independently', () => {
    requestJobCancel(1)
    expect(isJobCancelled(1)).toBe(true)
    expect(isJobCancelled(2)).toBe(false)
  })
})

describe('recoverInterruptedImportJobs', () => {
  it('marks running and pending jobs interrupted, stamps completed_at, and preserves an existing error message', () => {
    const runningId = insertJob('running')
    const pendingId = insertJob('pending')
    const completedId = insertJob('completed')
    const failedId = insertJob('failed', { error_message: 'original failure' })

    const summary = recoverInterruptedImportJobs()

    expect(summary).toEqual({ recovered: 2 })

    const running = mockDb.prepare('SELECT status, completed_at, error_message FROM migration_jobs WHERE id = ?').get(runningId)
    expect(running.status).toBe('interrupted')
    expect(running.completed_at).toBeTruthy()
    expect(running.error_message).toBe('Interrupted by a server restart')

    const pending = mockDb.prepare('SELECT status FROM migration_jobs WHERE id = ?').get(pendingId)
    expect(pending.status).toBe('interrupted')

    // Terminal jobs are left untouched.
    expect(mockDb.prepare('SELECT status FROM migration_jobs WHERE id = ?').get(completedId).status).toBe('completed')
    const failed = mockDb.prepare('SELECT status, error_message FROM migration_jobs WHERE id = ?').get(failedId)
    expect(failed.status).toBe('failed')
    expect(failed.error_message).toBe('original failure')
  })

  it('is idempotent — a second call recovers nothing further', () => {
    insertJob('running')
    recoverInterruptedImportJobs()
    const second = recoverInterruptedImportJobs()
    expect(second).toEqual({ recovered: 0 })
  })

  it('is a no-op when there are no orphaned jobs', () => {
    insertJob('completed')
    insertJob('cancelled')
    expect(recoverInterruptedImportJobs()).toEqual({ recovered: 0 })
  })
})

describe('POST /api/import/:id/cancel', () => {
  it('requests cancellation for a running job owned by the caller', async () => {
    const id = insertJob('running')

    const res = await request(makeApp()).post(`/api/import/${id}/cancel`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(isJobCancelled(id)).toBe(true)
  })

  it('accepts cancelling a pending job', async () => {
    const id = insertJob('pending')
    const res = await request(makeApp()).post(`/api/import/${id}/cancel`)
    expect(res.status).toBe(200)
    expect(isJobCancelled(id)).toBe(true)
  })

  it('404s for a job that does not exist', async () => {
    const res = await request(makeApp()).post('/api/import/999999/cancel')
    expect(res.status).toBe(404)
  })

  it('404s for a job owned by a different user (no cross-tenant cancel)', async () => {
    const id = insertJob('running', { user_id: 2 })
    const res = await request(makeApp()).post(`/api/import/${id}/cancel`)
    expect(res.status).toBe(404)
    expect(isJobCancelled(id)).toBe(false)
  })

  it('409s for a job that already reached a terminal status, and does not flag it', async () => {
    const id = insertJob('completed')
    const res = await request(makeApp()).post(`/api/import/${id}/cancel`)
    expect(res.status).toBe(409)
    expect(isJobCancelled(id)).toBe(false)
  })

  it('400s for a non-numeric id', async () => {
    const res = await request(makeApp()).post('/api/import/not-a-number/cancel')
    expect(res.status).toBe(400)
  })
})

describe('cancel wiring end-to-end through POST /api/import/url', () => {
  it('threads isJobCancelled(jobId) into importRepository, and a cancelled result writes the distinct terminal status', async () => {
    let capturedIsCancelled
    let resolveImport
    importRepositoryMock.mockImplementation((params) => {
      capturedIsCancelled = params.isCancelled
      return new Promise((resolve) => { resolveImport = resolve })
    })

    const createRes = await request(makeApp())
      .post('/api/import/url')
      .send({ sourceUrl: 'https://example.com/widget.git', targetName: 'widget' })

    expect(createRes.status).toBe(201)
    const jobId = createRes.body.jobId
    expect(typeof capturedIsCancelled).toBe('function')
    expect(capturedIsCancelled()).toBe(false)

    const cancelRes = await request(makeApp()).post(`/api/import/${jobId}/cancel`)
    expect(cancelRes.status).toBe(200)
    // The exact callback importRepository received now observes the request.
    expect(capturedIsCancelled()).toBe(true)

    // Simulate importRepository honoring the flag and resolving as cancelled.
    resolveImport({ success: false, cancelled: true, error: 'Migration cancelled' })
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    const row = mockDb.prepare('SELECT status, progress_message FROM migration_jobs WHERE id = ?').get(jobId)
    expect(row.status).toBe('cancelled')
    expect(row.progress_message).toBe('Migration cancelled')

    // The registry is cleared once the job settles, whatever the outcome.
    expect(isJobCancelled(jobId)).toBe(false)
  })

  it('does not report a genuinely completed job as cancelled just because a cancel was requested too late', async () => {
    let resolveImport
    importRepositoryMock.mockImplementation(() => new Promise((resolve) => { resolveImport = resolve }))

    const createRes = await request(makeApp())
      .post('/api/import/url')
      .send({ sourceUrl: 'https://example.com/widget2.git', targetName: 'widget2' })
    const jobId = createRes.body.jobId

    // The import finished successfully before honoring any cancel request.
    resolveImport({ success: true, targetFullName: 'acme/widget2', branchCount: 3, hasLFS: false, repoUrl: 'https://github.com/acme/widget2' })
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    const row = mockDb.prepare('SELECT status FROM migration_jobs WHERE id = ?').get(jobId)
    expect(row.status).toBe('completed')
  })
})
