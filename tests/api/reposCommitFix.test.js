import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The helper branches on config.MOCK_MODE, which is derived from
// import.meta.env.VITE_MOCK_MODE at module load — so each scenario imports the
// module fresh with the env stubbed to the value under test.
beforeEach(() => { vi.resetModules() })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('commitCommunityHealthFix', () => {
    it('short-circuits in mock mode without any network call (direct)', async () => {
        vi.stubEnv('VITE_MOCK_MODE', 'true')
        const fetchSpy = vi.fn()
        vi.stubGlobal('fetch', fetchSpy)
        const { commitCommunityHealthFix } = await import('../../src/api/repos')

        const res = await commitCommunityHealthFix({ owner: 'acme', repo: 'lib', fileType: 'readme_stub', content: '# x', commitMessage: 'docs: x', mode: 'direct' })

        expect(fetchSpy).not.toHaveBeenCalled()
        expect(res).toMatchObject({ committed: true, mode: 'direct', path: 'readme_stub', branch: 'main' })
    })

    it('returns a PR shape (no direct commit) in mock mode when mode=pr', async () => {
        vi.stubEnv('VITE_MOCK_MODE', 'true')
        vi.stubGlobal('fetch', vi.fn())
        const { commitCommunityHealthFix } = await import('../../src/api/repos')

        const res = await commitCommunityHealthFix({ owner: 'acme', repo: 'lib', fileType: 'contributing', content: '# x', commitMessage: 'x', mode: 'pr' })

        expect(res.committed).toBe(false)
        expect(res.mode).toBe('pr')
        expect(res.prUrl).toContain('/acme/lib/pull/')
    })

    it('posts to the community-health/commit-fix path with the CSRF header when not in mock mode', async () => {
        vi.stubEnv('VITE_MOCK_MODE', 'false')
        const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ committed: true, mode: 'direct', branch: 'main' }) })
        vi.stubGlobal('fetch', fetchSpy)
        vi.doMock('../../src/utils/api', () => ({ getCsrfToken: vi.fn().mockResolvedValue('tok-123') }))
        const { commitCommunityHealthFix } = await import('../../src/api/repos')

        const res = await commitCommunityHealthFix({ owner: 'acme', repo: 'lib', fileType: 'readme_stub', content: '# x', commitMessage: 'docs: x', mode: 'direct' })

        expect(fetchSpy).toHaveBeenCalledTimes(1)
        const [url, opts] = fetchSpy.mock.calls[0]
        expect(url).toBe('/api/repos/acme/lib/community-health/commit-fix')
        expect(opts.headers['X-CSRF-Token']).toBe('tok-123')
        expect(JSON.parse(opts.body)).toMatchObject({ fileType: 'readme_stub', mode: 'direct' })
        expect(res.branch).toBe('main')
    })

    it('throws an error carrying status/code when the write fails (non-mock)', async () => {
        vi.stubEnv('VITE_MOCK_MODE', 'false')
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'nope', code: 'FORBIDDEN' }) }))
        vi.doMock('../../src/utils/api', () => ({ getCsrfToken: vi.fn().mockResolvedValue('tok') }))
        const { commitCommunityHealthFix } = await import('../../src/api/repos')

        await expect(commitCommunityHealthFix({ owner: 'a', repo: 'b', fileType: 'readme_stub', content: 'x', commitMessage: 'x' }))
            .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
    })
})
