import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    enqueueMutation,
    replayQueue,
    onRetryQueueEvent,
    MAX_QUEUE_SIZE,
    MAX_AGE_MS,
    _getQueueLengthForTests,
    _resetQueueForTests,
    _peekQueueForTests,
} from '@/utils/retry-queue'

describe('retry-queue', () => {
    beforeEach(() => {
        _resetQueueForTests()
    })

    it('appends a request to the queue and emits an enqueued event', async () => {
        const events = []
        const unsub = onRetryQueueEvent((e) => events.push(e))

        // enqueue returns a pending promise — don't await it yet.
        const p = enqueueMutation({ url: '/api/x', options: { method: 'POST' } })
        // Attach a no-op rejection handler so an eventual expiry doesn't
        // surface as an unhandled rejection in later tests.
        p.catch(() => {})

        expect(_getQueueLengthForTests()).toBe(1)
        expect(events).toHaveLength(1)
        expect(events[0].type).toBe('enqueued')
        expect(events[0].entry.url).toBe('/api/x')

        unsub()
    })

    it('replays queued entries on replayQueue() and resolves their promises', async () => {
        const responseA = { ok: true, status: 200, marker: 'A' }
        const responseB = { ok: true, status: 200, marker: 'B' }
        const fetchFn = vi.fn()
            .mockResolvedValueOnce(responseA)
            .mockResolvedValueOnce(responseB)

        const pA = enqueueMutation({ url: '/api/a', options: { method: 'POST' } })
        const pB = enqueueMutation({ url: '/api/b', options: { method: 'PUT' } })

        expect(_getQueueLengthForTests()).toBe(2)

        const result = await replayQueue({
            fetchFn,
            isNetworkError: () => false,
        })

        expect(result.replayed).toBe(2)
        expect(result.failed).toBe(0)
        expect(_getQueueLengthForTests()).toBe(0)

        await expect(pA).resolves.toBe(responseA)
        await expect(pB).resolves.toBe(responseB)
        expect(fetchFn).toHaveBeenCalledTimes(2)
    })

    it('re-queues entries when replay fails with a network error (up to 3 rounds)', async () => {
        const networkErr = new Error('network down')
        const fetchFn = vi.fn().mockRejectedValue(networkErr)

        const p = enqueueMutation({ url: '/api/a', options: { method: 'POST' } })
        // Prevent unhandled-rejection noise on the test runner — we
        // assert the rejection explicitly below.
        p.catch(() => {})

        // Round 1 — failure, re-queued
        await replayQueue({ fetchFn, isNetworkError: () => true })
        expect(_getQueueLengthForTests()).toBe(1)

        // Round 2 — failure, re-queued
        await replayQueue({ fetchFn, isNetworkError: () => true })
        expect(_getQueueLengthForTests()).toBe(1)

        // Round 3 — final failure, entry is rejected & removed
        await replayQueue({ fetchFn, isNetworkError: () => true })
        expect(_getQueueLengthForTests()).toBe(0)

        await expect(p).rejects.toBe(networkErr)
        expect(fetchFn).toHaveBeenCalledTimes(3)
    })

    it('rejects immediately with a non-network error on replay', async () => {
        const httpErr = new Error('403 forbidden')
        const fetchFn = vi.fn().mockRejectedValue(httpErr)

        const p = enqueueMutation({ url: '/api/a', options: { method: 'POST' } })
        p.catch(() => {})

        await replayQueue({ fetchFn, isNetworkError: () => false })

        expect(_getQueueLengthForTests()).toBe(0)
        await expect(p).rejects.toBe(httpErr)
        expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    it('caps the queue at MAX_QUEUE_SIZE and rejects overflow', async () => {
        const promises = []
        for (let i = 0; i < MAX_QUEUE_SIZE; i++) {
            const p = enqueueMutation({ url: `/api/${i}`, options: { method: 'POST' } })
            p.catch(() => {})
            promises.push(p)
        }
        expect(_getQueueLengthForTests()).toBe(MAX_QUEUE_SIZE)

        // Next enqueue must reject synchronously-ish (before network fires).
        const overflow = enqueueMutation({ url: '/api/overflow', options: { method: 'POST' } })
        await expect(overflow).rejects.toThrow(/full/i)

        // Queue size unchanged.
        expect(_getQueueLengthForTests()).toBe(MAX_QUEUE_SIZE)
    })

    it('expires entries older than MAX_AGE_MS', async () => {
        vi.useFakeTimers()
        try {
            const start = Date.now()
            vi.setSystemTime(start)

            const stale = enqueueMutation({ url: '/api/stale', options: { method: 'POST' } })
            stale.catch(() => {})
            expect(_getQueueLengthForTests()).toBe(1)

            // Fast-forward past the expiry window.
            vi.setSystemTime(start + MAX_AGE_MS + 1000)

            // Any queue operation prunes. enqueueMutation calls pruneExpired.
            const fresh = enqueueMutation({ url: '/api/fresh', options: { method: 'POST' } })
            fresh.catch(() => {})

            // Stale entry should have been dropped, only fresh remains.
            expect(_getQueueLengthForTests()).toBe(1)
            expect(_peekQueueForTests()[0].url).toBe('/api/fresh')

            await expect(stale).rejects.toThrow(/expired/i)
        } finally {
            vi.useRealTimers()
        }
    })
})
