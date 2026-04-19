// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// ---------------------------------------------------------------------------
// Mocks — declared before any route imports
// ---------------------------------------------------------------------------

const mockGithubApi = vi.fn()
const mockAiProviderGenerate = vi.fn()
const mockCheckUsageLimit = vi.fn(() => ({ allowed: true, current: 0, limit: 100, remaining: 100 }))
const mockIncrementUsage = vi.fn()
const mockAuditLog = vi.fn()

vi.mock('../lib/github-api.js', () => ({
    githubApi: (...a) => mockGithubApi(...a),
}))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        if (!req.session?.accessToken) return res.status(401).json({ error: 'auth required' })
        next()
    },
    createRequireAI: () => (req, _res, next) => {
        req.aiProvider = { generate: (...a) => mockAiProviderGenerate(...a) }
        next()
    },
    safeError: (_err, fallback) => fallback,
    isValidGitHubFullName: (s) => /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(s || ''),
}))

vi.mock('../lib/validators.js', () => ({
    validate: () => (req, _res, next) => next(),
    aiChatSchema: {},
    aiSuggestSchema: {},
    aiIndexSchema: {},
    aiIssueToPlanSchema: {},
    migrationSizeStrategySchema: {},
    migrationDescriptionSchema: {},
}))

vi.mock('../lib/usage-meter.js', () => ({
    checkUsageLimit: (...a) => mockCheckUsageLimit(...a),
    incrementUsage: (...a) => mockIncrementUsage(...a),
    checkAIFeatureLimit: () => ({ allowed: true }),
    incrementAIUsage: vi.fn(),
    quotaExceededResponse: () => ({ error: 'quota' }),
}))

vi.mock('../lib/audit.js', () => ({
    auditLog: (...a) => mockAuditLog(...a),
}))

vi.mock('../lib/utils.js', () => ({
    safeJsonParse: (v) => {
        try { return JSON.parse(v) } catch { return null }
    },
}))

vi.mock('../ai-service.js', () => ({
    aiService: { model: {} },
    sanitizeForPrompt: (s) => String(s || ''),
}))

vi.mock('../db.js', () => ({ default: { prepare: vi.fn() } }))

const { default: aiRouter } = await import('../routes/ai.js')

function makeApp() {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = { accessToken: 'ghp_test', userId: 42, userLogin: 'alice' }
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        next()
    })
    app.use('/api', aiRouter)
    return app
}

beforeEach(() => {
    mockGithubApi.mockReset()
    mockAiProviderGenerate.mockReset()
    mockCheckUsageLimit.mockReset().mockReturnValue({ allowed: true, current: 0, limit: 100, remaining: 100 })
    mockIncrementUsage.mockReset()
    mockAuditLog.mockReset()
})

