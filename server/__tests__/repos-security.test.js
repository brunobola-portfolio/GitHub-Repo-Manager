import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn() }))
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))

const mockCheckCommunityFiles = vi.fn(async () => ({ 'SECURITY.md': { exists: false, size: 0 } }))
vi.mock('../community-health-service.js', () => ({
  communityHealthService: { checkCommunityFiles: (...a) => mockCheckCommunityFiles(...a) },
}))

const mockGenerate = vi.fn()
vi.mock('../ai-service.js', () => ({
  aiService: { model: {}, genAI: { getGenerativeModel: () => ({}) } },
  sanitizeForPrompt: (s, max = 5000) => (typeof s === 'string' ? s.slice(0, max) : ''),
}))

vi.mock('../middleware/auth.js', async () => {
  const actual = await vi.importActual('../middleware/auth.js')
  return {
    ...actual,
    requireAuth: (req, res, next) => {
      if (!req.session?.accessToken) return res.status(401).json({ error: 'Session expired' })
      next()
    },
    createRequireAI: () => (req, res, next) => {
      req.aiProvider = { modelId: 'gemini-test', generate: (...args) => mockGenerate(...args) }
      next()
    },
  }
})

const checkAIFeatureLimit = vi.fn(() => ({ allowed: true, current: 0, limit: 75, remaining: 75, metric: 'ai_security_posture' }))
const incrementAIUsage = vi.fn()
vi.mock('../lib/usage-meter.js', () => ({
  checkAIFeatureLimit: (...a) => checkAIFeatureLimit(...a),
  incrementAIUsage: (...a) => incrementAIUsage(...a),
  quotaExceededResponse: (check) => ({ error: 'usage_limit_exceeded', code: 'QUOTA_EXCEEDED', limit: check.limit, current: check.current }),
}))

const checkAISpendCap = vi.fn(() => ({ allowed: true, capCents: 0, spentCents: 0 }))
const recordAISpend = vi.fn()
vi.mock('../lib/ai-spend-cap.js', () => ({
  checkAISpendCap: (...a) => checkAISpendCap(...a),
  recordAISpend: (...a) => recordAISpend(...a),
}))

import { githubApi } from '../lib/github-api.js'
import { clearSecurityPostureSummaryCache } from '../lib/security-posture-summary.js'

async function buildApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.session = { accessToken: 'tok', userId: 1, user: { login: 'alice' } }
    req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
    next()
  })
  const { default: router } = await import('../routes/v1/repos-security.js')
  app.use('/api/v1', router)
  return app
}

