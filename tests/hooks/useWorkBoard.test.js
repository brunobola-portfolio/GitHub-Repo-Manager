import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/config', () => ({ MOCK_MODE: false, API_BASE_URL: '' }));

global.fetch = vi.fn();

beforeEach(() => {
    global.fetch.mockReset();
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
});

afterEach(() => { vi.useRealTimers(); });

const { useMyPendingReviews } = await import('@/hooks/useWorkBoard');

describe('useWorkBoard — auto-refresh', () => {
    it('polls at the configured interval while page is visible', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [], meta: { fetchedAt: new Date().toISOString() } }) });

        const { result } = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 1000 }));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

        await act(async () => { await vi.advanceTimersByTimeAsync(1050); });
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    });

    it('pauses polling when document is hidden', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [], meta: {} }) });
        renderHook(() => useMyPendingReviews({ refreshIntervalMs: 1000 }));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

        Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));

        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('immediately re-fetches when page becomes visible after being hidden', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [], meta: {} }) });
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
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [], meta: { fetchedAt: '2026-04-21T10:00:00.000Z' } }) });
        const { result } = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        await waitFor(() => expect(result.current.lastFetchedAt).toBeInstanceOf(Date));
        expect(result.current.lastFetchedAt.toISOString()).toBe('2026-04-21T10:00:00.000Z');
    });

    it('exposes meta envelope when present', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [], meta: { source: 'live', fetchedAt: new Date().toISOString() } }) });
        const { result } = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        await waitFor(() => expect(result.current.meta?.source).toBe('live'));
    });

    it('refreshIntervalMs=0 disables polling (fetch only on mount)', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [], meta: {} }) });
        renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('manual refresh() triggers an immediate fetch', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [], meta: {} }) });
        const { result } = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        await act(async () => { await result.current.refresh(); });
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });
});
