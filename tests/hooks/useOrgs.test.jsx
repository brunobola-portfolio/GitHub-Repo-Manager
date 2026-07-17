/*
 * useOrgs — two effects both fired a global stats fetch on login (one via
 * "auto-refresh stats when selectedOrg changes" reacting to the `user`
 * transition, the other via the dedicated "load orgs and stats on login"
 * effect), so every login issued a duplicate GET /api/stats. Consolidated
 * into a single effect: login loads orgs + global stats once; an explicit
 * selectedOrg switch afterwards refetches stats scoped to that org only
 * (no repeated /api/orgs call).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

// .env.test defaults VITE_MOCK_MODE=true; force the real-fetch branch so
// these assertions exercise the actual /api/orgs + /api/stats calls rather
// than the synthetic mock-data generators.
vi.stubEnv('VITE_MOCK_MODE', 'false')

const { useOrgs } = await import('../../src/hooks/useOrgs')

describe('useOrgs — consolidated login / org-switch stats effect', () => {
    let calls

    beforeEach(() => {
        calls = []
        global.fetch = vi.fn((url) => {
            calls.push(url)
            if (url === '/api/orgs') {
                return Promise.resolve({ ok: true, json: async () => ([{ login: 'acme' }]) })
            }
            return Promise.resolve({ ok: true, json: async () => ({ totalRepos: 1 }) })
        })
    })

    it('fetches orgs + stats exactly once on login (no duplicate global stats fetch)', async () => {
        const user = { login: 'me' }
        const { rerender } = renderHook(({ u }) => useOrgs(u), { initialProps: { u: null } })
        expect(calls.length).toBe(0)

        rerender({ u: user })

        await waitFor(() => expect(calls.filter((u) => u === '/api/orgs').length).toBe(1))
        await waitFor(() => expect(calls.filter((u) => u === '/api/stats').length).toBe(1))

        // Give any stray extra microtask-scheduled fetch a chance to land
        // before asserting there wasn't a second /api/stats call.
        await Promise.resolve()
        expect(calls.filter((u) => u === '/api/stats').length).toBe(1)
        expect(calls.filter((u) => u === '/api/orgs').length).toBe(1)
    })

    it('switching selectedOrg after login refetches scoped stats only — no repeated /api/orgs', async () => {
        const user = { login: 'me' }
        const { result } = renderHook(() => useOrgs(user))

        await waitFor(() => expect(calls.filter((u) => u === '/api/orgs').length).toBe(1))
        await waitFor(() => expect(calls.filter((u) => u === '/api/stats').length).toBe(1))

        calls.length = 0

        act(() => {
            result.current.setSelectedOrg('acme')
        })

        await waitFor(() => expect(calls.some((u) => u === '/api/stats?org=acme')).toBe(true))

        expect(calls.filter((u) => u === '/api/orgs').length).toBe(0)
        expect(calls.filter((u) => u.startsWith('/api/stats')).length).toBe(1)
    })

    it('does nothing while logged out', async () => {
        renderHook(() => useOrgs(null))
        await Promise.resolve()
        expect(calls.length).toBe(0)
    })
})