describe('POST /api/ai/issue-to-plan', () => {
    it('returns structured plan for a valid issue', async () => {
        mockGithubApi.mockImplementation((path) => {
            if (path.includes('/issues/5/comments')) return Promise.resolve({ data: [] })
            if (path.endsWith('/contents')) return Promise.resolve({ data: [
                { name: 'src', type: 'dir' },
                { name: 'package.json', type: 'file' },
            ] })
            if (path.includes('/issues/5')) return Promise.resolve({
                data: {
                    number: 5,
                    title: 'Support OAuth refresh',
                    body: 'We need refresh token support',
                    labels: [{ name: 'enhancement' }, { name: 'auth' }],
                    html_url: 'https://github.com/acme/app/issues/5',
                    state: 'open',
                    pull_request: null,
                },
            })
            return Promise.resolve({ data: {} })
        })

        mockAiProviderGenerate.mockResolvedValue({
            text: JSON.stringify({
                title: 'Add OAuth refresh token support',
                approach: 'Wire the refresh endpoint into the existing auth middleware.',
                files: [
                    { path: 'src/auth/refresh.js', action: 'create', notes: 'new helper' },
                    { path: 'src/auth/middleware.js', action: 'modify', notes: 'call helper' },
                ],
                tests: 'Unit test happy path + expired token.',
                risks: 'None major.',
                estimatedHours: 6,
            }),
        })

        const app = makeApp()
        const res = await request(app)
            .post('/api/ai/issue-to-plan')
            .send({ repoFullName: 'acme/app', issueNumber: 5 })

        expect(res.status).toBe(200)
        expect(res.body.plan.title).toBe('Add OAuth refresh token support')
        expect(res.body.plan.files).toHaveLength(2)
        expect(res.body.plan.estimatedHours).toBe(6)
        expect(res.body.issue.number).toBe(5)
        expect(mockIncrementUsage).toHaveBeenCalledWith(42, 'ai_queries')
        expect(mockAuditLog).toHaveBeenCalled()
    })

    it('returns 400 when repoFullName is malformed', async () => {
        const app = makeApp()
        const res = await request(app)
            .post('/api/ai/issue-to-plan')
            .send({ repoFullName: '../../etc/passwd', issueNumber: 1 })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('VALIDATION_ERROR')
    })

    it('returns 429 when usage quota is hit', async () => {
        mockCheckUsageLimit.mockReturnValue({ allowed: false, current: 100, limit: 100, remaining: 0 })
        const app = makeApp()
        const res = await request(app)
            .post('/api/ai/issue-to-plan')
            .send({ repoFullName: 'acme/app', issueNumber: 5 })
        expect(res.status).toBe(429)
        expect(res.body.error).toBe('usage_limit_exceeded')
        expect(mockAiProviderGenerate).not.toHaveBeenCalled()
    })

    it('returns 404 when the issue is actually a pull request', async () => {
        mockGithubApi.mockImplementation((path) => {
            if (path.includes('/comments')) return Promise.resolve({ data: [] })
            if (path.endsWith('/contents')) return Promise.resolve({ data: [] })
            return Promise.resolve({
                data: {
                    number: 5, title: 'PR', body: '', labels: [],
                    pull_request: { url: 'https://api.github.com/pulls/5' },
                    state: 'open',
                },
            })
        })
        const app = makeApp()
        const res = await request(app)
            .post('/api/ai/issue-to-plan')
            .send({ repoFullName: 'acme/app', issueNumber: 5 })
        expect(res.status).toBe(404)
        expect(res.body.code).toBe('ISSUE_NOT_FOUND')
    })

    it('returns 404 when GitHub returns 404 for the issue', async () => {
        const notFound = new Error('not found')
        notFound.status = 404
        mockGithubApi.mockRejectedValue(notFound)
        const app = makeApp()
        const res = await request(app)
            .post('/api/ai/issue-to-plan')
            .send({ repoFullName: 'acme/app', issueNumber: 9999 })
        expect(res.status).toBe(404)
        expect(res.body.code).toBe('ISSUE_NOT_FOUND')
    })

    it('returns 502 when AI response is not valid JSON', async () => {
        mockGithubApi.mockImplementation((path) => {
            if (path.includes('/comments')) return Promise.resolve({ data: [] })
            if (path.endsWith('/contents')) return Promise.resolve({ data: [] })
            return Promise.resolve({
                data: {
                    number: 1, title: 'X', body: 'Y', labels: [],
                    state: 'open', pull_request: null,
                },
            })
        })
        mockAiProviderGenerate.mockResolvedValue({ text: 'sorry I cannot help' })

        const app = makeApp()
        const res = await request(app)
            .post('/api/ai/issue-to-plan')
            .send({ repoFullName: 'acme/app', issueNumber: 1 })
        expect(res.status).toBe(502)
        expect(res.body.code).toBe('AI_PARSE_ERROR')
    })

    it('clamps file list to 25 entries and normalises unknown action to "modify"', async () => {
        mockGithubApi.mockImplementation((path) => {
            if (path.includes('/comments')) return Promise.resolve({ data: [] })
            if (path.endsWith('/contents')) return Promise.resolve({ data: [] })
            return Promise.resolve({
                data: {
                    number: 1, title: 'X', body: 'Y', labels: [],
                    state: 'open', pull_request: null,
                },
            })
        })
        const manyFiles = Array.from({ length: 40 }, (_, i) => ({
            path: `src/file${i}.js`,
            action: i % 2 === 0 ? 'modify' : 'bogus-action',
            notes: '',
        }))
        mockAiProviderGenerate.mockResolvedValue({
            text: JSON.stringify({
                title: 't', approach: 'a', files: manyFiles,
                tests: '', risks: '', estimatedHours: 1,
            }),
        })

        const app = makeApp()
        const res = await request(app)
            .post('/api/ai/issue-to-plan')
            .send({ repoFullName: 'acme/app', issueNumber: 1 })
        expect(res.status).toBe(200)
        expect(res.body.plan.files.length).toBe(25)
        // Unknown action should fall back to 'modify'
        const bogus = res.body.plan.files.find(f => f.path === 'src/file1.js')
        expect(bogus.action).toBe('modify')
    })
})
