import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))

const mockFindSimilarById = vi.fn()
vi.mock('../ai-service.js', () => ({
  aiService: {
    findSimilarById: mockFindSimilarById,
    model: {},
    genAI: {}  // truthy so createRequireAI passes
  }
}))

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    if (!req.session?.accessToken) return res.status(401).json({ error: 'Session expired' })
    next()
  },
  createRequireAI: () => (req, res, next) => next(),
  safeError: (err, fallback) => err?.message || fallback
}))

vi.mock('../middleware/require-tier.js', () => ({
  requireTier: () => (req, res, next) => next(),
}))

vi.mock('../lib/usage-meter.js', () => ({
  checkUsageLimit: () => ({ allowed: true, current: 0, limit: 100, remaining: 100 }),
  incrementUsage: vi.fn(),
  checkAIFeatureLimit: () => ({ allowed: true, current: 0, limit: 50, remaining: 50, metric: 'ai_semantic_search' }),
  incrementAIUsage: vi.fn(),
  quotaExceededResponse: (check) => ({ error: 'usage_limit_exceeded', ...check }),
}))

vi.mock('../db.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      get: vi.fn(),
      all: vi.fn(() => [])
    }))
  }
}))

vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn() }))
vi.mock('../lib/utils.js', () => ({ safeJsonParse: vi.fn(v => JSON.parse(v)) }))

describe('GET /api/ai/search?mode=similar-by-id', () => {
  let app
  beforeEach(async () => {
    vi.clearAllMocks()
    app = express()
    app.use((req, _res, next) => {
      req.session = { accessToken: 'tok', user: { id: 1, login: 'alice' }, userId: 1 }
      req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
      next()
    })
    const { default: aiRouter } = await import('../routes/ai.js')
    app.use('/api', aiRouter)
  })

  it('returns similar repos with scores', async () => {
    mockFindSimilarById.mockResolvedValue([
      { repoId: 99, score: 0.91, description: 'Other repo' },
      { repoId: 88, score: 0.77, description: 'Third repo' }
    ])
    const res = await request(app).get('/api/ai/search?mode=similar-by-id&repoId=123')
    expect(res.status).toBe(200)
    expect(res.body.mode).toBe('similar-by-id')
    expect(res.body.similar).toHaveLength(2)
    expect(res.body.similar[0].score).toBe(0.91)
  })

  it('returns 404 when repo is not indexed', async () => {
    mockFindSimilarById.mockResolvedValue(null)
    const res = await request(app).get('/api/ai/search?mode=similar-by-id&repoId=123')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Repository not indexed')
  })

  it('returns 400 when repoId is missing', async () => {
    const res = await request(app).get('/api/ai/search?mode=similar-by-id')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('repoId required')
  })
})