describe('GET /api/v1/repos/:owner/:repo/security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckCommunityFiles.mockResolvedValue({ 'SECURITY.md': { exists: false, size: 0 } })
  })

  it('aggregates alerts from all three sources', async () => {
    githubApi.mockImplementation(async (path) => {
      if (path.includes('/secret-scanning/alerts')) return { data: [{ number: 1, state: 'open' }] }
      if (path.includes('/code-scanning/alerts')) return { data: [{ number: 10, rule: { severity: 'warning' } }] }
      if (path.includes('/dependabot/alerts')) return { data: [{ number: 20, security_advisory: { severity: 'high' } }] }
      return { data: [] }
    })
    const res = await request(await buildApp()).get('/api/v1/repos/alice/hello/security')
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
    const res = await request(await buildApp()).get('/api/v1/repos/alice/hello/security')
    expect(res.status).toBe(200)
    expect(res.body.secretScanning.available).toBe(false)
    expect(res.body.secretScanning.reason).toMatch(/token scope/)
  })

  it('returns 10 deterministic checks + a score alongside the existing alert sources', async () => {
    githubApi.mockImplementation(async (path) => {
      if (path === '/repos/alice/hello') {
        return { data: { default_branch: 'main', private: false, owner: { login: 'alice', type: 'User' } } }
      }
      if (path.includes('/branches/main/protection')) {
        return {
          data: {
            protected: true,
            required_pull_request_reviews: { required_approving_review_count: 1 },
            allow_force_pushes: { enabled: false },
            allow_deletions: { enabled: false },
          },
        }
      }
      if (path.includes('/actions/permissions/workflow')) return { data: { default_workflow_permissions: 'read' } }
      return { data: [] }
    })
    const res = await request(await buildApp()).get('/api/v1/repos/alice/hello/security')
    expect(res.status).toBe(200)
    expect(res.body.checks).toHaveLength(10)
    expect(res.body.score.total).toBe(10)
    const byId = (id) => res.body.checks.find((c) => c.id === id)
    expect(byId('branch_protection_review').status).toBe('pass')
    // No security_and_analysis on the repo payload above -> admin-gated checks unknown.
    expect(byId('secret_scanning').status).toBe('unknown')
    // Personal account (owner.type === 'User') -> not applicable.
    expect(byId('org_two_factor').status).toBe('not_applicable')
    // Workflow permissions read -> pass.
    expect(byId('workflow_permissions').status).toBe('pass')
  })

  it('degrades branch protection to unknown (not fail) on a 403, never misinforming a non-admin', async () => {
    githubApi.mockImplementation(async (path) => {
      if (path === '/repos/alice/hello') return { data: { default_branch: 'main', private: false, owner: { login: 'alice', type: 'User' } } }
      if (path.includes('/branches/main/protection')) {
        const err = new Error('Forbidden'); err.status = 403; throw err
      }
      return { data: [] }
    })
    const res = await request(await buildApp()).get('/api/v1/repos/alice/hello/security')
    const byId = (id) => res.body.checks.find((c) => c.id === id)
    expect(byId('branch_protection_review').status).toBe('unknown')
    expect(byId('branch_protection_force_push').status).toBe('unknown')
  })

  it('renders check 3 (alerts_clear) as unknown, not pass, when the token cannot see any alert source', async () => {
    githubApi.mockImplementation(async (path) => {
      if (path.includes('/secret-scanning/alerts') || path.includes('/code-scanning/alerts') || path.includes('/dependabot/alerts')) {
        const err = new Error('Forbidden'); err.status = 403; throw err
      }
      if (path === '/repos/alice/hello') {
        return { data: { default_branch: 'main', private: false, owner: { login: 'alice', type: 'User' } } }
      }
      return { data: [] }
    })
    const res = await request(await buildApp()).get('/api/v1/repos/alice/hello/security')
    expect(res.status).toBe(200)
    expect(res.body.summary.available).toBe(false)
    const byId = (id) => res.body.checks.find((c) => c.id === id)
    expect(byId('alerts_clear').status).toBe('unknown')
  })

  it('renders check 3 (alerts_clear) as pass when at least one alert source is reachable and clean', async () => {
    githubApi.mockImplementation(async (path) => {
      if (path.includes('/secret-scanning/alerts')) {
        const err = new Error('Forbidden'); err.status = 403; throw err
      }
      return { data: [] }
    })
    const res = await request(await buildApp()).get('/api/v1/repos/alice/hello/security')
    expect(res.body.summary.available).toBe(true)
    const byId = (id) => res.body.checks.find((c) => c.id === id)
    expect(byId('alerts_clear').status).toBe('pass')
  })

  it('renders SECURITY.md presence from the community-health service (not refetched independently)', async () => {
    mockCheckCommunityFiles.mockResolvedValue({ 'SECURITY.md': { exists: true, size: 120 } })
    githubApi.mockImplementation(async () => ({ data: [] }))
    const res = await request(await buildApp()).get('/api/v1/repos/alice/hello/security')
    const byId = (id) => res.body.checks.find((c) => c.id === id)
    expect(byId('security_md').status).toBe('pass')
    expect(mockCheckCommunityFiles).toHaveBeenCalledWith('alice', 'hello', 'tok')
  })
})

