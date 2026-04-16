import express from 'express'
import request from 'supertest'
import { describe, it, expect, vi } from 'vitest'
import azureRoutes from '../routes/azure.js'
import * as azureService from '../azure-service.js'

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (_req, _res, next) => next(),
  safeError: (e, msg) => msg,
  errorResponse: (res, code, msg) => res.status(code).json({ error: msg }),
  isValidGitHubUsername: () => true,
}))

describe('activity route', () => {
  it('returns 400 when repos missing', async () => {
    const app = express()
    app.use(express.json())
    app.use('/api', azureRoutes)
    const res = await request(app).post('/api/azure/repos/activity').send({ org: 'o', project: 'p' })
    expect(res.status).toBe(400)
  })

  it('delegates to azure-service and returns results', async () => {
    vi.spyOn(azureService, 'listRepoActivity').mockResolvedValue({ r1: { lastCommitDate: '2026-01-01T00:00:00Z' } })
    vi.spyOn(azureService, 'resolvePat').mockReturnValue('PAT')
    const app = express()
    app.use(express.json())
    app.use('/api', azureRoutes)
    const res = await request(app).post('/api/azure/repos/activity').send({
      org: 'o', project: 'p', repos: [{ id: 'r1', defaultBranch: 'refs/heads/main' }],
    })
    expect(res.status).toBe(200)
    expect(res.body.activity.r1.lastCommitDate).toBe('2026-01-01T00:00:00Z')
  })
})
