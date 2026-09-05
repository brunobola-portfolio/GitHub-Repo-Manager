/**
 * A false all-clear is worse than an error.
 *
 * fetchCount collapsed every failure — a 500, a network drop, a JSON parse
 * error — into `{count: 0}`, and the hook reported `status: 'ready'`
 * unconditionally. With all three endpoints down, WhatNeedsYouGrid summed
 * three zeroes and confidently told the user "You're all caught up. Nothing
 * needs you right now." while nothing had actually been checked.
 *
 * 401/403/404 are deliberately NOT failures here: they mean the endpoint is
 * gated or absent for this user, which the hook already models as `hidden`.
 * Only a genuine "we could not find out" counts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.stubEnv('VITE_MOCK_MODE', 'false')

const { useYourWork } = await import('../../src/hooks/useYourWork.js')

const ok = (data) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data }) })
const boom = () => ({ ok: false, status: 500, json: async () => ({}) })
const gated = () => ({ ok: false, status: 403, json: async () => ({}) })

beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
})

const load = async (impl) => {
    vi.stubGlobal('fetch', vi.fn(impl))
    const { result } = renderHook(() => useYourWork({ tier: 'pro' }))
    await waitFor(() => expect(result.current.status).not.toBe('loading'))
    return result
}

describe('useYourWork — failures must not read as an empty inbox', () => {
    it('reports an error when every source fails', async () => {
        const result = await load(async () => boom())
        expect(result.current.status).toBe('error')
    })

    it('reports an error when only some sources fail', async () => {
        // A partial failure that happens to sum to zero is still a claim the
        // hook cannot support.
        let n = 0
        const result = await load(async () => (n++ === 0 ? ok([]) : boom()))
        expect(result.current.status).toBe('error')
    })

    it('reports an error when the network throws outright', async () => {
        const result = await load(async () => { throw new TypeError('Failed to fetch') })
        expect(result.current.status).toBe('error')
    })

    it('stays ready when everything genuinely returns nothing', async () => {
        const result = await load(async () => ok([]))
        expect(result.current.status).toBe('ready')
        expect(result.current.reviews.count).toBe(0)
    })

    it('stays ready when an endpoint is gated rather than broken', async () => {
        // 403 means "not for this tier", which the hook already models as
        // hidden — treating it as an error would nag Free users forever.
        const result = await load(async () => gated())
        expect(result.current.status).toBe('ready')
        expect(result.current.hidden).toBe(true)
    })

    it('still reports real counts when the sources work', async () => {
        const result = await load(async () => ok([{}, {}, {}]))
        expect(result.current.status).toBe('ready')
        expect(result.current.reviews.count).toBe(3)
    })

    it('does not persist a snapshot built from a failed fetch', async () => {
        // Snapshots drive the delta arrows. Writing 0 from a failure would
        // invent a drop the user never had.
        await load(async () => boom())
        expect(sessionStorage.getItem('your-work:reviews')).toBeNull()
    })
})
