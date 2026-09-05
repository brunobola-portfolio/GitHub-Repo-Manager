import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useHostAllowlist } from '@/hooks/useHostAllowlist'

const okJson = (body) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body })

describe('useHostAllowlist', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stays idle and never fetches for an empty host', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useHostAllowlist(''))

      expect(result.current.status).toBe('idle')
      expect(result.current.allowed).toBeNull()

      // Even well past the debounce window, nothing should fire.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(global.fetch).not.toHaveBeenCalled()
      expect(result.current.status).toBe('idle')
    } finally {
      vi.useRealTimers()
    }
  })

  it('fetches the lowercased, trimmed host after the debounce and maps allowed:true to "allowed"', async () => {
    vi.useFakeTimers()
    try {
      global.fetch.mockResolvedValueOnce(okJson({
        allowed: true,
        patterns: ['dev.azure.com', '*.visualstudio.com'],
        usingDefault: false,
        canEdit: true,
      }))

      const { result } = renderHook(() => useHostAllowlist('  Dev.Azure.COM  '))

      // Nothing before the debounce elapses.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(399)
      })
      expect(global.fetch).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/azure/host-allowlist?host=dev.azure.com',
        expect.objectContaining({ credentials: 'include' })
      )

      await vi.waitFor(() => {
        expect(result.current.status).toBe('allowed')
      })
      expect(result.current.allowed).toBe(true)
      expect(result.current.patterns).toEqual(['dev.azure.com', '*.visualstudio.com'])
      expect(result.current.usingDefault).toBe(false)
      expect(result.current.canEdit).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps allowed:false to "blocked" and mirrors patterns/usingDefault/canEdit', async () => {
    vi.useFakeTimers()
    try {
      global.fetch.mockResolvedValueOnce(okJson({
        allowed: false,
        patterns: ['dev.azure.com'],
        usingDefault: true,
        canEdit: false,
      }))

      const { result } = renderHook(() => useHostAllowlist('tfs.corp.local'))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })

      await vi.waitFor(() => {
        expect(result.current.status).toBe('blocked')
      })
      expect(result.current.allowed).toBe(false)
      expect(result.current.patterns).toEqual(['dev.azure.com'])
      expect(result.current.usingDefault).toBe(true)
      expect(result.current.canEdit).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('debounces typing: only one fetch fires, for the final value', async () => {
    vi.useFakeTimers()
    try {
      global.fetch.mockResolvedValueOnce(okJson({
        allowed: true, patterns: [], usingDefault: true, canEdit: false,
      }))

      const { rerender } = renderHook(({ host }) => useHostAllowlist(host), {
        initialProps: { host: 'd' },
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      rerender({ host: 'dev.az' })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      rerender({ host: 'dev.azure.com' })

      // 400ms have passed in total, but each keystroke reset the timer.
      expect(global.fetch).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/azure/host-allowlist?host=dev.azure.com',
        expect.objectContaining({ credentials: 'include' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a late response for a previous host (stale-response guard)', async () => {
    vi.useFakeTimers()
    try {
      let resolveOld
      let resolveNew
      global.fetch
        .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve }))
        .mockReturnValueOnce(new Promise((resolve) => { resolveNew = resolve }))

      const { result, rerender } = renderHook(({ host }) => useHostAllowlist(host), {
        initialProps: { host: 'old.host' },
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe('checking')

      // Host changes while the first request is still in flight.
      rerender({ host: 'new.host' })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      expect(global.fetch).toHaveBeenCalledTimes(2)
      expect(global.fetch).toHaveBeenLastCalledWith(
        '/api/azure/host-allowlist?host=new.host',
        expect.objectContaining({ credentials: 'include' })
      )

      // The stale response for old.host lands now — it must NOT be applied.
      await act(async () => {
        resolveOld(okJson({ allowed: false, patterns: ['stale'], usingDefault: true, canEdit: false }))
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.status).toBe('checking')
      expect(result.current.patterns).toEqual([])

      // The response for the current host is applied normally.
      await act(async () => {
        resolveNew(okJson({ allowed: true, patterns: ['new.host'], usingDefault: false, canEdit: true }))
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.status).toBe('allowed')
      expect(result.current.allowed).toBe(true)
      expect(result.current.patterns).toEqual(['new.host'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails open: returns to idle when fetch rejects', async () => {
    vi.useFakeTimers()
    try {
      let rejectFetch
      global.fetch.mockReturnValueOnce(new Promise((resolve, reject) => { rejectFetch = reject }))

      const { result } = renderHook(() => useHostAllowlist('down.host'))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe('checking')

      await act(async () => {
        rejectFetch(new Error('Network down'))
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.status).toBe('idle')
      expect(result.current.allowed).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails open: returns to idle on a non-ok HTTP response', async () => {
    vi.useFakeTimers()
    try {
      let resolveFetch
      global.fetch.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve }))

      const { result } = renderHook(() => useHostAllowlist('flaky.host'))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      expect(result.current.status).toBe('checking')

      await act(async () => {
        resolveFetch({ ok: false, status: 500, json: async () => ({}) })
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.status).toBe('idle')
      expect(result.current.allowed).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('refresh() re-fetches immediately for the current host', async () => {
    vi.useFakeTimers()
    try {
      global.fetch
        .mockResolvedValueOnce(okJson({
          allowed: false, patterns: ['dev.azure.com'], usingDefault: true, canEdit: true,
        }))
        .mockResolvedValueOnce(okJson({
          allowed: true, patterns: ['dev.azure.com', 'tfs.corp.local'], usingDefault: false, canEdit: true,
        }))

      const { result } = renderHook(() => useHostAllowlist('TFS.Corp.Local'))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      await vi.waitFor(() => {
        expect(result.current.status).toBe('blocked')
      })

      // e.g. the user just added the host to the allowlist — re-check now,
      // without advancing any timers (no debounce wait).
      await act(async () => {
        result.current.refresh()
      })
      expect(global.fetch).toHaveBeenCalledTimes(2)
      expect(global.fetch).toHaveBeenLastCalledWith(
        '/api/azure/host-allowlist?host=tfs.corp.local',
        expect.objectContaining({ credentials: 'include' })
      )

      await vi.waitFor(() => {
        expect(result.current.status).toBe('allowed')
      })
      expect(result.current.patterns).toEqual(['dev.azure.com', 'tfs.corp.local'])
      expect(result.current.usingDefault).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
