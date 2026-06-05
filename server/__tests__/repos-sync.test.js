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
const mockPrepare = vi.fn(() => ({ get: mockDbGet }))
vi.mock('../db.js', () => ({
  default: {
    prepare: (...args) => mockPrepare(...args)
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
      const uid = Number(req.headers['x-test-user'] || 1)
      req.session = { accessToken: 'tok', userId: uid, user: { id: uid, login: 'alice' } }
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

  it('scopes the mirror lookup to the requesting user (user_id in query + bound param)', async () => {
    mockDbGet.mockReturnValue({ source_url: 'https://github.com/other/repo.git' })
    await request(app).post('/api/v1/repos/alice/hello/sync')
    // The query must filter migration_jobs by user_id, not just target_owner/repo.
    const sql = mockPrepare.mock.calls[0][0]
    expect(sql).toMatch(/user_id\s*=\s*\?/i)
    // ...and the requesting user's id must be bound to it.
    expect(mockDbGet).toHaveBeenCalledWith('alice', 'hello', 1)
  })

  it('isolates mirrors by user: owner syncs (200), a different user gets 404', async () => {
    // The DB row belongs to user 1; only a lookup bound with user_id=1 finds it.
    mockDbGet.mockImplementation((_owner, _repo, userId) =>
      userId === 1 ? { source_url: 'https://github.com/other/repo.git' } : undefined)

    // Owner (user 1) — must succeed once the query binds user_id.
    const ownerRes = await request(app)
      .post('/api/v1/repos/alice/hello/sync')
      .set('x-test-user', '1')
    expect(ownerRes.status).toBe(200)

    // Different user (user 2) — must NOT see user 1's mirror.
    const otherRes = await request(app)
      .post('/api/v1/repos/alice/hello/sync')
      .set('x-test-user', '2')
    expect(otherRes.status).toBe(404)
    expect(otherRes.body.error).toMatch(/not a tracked mirror/i)
  })

  // --- Read-only sync preview (Free) ---------------------------------------

  it('GET /sync/preview returns the tracked-mirror manifest, read-only (no clone/push)', async () => {
    const { default: simpleGit } = await import('simple-git')
    mockDbGet.mockReturnValue({
      source_url: 'https://dev.azure.com/org/proj/_git/repo',
      source_name: 'proj/repo',
      target_full_name: 'alice/hello',
      status: 'completed',
      completed_at: '2026-06-01 10:00:00',
      created_at: '2026-05-01 09:00:00',
    })
    const res = await request(app).get('/api/v1/repos/alice/hello/sync/preview')
    expect(res.status).toBe(200)
    expect(res.body.tracked).toBe(true)
    expect(res.body.sourceUrl).toBe('https://dev.azure.com/org/proj/_git/repo')
    expect(res.body.target).toBe('alice/hello')
    expect(res.body.lastSyncedAt).toBe('2026-06-01 10:00:00')
    expect(res.body.applyRequiresPro).toBe(true)
    // Preview must NEVER clone or push — it only reads metadata.
    expect(simpleGit).not.toHaveBeenCalled()
  })

  it('GET /sync/preview filters migration_jobs by user_id and 404s for a different user', async () => {
    mockDbGet.mockImplementation((_owner, _repo, userId) =>
      userId === 1 ? { source_url: 'https://x', target_full_name: 'alice/hello' } : undefined)

    const ownerRes = await request(app).get('/api/v1/repos/alice/hello/sync/preview').set('x-test-user', '1')
    expect(ownerRes.status).toBe(200)
    const sql = mockPrepare.mock.calls.at(-1)[0]
    expect(sql).toMatch(/user_id\s*=\s*\?/i)

    const otherRes = await request(app).get('/api/v1/repos/alice/hello/sync/preview').set('x-test-user', '2')
    expect(otherRes.status).toBe(404)
  })
})
