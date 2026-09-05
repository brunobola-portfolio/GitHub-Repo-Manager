/*
 * G7 — useDigestSettings: GET/PATCH wrapper over
 * /api/v1/notifications/digest/settings backing the Settings > General
 * digest-frequency control.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { _resetCsrfTokenForTests } from '@/utils/api'

// The hook goes through apiCall/fetchWithRetry, which injects its OWN CSRF
// token on mutations by calling the real (unmocked — it's a same-module
// self-reference `fetchWithRetry` can't be redirected by mocking the
// module's exports) fetchCsrfToken() internally. So the mutation test below
// must special-case that endpoint in the fetch dispatcher rather than
// relying on a getCsrfToken mock — this is different from hooks that import
// getCsrfToken directly and call raw fetch() themselves.
let fetchMock

beforeEach(() => {
    _resetCsrfTokenForTests()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', vi.fn((url, opts) => {
        if (String(url).includes('/api/auth/csrf-token')) {
            return Promise.resolve(ok({ token: 'csrf-test-token' }))
        }
        return fetchMock(url, opts)
    }))
})

const { useDigestSettings } = await import('@/hooks/useDigestSettings')

// apiCall (fetchWithRetry + safeParseJson) sniffs the content-type header and
// falls back to response.text() when it's missing, so the mock must look
// like a real Response — not just { ok, json() } — or safeParseJson throws
// trying to call a .text() that doesn't exist.
function ok(body) {
    return {
        ok: true,
        status: 200,
        headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => body,
        text: async () => JSON.stringify(body),
    }
}

describe('useDigestSettings', () => {
    it('fetches the current frequency on mount', async () => {
        fetchMock.mockResolvedValueOnce(ok({ frequency: 'weekly' }))
        const { result } = renderHook(() => useDigestSettings())
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.frequency).toBe('weekly')
        expect(fetchMock).toHaveBeenCalledWith('/api/v1/notifications/digest/settings', expect.objectContaining({ credentials: 'include' }))
    })

    it('defaults to "off" while loading', () => {
        fetchMock.mockResolvedValueOnce(ok({ frequency: 'daily' }))
        const { result } = renderHook(() => useDigestSettings())
        expect(result.current.frequency).toBe('off')
        expect(result.current.loading).toBe(true)
    })

    it('setFrequency PATCHes the new value and updates optimistically', async () => {
        fetchMock.mockResolvedValueOnce(ok({ frequency: 'off' })) // initial GET
        fetchMock.mockResolvedValueOnce(ok({ frequency: 'daily' })) // PATCH
        const { result } = renderHook(() => useDigestSettings())
        await waitFor(() => expect(result.current.loading).toBe(false))

        await act(async () => { await result.current.setFrequency('daily') })
        expect(result.current.frequency).toBe('daily')
        const patchCall = fetchMock.mock.calls[1]
        expect(patchCall[0]).toBe('/api/v1/notifications/digest/settings')
        expect(patchCall[1].method).toBe('PATCH')
        expect(JSON.parse(patchCall[1].body)).toEqual({ frequency: 'daily' })
        expect(patchCall[1].headers['X-CSRF-Token']).toBe('csrf-test-token')
    })

    it('rolls back to the previous value when the PATCH fails', async () => {
        fetchMock.mockResolvedValueOnce(ok({ frequency: 'off' })) // initial GET
        fetchMock.mockResolvedValueOnce({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) }) // PATCH fails
        const { result } = renderHook(() => useDigestSettings())
        await waitFor(() => expect(result.current.loading).toBe(false))

        await act(async () => {
            await expect(result.current.setFrequency('weekly')).rejects.toThrow()
        })
        expect(result.current.frequency).toBe('off')
    })
})
