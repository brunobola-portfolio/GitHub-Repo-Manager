import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// VITE_MOCK_MODE=false forces real fetch paths. The data hooks read
// import.meta.env.VITE_MOCK_MODE directly so Vite can tree-shake the
// dynamic mock import() out of prod, so stubEnv is the right toggle.
vi.stubEnv('VITE_MOCK_MODE', 'false');

global.fetch = vi.fn();

beforeEach(() => {
    global.fetch.mockReset();
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    // Reset SWR cache between tests so seed-from-cache doesn't leak
    // between them and change the observable loading/validating flags.
    clearCache();
});

afterEach(() => { vi.useRealTimers(); });

const { useMyPendingReviews, invalidateCached, clearCache } = await import('@/hooks/useWorkBoard');

describe('useWorkBoard — auto-refresh', () => {
    it('polls at the configured interval while page is visible', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        global.fetch.mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: [], meta: { fetchedAt: new Date().toISOString() } }) });

        renderHook(() => useMyPendingReviews({ refreshIntervalMs: 1000 }));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

        await act(async () => { await vi.advanceTimersByTimeAsync(1050); });
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    });

    it('pauses polling when document is hidden', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        global.fetch.mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: [], meta: {} }) });
        renderHook(() => useMyPendingReviews({ refreshIntervalMs: 1000 }));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

        Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));

        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('immediately re-fetches when page becomes visible after being hidden', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        global.fetch.mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: [], meta: {} }) });
        renderHook(() => useMyPendingReviews({ refreshIntervalMs: 10000 }));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

        Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(global.fetch).toHaveBeenCalledTimes(1);

        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    });

    it('exposes lastFetchedAt as a Date instance', async () => {
        global.fetch.mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: [], meta: { fetchedAt: '2026-04-21T10:00:00.000Z' } }) });
        const { result } = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        await waitFor(() => expect(result.current.lastFetchedAt).toBeInstanceOf(Date));
        expect(result.current.lastFetchedAt.toISOString()).toBe('2026-04-21T10:00:00.000Z');
    });

    it('exposes meta envelope when present', async () => {
        global.fetch.mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: [], meta: { source: 'live', fetchedAt: new Date().toISOString() } }) });
        const { result } = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        await waitFor(() => expect(result.current.meta?.source).toBe('live'));
    });

    it('refreshIntervalMs=0 disables polling (fetch only on mount)', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        global.fetch.mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: [], meta: {} }) });
        renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('manual refresh() triggers an immediate fetch', async () => {
        global.fetch.mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ data: [], meta: {} }) });
        const { result } = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        await act(async () => { await result.current.refresh(); });
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });
});

describe('useWorkBoard — stale-while-revalidate', () => {
    it('cold mount (no cache) starts with loading:true and settles to loading:false, validating:false', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            headers: { get: () => 'application/json' }, json: async () => ({ data: [{ prNumber: 1 }], meta: { fetchedAt: new Date().toISOString() } }),
        });
        const { result } = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        // Before the fetch resolves, loading should be true (cold start)
        expect(result.current.loading).toBe(true);
        expect(result.current.validating).toBe(false);
        expect(result.current.data).toBe(null);

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.validating).toBe(false);
        expect(result.current.data).toEqual([{ prNumber: 1 }]);
    });

    it('warm mount (cache hit) renders data instantly with loading:false and validating:true, then validating:false', async () => {
        // First mount to populate cache
        global.fetch.mockResolvedValue({
            ok: true,
            headers: { get: () => 'application/json' }, json: async () => ({ data: [{ prNumber: 42 }], meta: { fetchedAt: '2026-04-20T10:00:00.000Z' } }),
        });
        const first = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        await waitFor(() => expect(first.result.current.loading).toBe(false));
        first.unmount();

        // Second mount of the same URL — should seed from cache
        const { result } = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        // Immediately: data is visible from cache, loading is false, validating is true
        expect(result.current.loading).toBe(false);
        expect(result.current.validating).toBe(true);
        expect(result.current.data).toEqual([{ prNumber: 42 }]);

        await waitFor(() => expect(result.current.validating).toBe(false));
        expect(result.current.loading).toBe(false);
        expect(result.current.data).toEqual([{ prNumber: 42 }]);
    });

    it('refresh() keeps data visible and flips validating true->false (no skeleton flash)', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            headers: { get: () => 'application/json' }, json: async () => ({ data: [{ prNumber: 7 }], meta: { fetchedAt: new Date().toISOString() } }),
        });
        const { result } = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.data).toEqual([{ prNumber: 7 }]);

        let refreshPromise;
        await act(async () => {
            refreshPromise = result.current.refresh();
            // While in flight: data stays visible, validating is true, loading stays false
            expect(result.current.data).toEqual([{ prNumber: 7 }]);
            expect(result.current.loading).toBe(false);
            await refreshPromise;
        });

        expect(result.current.validating).toBe(false);
        expect(result.current.loading).toBe(false);
        expect(result.current.data).toEqual([{ prNumber: 7 }]);
    });

    it('error during background validation keeps cached data, sets error, validating:false', async () => {
        // First successful fetch populates data
        global.fetch.mockResolvedValueOnce({
            ok: true,
            headers: { get: () => 'application/json' }, json: async () => ({ data: [{ prNumber: 99 }], meta: { fetchedAt: new Date().toISOString() } }),
        });
        const { result } = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.data).toEqual([{ prNumber: 99 }]);

        // Second fetch (via refresh) fails
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            json: async () => ({ error: 'boom' }),
        });
        await act(async () => { await result.current.refresh(); });

        expect(result.current.data).toEqual([{ prNumber: 99 }]); // stale data preserved
        expect(result.current.error).toBeTruthy();
        expect(result.current.error.message).toContain('boom');
        expect(result.current.validating).toBe(false);
        expect(result.current.loading).toBe(false);
    });

    it('invalidateCached(url) clears the cache so next mount is cold again', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            headers: { get: () => 'application/json' }, json: async () => ({ data: [{ prNumber: 1 }], meta: { fetchedAt: new Date().toISOString() } }),
        });
        const first = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        await waitFor(() => expect(first.result.current.loading).toBe(false));
        first.unmount();

        // Warm mount sanity check: loading false, validating true
        const warm = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        expect(warm.result.current.loading).toBe(false);
        expect(warm.result.current.validating).toBe(true);
        await waitFor(() => expect(warm.result.current.validating).toBe(false));
        warm.unmount();

        // Now invalidate the URL the hook uses and mount again — should be cold
        invalidateCached('/api/v1/work-board/my-reviews');
        const cold = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        expect(cold.result.current.loading).toBe(true);
        expect(cold.result.current.data).toBe(null);
        await waitFor(() => expect(cold.result.current.loading).toBe(false));
    });
});
