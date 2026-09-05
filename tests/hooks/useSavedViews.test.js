/*
 * G5 — useSavedViews generalises useWorkBoardPresets to accept a `scope`, so
 * the Repositories filter bar can save/apply views through the same
 * backend. Covers: a non-default scope is passed through on every verb, and
 * MOCK_MODE persists to localStorage instead of hitting the network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('../../src/config', () => ({ MOCK_MODE: false, API_BASE_URL: '', API_BASE: '/api' }))
vi.mock('@/utils/api', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, getCsrfToken: vi.fn(async () => 'csrf-test-token') }
})

const { _resetCsrfTokenForTests } = await import('@/utils/api')

beforeEach(() => { global.fetch = vi.fn(); _resetCsrfTokenForTests() })

const { useSavedViews } = await import('@/hooks/useWorkBoardPresets')

function ok(body) { return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: body }) } }
// apiCall injects CSRF itself — every mutation's first real call is this token probe.
const csrf = () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ token: 'csrf-test-token' }) })

describe('useSavedViews — non-default scope (G5)', () => {
    it('lists with a scope query param', async () => {
        global.fetch.mockResolvedValueOnce(ok([]))
        renderHook(() => useSavedViews('repos'))
        await waitFor(() => expect(global.fetch).toHaveBeenCalled())
        expect(global.fetch.mock.calls[0][0]).toBe('/api/v1/work-board/presets?scope=repos')
    })

    it('creates with scope in the body', async () => {
        global.fetch.mockResolvedValueOnce(ok([]))
        global.fetch.mockResolvedValueOnce(csrf())
        global.fetch.mockResolvedValueOnce(ok({ id: 1 }))
        global.fetch.mockResolvedValueOnce(ok([{ id: 1, name: 'My repos view', filters: {}, scope: 'repos' }]))
        const { result } = renderHook(() => useSavedViews('repos'))
        await waitFor(() => expect(result.current.loading).toBe(false))
        await act(async () => { await result.current.create({ name: 'My repos view', filters: { q: 'x' } }) })
        const postCall = global.fetch.mock.calls[2]
        expect(JSON.parse(postCall[1].body)).toEqual({ name: 'My repos view', filters: { q: 'x' }, scope: 'repos' })
    })

    it('deletes with a scope query param', async () => {
        global.fetch.mockResolvedValueOnce(ok([{ id: 9, name: 'A', filters: {} }]))
        global.fetch.mockResolvedValueOnce(csrf())
        global.fetch.mockResolvedValueOnce(ok({ removed: 1 }))
        global.fetch.mockResolvedValueOnce(ok([]))
        const { result } = renderHook(() => useSavedViews('repos'))
        await waitFor(() => expect(result.current.presets).toHaveLength(1))
        await act(async () => { await result.current.remove(9) })
        expect(global.fetch.mock.calls[2][0]).toBe('/api/v1/work-board/presets/9?scope=repos')
    })
})

describe('useSavedViews — MOCK_MODE persists to localStorage', () => {
    beforeEach(async () => {
        vi.resetModules()
        vi.doMock('../../src/config', () => ({ MOCK_MODE: true, API_BASE_URL: '', API_BASE: '/api' }))
        localStorage.clear()
    })

    it('never touches the network and round-trips through localStorage', async () => {
        const { useSavedViews: useSavedViewsMock } = await import('@/hooks/useWorkBoardPresets')
        const { result } = renderHook(() => useSavedViewsMock('repos'))
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.presets).toEqual([])

        await act(async () => { await result.current.create({ name: 'Saved locally', filters: { type: 'fork' } }) })
        expect(global.fetch).not.toHaveBeenCalled()
        expect(result.current.presets).toHaveLength(1)
        expect(result.current.presets[0].name).toBe('Saved locally')

        // Persisted under a scope-specific key, so a fresh hook instance (as if
        // the page reloaded) picks it back up.
        const stored = JSON.parse(localStorage.getItem('saved-views:repos'))
        expect(stored).toHaveLength(1)
        expect(stored[0].filters).toEqual({ type: 'fork' })
    })

    it('rejects a duplicate name with the same code the server would', async () => {
        const { useSavedViews: useSavedViewsMock } = await import('@/hooks/useWorkBoardPresets')
        const { result } = renderHook(() => useSavedViewsMock('repos'))
        await waitFor(() => expect(result.current.loading).toBe(false))
        await act(async () => { await result.current.create({ name: 'Dup', filters: {} }) })
        await expect(result.current.create({ name: 'Dup', filters: {} })).rejects.toMatchObject({ code: 'preset_exists' })
    })

    it('keeps work-board and repos scopes in separate localStorage keys', async () => {
        const { useSavedViews: useSavedViewsMock } = await import('@/hooks/useWorkBoardPresets')
        const { result: repos } = renderHook(() => useSavedViewsMock('repos'))
        const { result: board } = renderHook(() => useSavedViewsMock('work-board'))
        await waitFor(() => expect(repos.current.loading).toBe(false))
        await waitFor(() => expect(board.current.loading).toBe(false))

        await act(async () => { await repos.current.create({ name: 'Same name', filters: {} }) })
        await act(async () => { await board.current.create({ name: 'Same name', filters: {} }) })

        expect(repos.current.presets).toHaveLength(1)
        expect(board.current.presets).toHaveLength(1)
    })
})
