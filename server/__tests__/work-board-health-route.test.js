// @vitest-environment node
/**
 * G9 — GET /api/v1/work-board/health route: ranks tracked repos by their
 * last known community-health score, reports failing checks + week-over-week
 * delta, and runs a bounded number of live on-demand checks per request for
 * repos with no/stale snapshot. Mirrors work-board-routes.test.js's mocking
 * style (real db.js, mocked collaborators) so it doesn't duplicate that
 * file's whole mock surface for unrelated routes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockGetTrackedRepos = vi.fn(() => ({ items: [], total: 0, countsBySignal: {} }))
const mockGithubApi = vi.fn(async () => ({ data: { id: 42 } }))
const mockAnalyzeRepository = vi.fn(async () => ({
    metrics: { healthScore: 88 },
    recommendations: [{ priority: 'high', action: 'Add SECURITY.md' }],
}))
const mockCacheResults = vi.fn()
const mockGetLatestSnapshot = vi.fn(() => null)
const mockIsSnapshotFresh = vi.fn(() => false)
const mockGetWeekOverWeekDelta = vi.fn(() => null)
const mockCaptureHealthSnapshot = vi.fn()
const mockFailingChecksFromRecommendations = vi.fn((recs) => (recs || []).filter(r => r.priority === 'high').map(r => r.action))

vi.mock('../lib/work-board-tracking.js', async (importOriginal) => ({
    ...(await importOriginal()),
    getTrackedRepos: (...a) => mockGetTrackedRepos(...a),
    getScopedRepoIds: () => [],
}))
vi.mock('../lib/github-api.js', () => ({ githubApi: (...a) => mockGithubApi(...a) }))
vi.mock('../community-health-service.js', () => ({
    communityHealthService: {
        analyzeRepository: (...a) => mockAnalyzeRepository(...a),
        cacheResults: (...a) => mockCacheResults(...a),
    },
}))
vi.mock('../lib/work-board-health.js', () => ({
    getLatestSnapshot: (...a) => mockGetLatestSnapshot(...a),
    isSnapshotFresh: (...a) => mockIsSnapshotFresh(...a),
    getWeekOverWeekDelta: (...a) => mockGetWeekOverWeekDelta(...a),
    captureHealthSnapshot: (...a) => mockCaptureHealthSnapshot(...a),
    failingChecksFromRecommendations: (...a) => mockFailingChecksFromRecommendations(...a),
}))
vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        if (!req.session?.accessToken) return res.status(401).json({ error: 'Session expired. Please login again.' })
        next()
    },
    errorResponse: (res, status, message) => res.status(status).json({ error: message }),
    safeError: (_err, fallback) => fallback,
}))
vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { default: workBoardRouter } = await import('../routes/work-board.js')

function makeApp({ userId = 1, accessToken = 'ghp_mock' } = {}) {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = accessToken ? { userId, accessToken } : {}
        next()
    })
    app.use('/api/v1/work-board', workBoardRouter)
    return app
}

beforeEach(() => {
    vi.clearAllMocks()
    mockGetTrackedRepos.mockReturnValue({ items: [], total: 0, countsBySignal: {} })
    mockGithubApi.mockResolvedValue({ data: { id: 42 } })
    mockAnalyzeRepository.mockResolvedValue({
        metrics: { healthScore: 88 },
        recommendations: [{ priority: 'high', action: 'Add SECURITY.md' }],
    })
    mockGetLatestSnapshot.mockReturnValue(null)
    mockIsSnapshotFresh.mockReturnValue(false)
    mockGetWeekOverWeekDelta.mockReturnValue(null)
    mockFailingChecksFromRecommendations.mockImplementation((recs) => (recs || []).filter(r => r.priority === 'high').map(r => r.action))
})

describe('GET /api/v1/work-board/health', () => {
    it('requires auth', async () => {
        const res = await request(makeApp({ accessToken: null })).get('/api/v1/work-board/health')
        expect(res.status).toBe(401)
    })

    it('returns an empty list when nothing is tracked (no live checks attempted)', async () => {
        const res = await request(makeApp()).get('/api/v1/work-board/health')
        expect(res.status).toBe(200)
        expect(res.body.data.repos).toEqual([])
        expect(mockGithubApi).not.toHaveBeenCalled()
    })

    it('runs an on-demand check for a tracked repo with no snapshot and captures the result', async () => {
        mockGetTrackedRepos.mockReturnValue({ items: [{ repo_full_name: 'acme/backend' }], total: 1, countsBySignal: {} })
        mockGetLatestSnapshot
            .mockReturnValueOnce(null) // before the live check
            .mockReturnValueOnce({ score: 88, failing_checks: '["Add SECURITY.md"]', captured_at: '2026-09-05T00:00:00Z' }) // after

        const res = await request(makeApp()).get('/api/v1/work-board/health')
        expect(res.status).toBe(200)
        expect(mockAnalyzeRepository).toHaveBeenCalledWith('acme', 'backend', 'ghp_mock')
        expect(mockCacheResults).toHaveBeenCalledWith(42, { healthScore: 88 }, expect.any(Array), 1)
        expect(mockCaptureHealthSnapshot).toHaveBeenCalledWith(1, 'acme/backend', 88, ['Add SECURITY.md'])
        expect(res.body.data.repos).toEqual([{
            repoFullName: 'acme/backend', score: 88, failingChecks: ['Add SECURITY.md'],
            lastCheckedAt: '2026-09-05T00:00:00Z', delta: null,
        }])
        expect(res.body.meta.liveChecksUsed).toBe(1)
    })

    it('skips the live check for a fresh snapshot and reports its stored data', async () => {
        mockGetTrackedRepos.mockReturnValue({ items: [{ repo_full_name: 'acme/frontend' }], total: 1, countsBySignal: {} })
        mockGetLatestSnapshot.mockReturnValue({ score: 70, failing_checks: '[]', captured_at: '2026-09-05T00:00:00Z' })
        mockIsSnapshotFresh.mockReturnValue(true)
        mockGetWeekOverWeekDelta.mockReturnValue(-5)

        const res = await request(makeApp()).get('/api/v1/work-board/health')
        expect(res.status).toBe(200)
        expect(mockAnalyzeRepository).not.toHaveBeenCalled()
        expect(res.body.data.repos[0]).toMatchObject({ repoFullName: 'acme/frontend', score: 70, delta: -5 })
    })

    it('caps live checks per request and leaves the rest at their last known (possibly null) score', async () => {
        const items = Array.from({ length: 7 }, (_, i) => ({ repo_full_name: `acme/repo-${i}` }))
        mockGetTrackedRepos.mockReturnValue({ items, total: items.length, countsBySignal: {} })
        mockIsSnapshotFresh.mockReturnValue(false) // every repo looks stale/unscored before any check
        // Simulate persistence: getLatestSnapshot returns a real row only for
        // repos captureHealthSnapshot has actually been called for.
        const captured = new Set()
        mockCaptureHealthSnapshot.mockImplementation((_userId, repoFullName) => captured.add(repoFullName))
        mockGetLatestSnapshot.mockImplementation((_userId, repoFullName) =>
            captured.has(repoFullName) ? { score: 88, failing_checks: '[]', captured_at: 't' } : null)

        const res = await request(makeApp()).get('/api/v1/work-board/health')
        expect(res.status).toBe(200)
        expect(mockAnalyzeRepository).toHaveBeenCalledTimes(5) // HEALTH_LIVE_CHECK_CAP
        expect(res.body.meta.liveChecksUsed).toBe(5)
        const unscored = res.body.data.repos.filter(r => r.score === null)
        expect(unscored.length).toBe(2)
    })

    it('never fails the whole request when one repo\'s live check throws', async () => {
        mockGetTrackedRepos.mockReturnValue({ items: [{ repo_full_name: 'acme/broken' }], total: 1, countsBySignal: {} })
        mockGetLatestSnapshot.mockReturnValue(null)
        mockGithubApi.mockRejectedValueOnce(new Error('GitHub 404'))

        const res = await request(makeApp()).get('/api/v1/work-board/health')
        expect(res.status).toBe(200)
        expect(res.body.data.repos[0]).toMatchObject({ repoFullName: 'acme/broken', score: null })
    })

    it('ranks repos by score, sinking unscored repos to the bottom', async () => {
        mockGetTrackedRepos.mockReturnValue({
            items: [
                { repo_full_name: 'acme/mid' },
                { repo_full_name: 'acme/top' },
                { repo_full_name: 'acme/unscored' },
            ],
            total: 3, countsBySignal: {},
        })
        mockIsSnapshotFresh.mockReturnValue(true) // no live checks — pure ranking of stored snapshots
        mockGetLatestSnapshot.mockImplementation((_userId, repoFullName) => {
            if (repoFullName === 'acme/mid') return { score: 50, failing_checks: '[]', captured_at: 't' }
            if (repoFullName === 'acme/top') return { score: 95, failing_checks: '[]', captured_at: 't' }
            return null
        })

        const res = await request(makeApp()).get('/api/v1/work-board/health')
        expect(res.body.data.repos.map(r => r.repoFullName)).toEqual(['acme/top', 'acme/mid', 'acme/unscored'])
    })
})