describe('POST /api/v1/repos/:owner/:repo/security/summary', () => {
  const validBody = {
    repo: { full_name: 'alice/hello', private: false },
    checks: [
      { id: 'branch_protection_review', label: 'Default branch requires PR review before merge', status: 'fail', severity: 'critical' },
      { id: 'security_md', label: 'SECURITY.md present', status: 'pass' },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    clearSecurityPostureSummaryCache()
    checkAIFeatureLimit.mockImplementation(() => ({ allowed: true, current: 0, limit: 75, remaining: 75, metric: 'ai_security_posture' }))
    checkAISpendCap.mockImplementation(() => ({ allowed: true, capCents: 0, spentCents: 0 }))
  })

  it('returns a shaped AI summary on first call and meters ai_security_posture', async () => {
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        summary: 'One critical check is failing.',
        topActions: [{ title: 'Enable branch protection', why: 'Blocks unreviewed merges', severity: 'critical' }],
      }),
    })
    const res = await request(await buildApp())
      .post('/api/v1/repos/alice/hello/security/summary')
      .send(validBody)
    expect(res.status).toBe(200)
    expect(res.body.cached).toBe(false)
    expect(res.body.topActions).toHaveLength(1)
    expect(incrementAIUsage).toHaveBeenCalledWith(1, 'ai_security_posture')
  })

  it('serves the cached summary on a second identical call without re-billing', async () => {
    mockGenerate.mockResolvedValue({ text: JSON.stringify({ summary: 's', topActions: [] }) })
    const app = await buildApp()
    await request(app).post('/api/v1/repos/alice/hello/security/summary').send(validBody)
    const r2 = await request(app).post('/api/v1/repos/alice/hello/security/summary').send(validBody)
    expect(r2.body.cached).toBe(true)
    expect(mockGenerate).toHaveBeenCalledTimes(1)
    expect(incrementAIUsage).toHaveBeenCalledTimes(1)
  })

  it('returns 429 when over the securityPostureAIPerMonth quota', async () => {
    checkAIFeatureLimit.mockImplementation(() => ({ allowed: false, current: 75, limit: 75, remaining: 0, metric: 'ai_security_posture' }))
    const res = await request(await buildApp())
      .post('/api/v1/repos/alice/hello/security/summary')
      .send(validBody)
    expect(res.status).toBe(429)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('routes through guardedGenerate: 429 AI_SPEND_CAP_REACHED when over the monthly spend cap', async () => {
    checkAISpendCap.mockImplementation(() => ({ allowed: false, capCents: 500, spentCents: 500 }))
    const res = await request(await buildApp())
      .post('/api/v1/repos/alice/hello/security/summary')
      .send(validBody)
    expect(res.status).toBe(429)
    expect(res.body.code).toBe('AI_SPEND_CAP_REACHED')
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('rejects a check id outside the known 10-check whitelist with 400', async () => {
    const res = await request(await buildApp())
      .post('/api/v1/repos/alice/hello/security/summary')
      .send({ repo: { full_name: 'alice/hello' }, checks: [{ id: 'not_a_real_check', label: 'x', status: 'fail' }] })
    expect(res.status).toBe(400)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('strips unknown fields from each check (e.g. raw alert bodies) before they reach the prompt', async () => {
    mockGenerate.mockResolvedValue({ text: JSON.stringify({ summary: 's', topActions: [] }) })
    await request(await buildApp())
      .post('/api/v1/repos/alice/hello/security/summary')
      .send({
        repo: { full_name: 'alice/hello' },
        checks: [{ id: 'security_md', label: 'x', status: 'fail', rawAlertBody: 'ghp_SHOULD_NOT_LEAK' }],
      })
    const promptArg = mockGenerate.mock.calls[0][0].prompt
    expect(promptArg).not.toContain('ghp_SHOULD_NOT_LEAK')
  })

  it('degrades gracefully to a handled AI error when the provider fails', async () => {
    mockGenerate.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))
    const res = await request(await buildApp())
      .post('/api/v1/repos/alice/hello/security/summary')
      .send(validBody)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.body.error).toBeTruthy()
  })
})
