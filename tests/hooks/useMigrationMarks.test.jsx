import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMigrationMarksFor, useMarksForPlan, __resetMarksAuthGateForTests } from '../../src/hooks/useMigrationMarks.js'

beforeEach(() => {
  global.fetch = vi.fn()
  __resetMarksAuthGateForTests()
})

describe('useMigrationMarksFor', () => {
  it('fetches and returns marks for a target full name', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ marks: [{ id: 1, scope: 'destination', status: 'written', target_id: 'foo/bar' }] })
    })
    const { result } = renderHook(() => useMigrationMarksFor('foo/bar'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.marks).toHaveLength(1)
    expect(result.current.marks[0].target_id).toBe('foo/bar')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/migration/marks?targetFullName=foo%2Fbar',
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('returns empty + not loading when fullName is missing', async () => {
    const { result } = renderHook(() => useMigrationMarksFor(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.marks).toEqual([])
  })

  it('sets error state on non-OK response', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 })
    const { result } = renderHook(() => useMigrationMarksFor('x/y'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeInstanceOf(Error)
  })
})

describe('useMarksForPlan', () => {
  it('fetches plan marks and groups by scope', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        planId: 42,
        byScope: {
          source: [{ id: 1, status: 'written' }],
          destination: [{ id: 2, status: 'written' }, { id: 3, status: 'skipped' }],
          'git-tag': []
        },
        marks: [{ id: 1 }, { id: 2 }, { id: 3 }]
      })
    })
    const { result } = renderHook(() => useMarksForPlan(42))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.byScope.destination).toHaveLength(2)
    expect(result.current.marks).toHaveLength(3)
  })

  it('no-ops when planId is falsy', async () => {
    const { result } = renderHook(() => useMarksForPlan(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('401 session gate', () => {
  it('stops fetching marks for the rest of the session after a 401', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401 })
    const first = renderHook(() => useMigrationMarksFor('a/one'))
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    expect(global.fetch).toHaveBeenCalledTimes(1)

    // Every subsequent card would previously fire its own request + 401 —
    // now the module-level gate short-circuits them.
    const second = renderHook(() => useMigrationMarksFor('a/two'))
    await waitFor(() => expect(second.result.current.loading).toBe(false))
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(second.result.current.marks).toEqual([])

    const plan = renderHook(() => useMarksForPlan(7))
    await waitFor(() => expect(plan.result.current.loading).toBe(false))
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
