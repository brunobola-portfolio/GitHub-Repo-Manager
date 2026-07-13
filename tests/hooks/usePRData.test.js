import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { usePRData, _clearPRDataCache } from '../../src/hooks/usePRData'

const mockApi = {
  fetchPull: vi.fn(),
  fetchPullFiles: vi.fn(),
  fetchPullReviews: vi.fn(),
  fetchIssueComments: vi.fn(),
}

const DETAIL = { number: 1, title: 'Test PR', state: 'open' }
const FILES   = [{ filename: 'foo.js', additions: 5, deletions: 2, patch: '@@ -1 +1 @@\n-a\n+b' }]
const REVIEWS = [{ id: 1, state: 'APPROVED' }]
const COMMENTS = []

beforeEach(() => {
  vi.clearAllMocks()
  _clearPRDataCache()
  mockApi.fetchPull.mockResolvedValue(DETAIL)
  mockApi.fetchPullFiles.mockResolvedValue(FILES)
  mockApi.fetchPullReviews.mockResolvedValue(REVIEWS)
  mockApi.fetchIssueComments.mockResolvedValue(COMMENTS)
})

describe('usePRData', () => {
  it('starts in loading state', () => {
    const { result } = renderHook(() =>
      usePRData(mockApi, { owner: 'acme', repo: 'backend', number: 1 })
    )
    expect(result.current.loading).toBe(true)
    expect(result.current.detail).toBeNull()
  })

  it('fetches all data in parallel and resolves', async () => {
    const { result } = renderHook(() =>
      usePRData(mockApi, { owner: 'acme', repo: 'backend', number: 1 })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.detail).toEqual(DETAIL)
    expect(result.current.files).toEqual(FILES)
    expect(result.current.reviews).toEqual(REVIEWS)
    expect(mockApi.fetchPull).toHaveBeenCalledWith(1)
    expect(mockApi.fetchPullFiles).toHaveBeenCalledWith(1)
  })

  it('returns cached data without re-fetching', async () => {
    const opts = { owner: 'acme', repo: 'backend', number: 1 }
    const { result: r1 } = renderHook(() => usePRData(mockApi, opts))
    await waitFor(() => expect(r1.current.loading).toBe(false))

    const { result: r2 } = renderHook(() => usePRData(mockApi, opts))
    await waitFor(() => expect(r2.current.loading).toBe(false))

    // fetchPull called only once across two renders (cache hit on second)
    expect(mockApi.fetchPull).toHaveBeenCalledTimes(1)
  })

  it('does not fetch when enabled=false', () => {
    renderHook(() =>
      usePRData(mockApi, { owner: 'acme', repo: 'backend', number: 1, enabled: false })
    )
    expect(mockApi.fetchPull).not.toHaveBeenCalled()
  })

  it('captures the cache key at request time so a late-resolving stale request cannot cross-contaminate a different key\'s cache or state', async () => {
    let resolvePR1
    let resolvePR2
    mockApi.fetchPull.mockImplementation((num) => {
      if (num === 1) return new Promise((resolve) => { resolvePR1 = resolve })
      return new Promise((resolve) => { resolvePR2 = resolve })
    })
    mockApi.fetchPullFiles.mockImplementation((num) =>
      Promise.resolve(num === 1 ? FILES : [{ filename: 'other.js', additions: 1, deletions: 0, patch: '' }])
    )

    const { result, rerender } = renderHook(
      ({ number }) => usePRData(mockApi, { owner: 'acme', repo: 'backend', number }),
      { initialProps: { number: 1 } }
    )

    await waitFor(() => expect(mockApi.fetchPull).toHaveBeenCalledWith(1))

    // The user navigates to a different PR before request #1 resolves.
    rerender({ number: 2 })
    await waitFor(() => expect(mockApi.fetchPull).toHaveBeenCalledWith(2))

    // The current request (#2) resolves first.
    resolvePR2({ number: 2, title: 'PR two', state: 'open' })
    await waitFor(() => expect(result.current.detail?.number).toBe(2))

    // The stale request (#1) resolves late, out of order.
    resolvePR1(DETAIL)
    // Flush the pending Promise.all -> setState microtask chain.
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    // Live state must still reflect #2, never clobbered by the late #1 response.
    expect(result.current.detail?.number).toBe(2)

    // The cache for each key must hold that key's own data — not
    // cross-contaminated by being written under the wrong (current) key.
    mockApi.fetchPull.mockClear()
    const { result: cached1 } = renderHook(() =>
      usePRData(mockApi, { owner: 'acme', repo: 'backend', number: 1 })
    )
    expect(cached1.current.detail).toEqual(DETAIL)
    expect(mockApi.fetchPull).not.toHaveBeenCalled()

    const { result: cached2 } = renderHook(() =>
      usePRData(mockApi, { owner: 'acme', repo: 'backend', number: 2 })
    )
    expect(cached2.current.detail?.number).toBe(2)
    expect(mockApi.fetchPull).not.toHaveBeenCalled()
  })

  it('sets error on fetch failure', async () => {
    mockApi.fetchPull.mockRejectedValue(new Error('network error'))
    const { result } = renderHook(() =>
      usePRData(mockApi, { owner: 'acme', repo: 'backend', number: 2 })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('network error')
  })
})
