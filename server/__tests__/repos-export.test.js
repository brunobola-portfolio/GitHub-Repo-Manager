import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

// Mock the githubApi helper
vi.mock('../lib/github-api.js', () => ({
  githubApi: vi.fn()
}))

// Mock audit log
vi.mock('../lib/audit.js', () => ({
  auditLog: vi.fn().mockResolvedValue(undefined)
}))

import { githubApi } from '../lib/github-api.js'

describe('GET /api/v1/repos/:owner/:repo/export', () => {
  let app
  beforeEach(async () => {
    vi.clearAllMocks()
    app = express()
    // Fake auth middleware
    app.use((req, _res, next) => {
      req.session = { accessToken: 'test-token', user: { login: 'alice' } }
      req.log = { error: vi.fn() }
      next()
    })
    const { default: router } = await import('../routes/v1/repos-export.js')
    app.use('/api/v1', router)
  })

  it('returns an export payload with all expected fields', async () => {
    githubApi.mockImplementation(async (path) => {
      if (path.endsWith('/repos/alice/hello')) return { data: { name: 'hello', default_branch: 'main', stargazers_count: 5 } }
      if (path.endsWith('/topics')) return { data: { names: ['web', 'react'] } }
      if (path.endsWith('/languages')) return { data: { JavaScript: 1000, CSS: 200 } }
      if (path.endsWith('/branches?per_page=100')) return { data: [{ name: 'main' }, { name: 'dev' }] }
      if (path.endsWith('/releases?per_page=30')) return { data: [] }
      return { data: null }
    })

    const res = await request(app).get('/api/v1/repos/alice/hello/export')
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.headers['content-disposition']).toContain('hello-export-')
    const body = JSON.parse(res.text)
    expect(body.schemaVersion).toBe(1)
    expect(body.exportedBy).toBe('alice')
    expect(body.repository.name).toBe('hello')
    expect(body.topics).toEqual(['web', 'react'])
    expect(body.languages).toEqual({ JavaScript: 1000, CSS: 200 })
    expect(body.branches.count).toBe(2)
    expect(body.branches.default).toBe('main')
  })

  it('returns 500 when GitHub API fails', async () => {
    githubApi.mockRejectedValue(Object.assign(new Error('github down'), { status: 502 }))
    const res = await request(app).get('/api/v1/repos/alice/hello/export')
    expect(res.status).toBe(502)
    expect(res.body.error).toContain('github down')
  })
})
