import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockGithubApi = vi.fn()
vi.mock('../lib/github-api.js', async (io) => ({
    ...(await io()),
    githubApi: (...a) => mockGithubApi(...a),
}))
vi.mock('../middleware/auth.js', async (io) => ({
    ...(await io()),
    requireAuth: (req, _res, next) => next(),
}))

const { default: router } = await import('../routes/repos/pulls.js')

function makeApp() {
    const app = express()
    app.use((req, _res, next) => { req.session = { userId: 1, accessToken: 'ghp_x' }; req.log = { error: vi.fn() }; next() })
    app.use('/api/repos', router)
    return app
}

const linkTo = (last) =>
    `<https://api.github.com/repositories/1/pulls/9/files?per_page=100&page=2>; rel="next", ` +
    `<https://api.github.com/repositories/1/pulls/9/files?per_page=100&page=${last}>; rel="last"`

function pageOf(url) {
    return Number(new URL(url, 'https://api.github.com').searchParams.get('page'))
}

beforeEach(() => mockGithubApi.mockReset())

describe('GET /api/repos/:owner/:repo/pulls/:n/files', () => {
    it('returns a single page when there is no Link header', async () => {
        mockGithubApi.mockResolvedValue({ data: [{ filename: 'a.js' }], headers: new Headers() })
        const res = await request(makeApp()).get('/api/repos/acme/app/pulls/9/files')
        expect(res.status).toBe(200)
        expect(res.body).toEqual([{ filename: 'a.js' }])
        expect(mockGithubApi).toHaveBeenCalledTimes(1)
    })

    it('fetches the pages after the first together and keeps their order', async () => {
        let inFlight = 0
        let peak = 0
        mockGithubApi.mockImplementation(async (url) => {
            const page = pageOf(url)
            inFlight += 1
            peak = Math.max(peak, inFlight)
            await new Promise((r) => setTimeout(r, page === 1 ? 0 : 40 - page * 5))
            inFlight -= 1
            return { data: [{ filename: `f${page}.js` }], headers: new Headers(page === 1 ? { link: linkTo(6) } : {}) }
        })

        const res = await request(makeApp()).get('/api/repos/acme/app/pulls/9/files')
        expect(res.status).toBe(200)
        expect(res.body.map((f) => f.filename)).toEqual(['f1.js', 'f2.js', 'f3.js', 'f4.js', 'f5.js', 'f6.js'])
        expect(peak).toBe(4)
    })

    it("stops at GitHub's 30-page ceiling even when Link names a later page", async () => {
        mockGithubApi.mockImplementation(async (url) => ({
            data: [{ filename: `f${pageOf(url)}.js` }],
            headers: new Headers(pageOf(url) === 1 ? { link: linkTo(45) } : {}),
        }))
        const res = await request(makeApp()).get('/api/repos/acme/app/pulls/9/files')
        expect(res.body).toHaveLength(30)
        expect(mockGithubApi).toHaveBeenCalledTimes(30)
    })
})
