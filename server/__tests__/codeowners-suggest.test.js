// @vitest-environment node
/**
 * GET /api/v1/repos/:owner/:repo/codeowners/suggest
 *
 * Locks the behaviour of the new generator endpoint: top-level directory
 * grouping, owner ranking by commit-touch count, min-touches threshold,
 * max-owners cap, and the stable ordering (root last, alphabetical otherwise).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockGithubApi = vi.fn()

vi.mock('../lib/github-api.js', () => ({
    githubApi: (...a) => mockGithubApi(...a),
    statsCache: new Map(),
}))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        if (!req.session?.accessToken) return res.status(401).json({ error: 'auth required' })
        next()
    },
    isValidGitHubUsername: () => true,
    safeError: (_err, fallback) => fallback,
    errorResponse: (res, status, message) => res.status(status).json({ error: message }),
}))
vi.mock('../middleware/require-tier.js', () => ({
    requireTier: () => (_req, _res, next) => next(),
    getUserTier: vi.fn(() => 'pro'),
    attachTier: (_req, _res, next) => next(),
}))
vi.mock('../actions-service.js', () => ({ actionsService: {} }))
vi.mock('../community-health-service.js', () => ({ communityHealthService: {} }))
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))
vi.mock('../middleware/validate-request.js', () => ({
    validateBody: () => (req, _res, next) => { req.validatedBody = req.body; next(); },
    validateQuery: () => (req, _res, next) => { req.validatedQuery = req.query; next(); },
    validateParams: () => (req, _res, next) => { req.validatedParams = req.params; next(); },
}))
vi.mock('../lib/validators.js', () => ({
    validate: () => (_req, _res, next) => next(),
    createRepoSchema: {}, repoUpdateSchema: {}, topicsSchema: {}, forkSchema: {},
    issueCreateSchema: {}, issueUpdateSchema: {}, issueCommentSchema: {},
    prCreateSchema: {}, prUpdateSchema: {}, templateGenerateSchema: {},
    releaseCreateSchema: {}, webhookCreateSchema: {},
    branchCreateSchema: {}, branchProtectionSchema: {},
    collaboratorAddSchema: {}, collaboratorPermissionEnum: {},
    repoLabelCreateSchema: {},
    prMergeSchema: {}, prReviewCommentSchema: {},
    prReviewReplySchema: {}, prReviewSubmitSchema: {},
    contentsCreateUpdateSchema: {}, contentsDeleteSchema: {},
    issueLabelsReplaceSchema: {}, issueAssigneesSchema: {},
    webhookUpdateSchema: {}, workflowDispatchSchema: {},
    communityHealthGenerateSchema: {}, communityHealthCommitFixSchema: {},
    emptyBodySchema: {},
}))
// usage-meter.js (transitively imported via repos/actions-community.js) builds
// a db.transaction() wrapper at module scope — this stub only needs to exist
// so importing the real module doesn't throw.
vi.mock('../db.js', () => ({ default: { prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() })), transaction: (fn) => fn } }))

const { default: reposRouter } = await import('../routes/repos.js')

function makeApp() {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = { accessToken: 'ghp_test', userId: 1, userLogin: 'alice' }
        req.userTier = 'pro'
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
        next()
    })
    app.use('/api/v1/repos', reposRouter)
    return app
}

function commitListing(count) {
    return Array.from({ length: count }, (_, i) => ({ sha: `abc${i}` }))
}

function commitDetail(login, files) {
    return {
        author: { login },
        files: files.map(f => ({ filename: f })),
    }
}

beforeEach(() => {
    mockGithubApi.mockReset()
})

describe('GET /api/v1/repos/:o/:r/codeowners/suggest', () => {
    it('groups authors by top-level directory and ranks by touch count', async () => {
        mockGithubApi.mockImplementation((path) => {
            if (path.includes('/commits?per_page=')) {
                return Promise.resolve({ data: commitListing(4) })
            }
            if (path.endsWith('/abc0')) return Promise.resolve({ data: commitDetail('alice', ['src/a.js']) })
            if (path.endsWith('/abc1')) return Promise.resolve({ data: commitDetail('alice', ['src/b.js', 'src/c.js']) })
            if (path.endsWith('/abc2')) return Promise.resolve({ data: commitDetail('bob',   ['docs/x.md']) })
            if (path.endsWith('/abc3')) return Promise.resolve({ data: commitDetail('bob',   ['docs/y.md']) })
            return Promise.resolve({ data: {} })
        })

        const res = await request(makeApp()).get('/api/v1/repos/o/r/codeowners/suggest?commits=4&minTouches=1')
        expect(res.status).toBe(200)
        expect(res.body.found).toBe(true)
        // docs/ → @bob (2 touches), src/ → @alice (3 touches)
        const srcRule = res.body.rules.find(r => r.pattern === 'src/')
        const docsRule = res.body.rules.find(r => r.pattern === 'docs/')
        expect(srcRule.owners).toEqual(['@alice'])
        expect(docsRule.owners).toEqual(['@bob'])
        expect(res.body.preview).toContain('src/')
        expect(res.body.preview).toContain('@alice')
    })

    it('respects minTouchesPerOwner threshold', async () => {
        mockGithubApi.mockImplementation((path) => {
            if (path.includes('/commits?per_page=')) return Promise.resolve({ data: commitListing(2) })
            if (path.endsWith('/abc0')) return Promise.resolve({ data: commitDetail('alice', ['src/a.js']) })
            if (path.endsWith('/abc1')) return Promise.resolve({ data: commitDetail('bob',   ['src/b.js']) })
            return Promise.resolve({ data: {} })
        })

        // With minTouches=2 the single-commit authors should all get filtered out.
        const res = await request(makeApp()).get('/api/v1/repos/o/r/codeowners/suggest?commits=2&minTouches=2')
        expect(res.status).toBe(200)
        expect(res.body.found).toBe(false)
        expect(res.body.rules).toEqual([])
    })

    it('caps owners per pattern at maxOwners', async () => {
        mockGithubApi.mockImplementation((path) => {
            if (path.includes('/commits?per_page=')) return Promise.resolve({ data: commitListing(6) })
            // 6 distinct authors, all touching src/
            const owners = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank']
            const match = path.match(/\/abc(\d+)$/)
            if (match) {
                return Promise.resolve({ data: commitDetail(owners[Number(match[1])], ['src/x.js']) })
            }
            return Promise.resolve({ data: {} })
        })

        const res = await request(makeApp()).get('/api/v1/repos/o/r/codeowners/suggest?commits=6&minTouches=1&maxOwners=2')
        expect(res.status).toBe(200)
        const srcRule = res.body.rules.find(r => r.pattern === 'src/')
        expect(srcRule.owners).toHaveLength(2)
    })

    it('skips GitHub web-flow commits (merges) and non-login authors', async () => {
        mockGithubApi.mockImplementation((path) => {
            if (path.includes('/commits?per_page=')) return Promise.resolve({ data: commitListing(3) })
            if (path.endsWith('/abc0')) return Promise.resolve({ data: commitDetail('web-flow', ['src/a.js']) })
            if (path.endsWith('/abc1')) return Promise.resolve({ data: { files: [{ filename: 'src/b.js' }] } }) // no author
            if (path.endsWith('/abc2')) return Promise.resolve({ data: commitDetail('alice', ['src/c.js']) })
            return Promise.resolve({ data: {} })
        })

        const res = await request(makeApp()).get('/api/v1/repos/o/r/codeowners/suggest?commits=3&minTouches=1')
        expect(res.status).toBe(200)
        const srcRule = res.body.rules.find(r => r.pattern === 'src/')
        expect(srcRule.owners).toEqual(['@alice'])
    })

    it('handles root-level files under pattern "/"', async () => {
        mockGithubApi.mockImplementation((path) => {
            if (path.includes('/commits?per_page=')) return Promise.resolve({ data: commitListing(2) })
            if (path.endsWith('/abc0')) return Promise.resolve({ data: commitDetail('alice', ['README.md']) })
            if (path.endsWith('/abc1')) return Promise.resolve({ data: commitDetail('alice', ['package.json']) })
            return Promise.resolve({ data: {} })
        })

        const res = await request(makeApp()).get('/api/v1/repos/o/r/codeowners/suggest?commits=2&minTouches=1')
        expect(res.status).toBe(200)
        const rootRule = res.body.rules.find(r => r.pattern === '/')
        expect(rootRule.owners).toEqual(['@alice'])
    })

    it('returns found=false with empty rules when repo has no commits', async () => {
        mockGithubApi.mockImplementation((path) => {
            if (path.includes('/commits?per_page=')) return Promise.resolve({ data: [] })
            return Promise.resolve({ data: {} })
        })
        const res = await request(makeApp()).get('/api/v1/repos/o/r/codeowners/suggest')
        expect(res.status).toBe(200)
        expect(res.body.found).toBe(false)
        expect(res.body.rules).toEqual([])
        expect(res.body.analyzedCommits).toBe(0)
    })

    it('requires auth', async () => {
        const bareApp = express()
        bareApp.use(express.json())
        bareApp.use((req, _res, next) => { req.session = {}; req.log = { error: vi.fn() }; next() })
        bareApp.use('/api/v1/repos', reposRouter)
        const res = await request(bareApp).get('/api/v1/repos/o/r/codeowners/suggest')
        expect(res.status).toBe(401)
    })
})
