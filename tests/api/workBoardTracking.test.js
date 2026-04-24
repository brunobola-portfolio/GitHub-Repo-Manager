import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/api', () => ({
    getCsrfToken: vi.fn(async () => 'csrf-test-token'),
}))

const {
    fetchTrackedRepos,
    mutateTrackedRepo,
    bulkMutateTrackedRepos,
    fetchPrefs,
    patchPrefs,
    postDiscover,
    postUndo,
    postPing,
    searchRepos,
} = await import('../../src/api/workBoardTracking')

beforeEach(() => {
    global.fetch = vi.fn()
})

describe('fetchTrackedRepos', () => {
    it('GETs /api/v1/work-board/tracked-repos with query string', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ items: [], total: 0, countsBySignal: {} }),
        })
        await fetchTrackedRepos({ search: 'acme', muted: false, limit: 20 })
        const url = global.fetch.mock.calls[0][0]
        expect(url).toBe('/api/v1/work-board/tracked-repos?search=acme&muted=false&limit=20')
        expect(global.fetch.mock.calls[0][1]).toMatchObject({
            method: 'GET',
            credentials: 'include',
        })
    })

    it('throws on non-2xx', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
        await expect(fetchTrackedRepos({})).rejects.toThrow(/500/)
    })
})

describe('mutateTrackedRepo', () => {
    it('POSTs with CSRF header and body', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ operation_id: '00000000-0000-0000-0000-000000000001', new_state: { is_pinned: 1 } }),
        })
        const result = await mutateTrackedRepo('acme/x', 'pin')
        expect(result.operation_id).toBe('00000000-0000-0000-0000-000000000001')
        const call = global.fetch.mock.calls[0]
        expect(call[0]).toBe('/api/v1/work-board/tracked-repos')
        expect(call[1].method).toBe('POST')
        expect(call[1].headers['X-CSRF-Token']).toBe('csrf-test-token')
        expect(JSON.parse(call[1].body)).toEqual({ repo: 'acme/x', action: 'pin' })
    })
})

describe('bulkMutateTrackedRepos', () => {
    it('POSTs /bulk with repos array', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ operation_id: 'op-2', updated: 2, skipped: [] }),
        })
        await bulkMutateTrackedRepos(['a/b', 'c/d'], 'mute')
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/work-board/tracked-repos/bulk')
        expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ repos: ['a/b', 'c/d'], action: 'mute' })
    })
})

describe('fetchPrefs and patchPrefs', () => {
    it('fetchPrefs GETs /prefs', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ discovery_window_days: 60 }) })
        const out = await fetchPrefs()
        expect(out.discovery_window_days).toBe(60)
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/work-board/prefs')
    })

    it('patchPrefs PATCHes with CSRF', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ discovery_window_days: 90 }) })
        await patchPrefs({ discovery_window_days: 90 })
        const call = global.fetch.mock.calls[0]
        expect(call[1].method).toBe('PATCH')
        expect(call[1].headers['X-CSRF-Token']).toBe('csrf-test-token')
        expect(JSON.parse(call[1].body)).toEqual({ discovery_window_days: 90 })
    })
})

describe('postDiscover / postUndo / postPing / searchRepos', () => {
    it('postDiscover POSTs /discover', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ discovered: 5, added: 5, removed: 0 }) })
        const out = await postDiscover()
        expect(out.discovered).toBe(5)
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/work-board/discover')
        expect(global.fetch.mock.calls[0][1].method).toBe('POST')
    })

    it('postUndo POSTs /undo/:op_id', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ reverted: true }) })
        await postUndo('op-abc')
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/work-board/undo/op-abc')
    })

    it('postPing GETs /ping', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ prefs: {}, discovery_in_flight: false }) })
        await postPing()
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/work-board/ping')
        expect(global.fetch.mock.calls[0][1].method).toBe('GET')
    })

    it('searchRepos GETs /repo-search?q=', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ tracked: [], untracked: [] }) })
        await searchRepos('acme')
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/work-board/repo-search?q=acme')
    })
})
