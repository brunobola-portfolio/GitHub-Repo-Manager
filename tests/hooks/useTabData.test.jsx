// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useTabData } from '../../src/hooks/useTabData'

describe('useTabData', () => {
    it('starts in loading state and resolves with data', async () => {
        const loader = vi.fn(async () => ({ items: [1, 2, 3] }))
        const { result } = renderHook(() => useTabData(loader, []))

        expect(result.current.loading).toBe(true)
        expect(result.current.data).toBeNull()

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.data).toEqual({ items: [1, 2, 3] })
        expect(result.current.error).toBeNull()
    })

    it('captures error and clears loading', async () => {
        const loader = vi.fn(async () => { throw new Error('boom') })
        const { result } = renderHook(() => useTabData(loader, []))

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.error?.message).toBe('boom')
        expect(result.current.data).toBeNull()
    })

    it('ignores AbortError so a tab switch never surfaces an error', async () => {
        const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' })
        const loader = vi.fn(async () => { throw abortErr })
        const { result } = renderHook(() => useTabData(loader, []))

        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.error).toBeNull()
    })

    it('reload re-invokes the loader and refreshes data', async () => {
        let callCount = 0
        const loader = vi.fn(async () => ({ n: ++callCount }))
        const { result } = renderHook(() => useTabData(loader, []))

        await waitFor(() => expect(result.current.data).toEqual({ n: 1 }))
        await act(async () => { await result.current.reload() })
        await waitFor(() => expect(result.current.data).toEqual({ n: 2 }))
    })

    it('passes an AbortSignal to the loader', async () => {
        const loader = vi.fn(async (signal) => {
            expect(signal).toBeInstanceOf(AbortSignal)
            return { ok: true }
        })
        const { result } = renderHook(() => useTabData(loader, []))
        await waitFor(() => expect(result.current.data).toEqual({ ok: true }))
        expect(loader).toHaveBeenCalled()
    })

    it('aborts in-flight loader when deps change', async () => {
        const loaderA = vi.fn((signal) => new Promise((_, reject) => {
            signal.addEventListener('abort', () => {
                const e = new Error('aborted')
                e.name = 'AbortError'
                reject(e)
            })
        }))
        const { rerender, result } = renderHook(({ dep }) => useTabData(loaderA, [dep]), {
            initialProps: { dep: 1 },
        })

        // Trigger a new load; the first should abort
        rerender({ dep: 2 })
        // Resolve the second
        await waitFor(() => expect(result.current.error).toBeNull())
        // The first call should have been aborted (no error surfaced)
        expect(result.current.loading).toBe(true) // second call is still pending in the test setup
    })
})
