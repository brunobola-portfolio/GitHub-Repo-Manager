/*
 * fetchSessionInfo shares one in-flight request between useIsAdmin and
 * useSessionExpiry. The first version handed both the same Response, and a
 * Response body reads once — the second .json() threw "body stream already
 * read", so the admin flag was lost on every cold start where the two raced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchSessionInfo, _resetSessionInfoForTests } from '@/api/sessionInfo'

describe('fetchSessionInfo', () => {
    beforeEach(() => {
        _resetSessionInfoForTests()
        global.fetch = vi.fn(async () => new Response(JSON.stringify({ authenticated: true, isAdmin: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }))
    })

    it('two concurrent callers share one request and can both read the body', async () => {
        const [a, b] = await Promise.all([fetchSessionInfo(), fetchSessionInfo()])
        expect(global.fetch).toHaveBeenCalledTimes(1)
        const [ja, jb] = await Promise.all([a.json(), b.json()])
        expect(ja.isAdmin).toBe(true)
        expect(jb.isAdmin).toBe(true)
    })

    it('a later call after settlement is a fresh request', async () => {
        await fetchSessionInfo()
        await fetchSessionInfo()
        expect(global.fetch).toHaveBeenCalledTimes(2)
    })
})
