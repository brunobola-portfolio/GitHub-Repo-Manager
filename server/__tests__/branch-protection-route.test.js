// @vitest-environment node
/*
 * Coverage for the branch-protection GET handler — specifically that a
 * GitHub 403 with "Upgrade to GitHub Pro" message is detected and
 * forwarded to the client as a structured `{ code: 'GITHUB_PRO_REQUIRED' }`
 * payload instead of a generic "Request failed". The client renders an
 * inline upgrade affordance off this code rather than toasting an alarming
 * generic error for what is an expected free-plan limitation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const githubApiMock = vi.fn()

vi.mock('../lib/github-api.js', () => ({
  githubApi: (...args) => githubApiMock(...args),
}))

vi.mock('../middleware/auth.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    requireAuth: (req, res, next) => {
      if (!req.session?.accessToken) return res.status(401).json({ error: 'unauth' })
      next()
    },
  }
})

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))

describe('GET /:owner/:repo/branches/:branch/protection', () => {
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
    const { default: router } = await import('../routes/repos/branches-releases.js')
    app.use(router)
  })

  it('returns the protection payload on success', async () => {
    githubApiMock.mockResolvedValueOnce({ data: { protected: true, required_pull_request_reviews: {} } })
    const res = await request(app).get('/alice/repo/branches/main/protection')
    expect(res.status).toBe(200)
    expect(res.body.protected).toBe(true)
  })

  it('translates 404 to { protected: false } (branch is unprotected)', async () => {
    githubApiMock.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }))
    const res = await request(app).get('/alice/repo/branches/main/protection')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ protected: false })
  })

  it('detects GitHub Pro upgrade requirement and forwards a structured code', async () => {
    githubApiMock.mockRejectedValueOnce(Object.assign(
      new Error('Upgrade to GitHub Pro or make this repository public to enable this feature.'),
      { status: 403 },
    ))
    const res = await request(app).get('/alice/private-repo/branches/main/protection')
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('GITHUB_PRO_REQUIRED')
    // User-facing message is hardcoded — survives prod's safeError sanitisation.
    expect(res.body.error).toMatch(/GitHub Pro/i)
  })

  it('matches the upgrade pattern even with the alternative "make this repository public" wording', async () => {
    githubApiMock.mockRejectedValueOnce(Object.assign(
      new Error('Make this repository public to enable this feature'),
      { status: 403 },
    ))
    const res = await request(app).get('/alice/private-repo/branches/main/protection')
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('GITHUB_PRO_REQUIRED')
  })

  it('does NOT mark generic 403 (e.g. lack of admin perms) as upgrade required', async () => {
    githubApiMock.mockRejectedValueOnce(Object.assign(
      new Error('Resource not accessible by integration'),
      { status: 403 },
    ))
    const res = await request(app).get('/alice/private-repo/branches/main/protection')
    expect(res.status).toBe(403)
    expect(res.body.code).toBeUndefined()
  })

  it('forwards 500-class errors as generic failures (no upgrade code)', async () => {
    githubApiMock.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 502 }))
    const res = await request(app).get('/alice/repo/branches/main/protection')
    expect(res.status).toBe(502)
    expect(res.body.code).toBeUndefined()
  })
})
