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
