import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Mutations now fetch a CSRF token; stub it so the test's global.fetch queue
// isn't consumed by the auth/csrf-token request.
vi.mock('../../src/config', () => ({ MOCK_MODE: false, API_BASE_URL: '', API_BASE: '/api' }))
vi.mock('@/utils/api', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, getCsrfToken: vi.fn(async () => 'csrf-test-token') }
})

beforeEach(() => { global.fetch = vi.fn(); })

const { useWorkBoardPresets } = await import('@/hooks/useWorkBoardPresets')

function ok(body) { return { ok: true, json: async () => ({ data: body }) } }
function err(status, body = {}) { return { ok: false, status, json: async () => body } }

describe('useWorkBoardPresets', () => {
    it('fetches on mount', async () => {
        global.fetch.mockResolvedValueOnce(ok([{ id: 1, name: 'A', filters: {} }]))
        const { result } = renderHook(() => useWorkBoardPresets())
        await waitFor(() => expect(result.current.presets).toHaveLength(1))
        expect(global.fetch).toHaveBeenCalledWith('/api/v1/work-board/presets', expect.objectContaining({ credentials: 'include' }))
    })

    it('exposes loading=true initially', async () => {
        global.fetch.mockResolvedValueOnce(ok([]))
        const { result } = renderHook(() => useWorkBoardPresets())
        expect(result.current.loading).toBe(true)
        await waitFor(() => expect(result.current.loading).toBe(false))
    })

    it('create posts and refreshes', async () => {
        global.fetch.mockResolvedValueOnce(ok([])) // initial
        global.fetch.mockResolvedValueOnce(ok({ id: 42 })) // POST
        global.fetch.mockResolvedValueOnce(ok([{ id: 42, name: 'A', filters: {} }])) // re-fetch
        const { result } = renderHook(() => useWorkBoardPresets())
        await waitFor(() => expect(result.current.loading).toBe(false))
        await act(async () => { await result.current.create({ name: 'A', filters: {} }); });
        await waitFor(() => expect(result.current.presets).toHaveLength(1))
        const postCall = global.fetch.mock.calls[1]
        expect(postCall[1].method).toBe('POST')
        expect(JSON.parse(postCall[1].body)).toEqual({ name: 'A', filters: {} })
    })

    it('create throws with code when server returns 409 preset_exists', async () => {
        global.fetch.mockResolvedValueOnce(ok([])) // initial
        global.fetch.mockResolvedValueOnce(err(409, { code: 'preset_exists', error: 'Preset name already exists' })) // POST
        const { result } = renderHook(() => useWorkBoardPresets())
        await waitFor(() => expect(result.current.loading).toBe(false))
        await act(async () => {
            await expect(result.current.create({ name: 'dup', filters: {} })).rejects.toMatchObject({ code: 'preset_exists' })
        })
    })

    it('update patches and refreshes', async () => {
        global.fetch.mockResolvedValueOnce(ok([]))
        global.fetch.mockResolvedValueOnce(ok({ updated: 1 }))
        global.fetch.mockResolvedValueOnce(ok([{ id: 7, name: 'B', filters: {} }]))
        const { result } = renderHook(() => useWorkBoardPresets())
        await waitFor(() => expect(result.current.loading).toBe(false))
        await act(async () => { await result.current.update(7, { name: 'B' }); });
        const call = global.fetch.mock.calls[1]
        expect(call[0]).toBe('/api/v1/work-board/presets/7')
        expect(call[1].method).toBe('PATCH')
    })

    it('remove deletes and refreshes', async () => {
        global.fetch.mockResolvedValueOnce(ok([{ id: 7, name: 'A', filters: {} }]))
        global.fetch.mockResolvedValueOnce(ok({ removed: 1 }))
        global.fetch.mockResolvedValueOnce(ok([]))
        const { result } = renderHook(() => useWorkBoardPresets())
        await waitFor(() => expect(result.current.presets).toHaveLength(1))
        await act(async () => { await result.current.remove(7); });
        await waitFor(() => expect(result.current.presets).toHaveLength(0))
        const call = global.fetch.mock.calls[1]
        expect(call[1].method).toBe('DELETE')
    })

    it('refresh re-fetches the list', async () => {
        global.fetch.mockResolvedValueOnce(ok([]))
        global.fetch.mockResolvedValueOnce(ok([{ id: 1, name: 'new', filters: {} }]))
        const { result } = renderHook(() => useWorkBoardPresets())
        await waitFor(() => expect(result.current.loading).toBe(false))
        await act(async () => { await result.current.refresh(); });
        await waitFor(() => expect(result.current.presets).toHaveLength(1))
    })
})
