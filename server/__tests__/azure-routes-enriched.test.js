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

// Stub host validation so these route tests stay deterministic. The real
// resolveHost() -> validateAzureHost() (a) reads the shared azure_host_allowlist
// table — which sibling tests mutate against the same on-disk SQLite file in
// parallel workers, intermittently dropping dev.azure.com off the allowlist —
// and (b) does a live DNS lookup for cloud hosts. Both made the "delegates"
// test flaky (400 instead of 200). Host validation has its own dedicated suite
// (azure-host-validator.test.js); here we only care about route delegation.
vi.mock('../lib/azure-host-validator.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, validateAzureHost: vi.fn(async () => ({ ok: true })) }
})

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
