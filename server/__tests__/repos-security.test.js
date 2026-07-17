import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn() }))
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    if (!req.session?.accessToken) return res.status(401).json({ error: 'Session expired' })
    next()
  }
}))
import { githubApi } from '../lib/github-api.js'

describe('GET /api/v1/repos/:owner/:repo/security', () => {
  let app
  beforeEach(async () => {
    vi.clearAllMocks()
    app = express()
    app.use((req, _res, next) => {
      req.session = { accessToken: 'tok', user: { login: 'alice' } }
      req.log = { error: vi.fn() }
      next()
    })
    const { default: router } = await import('../routes/v1/repos-security.js')
    app.use('/api/v1', router)
  })

  it('aggregates alerts from all three sources', async () => {
    githubApi.mockImplementation(async (path) => {
      if (path.includes('/secret-scanning/alerts')) return { data: [{ number: 1, state: 'open' }] }
      if (path.includes('/code-scanning/alerts')) return { data: [{ number: 10, rule: { severity: 'warning' } }] }
      if (path.includes('/dependabot/alerts')) return { data: [{ number: 20, security_advisory: { severity: 'high' } }] }
      return { data: [] }
    })
    const res = await request(app).get('/api/v1/repos/alice/hello/security')
    expect(res.status).toBe(200)
    expect(res.body.secretScanning.available).toBe(true)
    expect(res.body.secretScanning.alerts).toHaveLength(1)
    expect(res.body.summary.total).toBe(3)
  })

  it('marks a source as unavailable on 403', async () => {
    githubApi.mockImplementation(async (path) => {
      if (path.includes('/secret-scanning/alerts')) {
        const err = new Error('Forbidden'); err.status = 403; throw err
      }
      return { data: [] }
    })
    const res = await request(app).get('/api/v1/repos/alice/hello/security')
    expect(res.status).toBe(200)
    expect(res.body.secretScanning.available).toBe(false)
    expect(res.body.secretScanning.reason).toMatch(/token scope/)
  })
})
