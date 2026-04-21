import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { useRelativeTime } = await import('@/hooks/useRelativeTime');

afterEach(() => { vi.useRealTimers(); });

describe('useRelativeTime', () => {
    it('returns empty string for null', () => {
        const { result } = renderHook(() => useRelativeTime(null));
        expect(result.current).toBe('');
    });

    it('returns "just now" for < 15 s', () => {
        const { result } = renderHook(() => useRelativeTime(new Date()));
        expect(result.current).toMatch(/just now/i);
    });

    it('returns "Ns ago" for 30 s', () => {
        const d = new Date(Date.now() - 30_000);
        const { result } = renderHook(() => useRelativeTime(d));
        expect(result.current).toMatch(/30 s ago/);
    });

    it('returns "Nmin ago" for 5 min', () => {
        const d = new Date(Date.now() - 5 * 60_000);
        const { result } = renderHook(() => useRelativeTime(d));
        expect(result.current).toMatch(/5 min ago/);
    });

    it('returns "Nh ago" for 3 h', () => {
        const d = new Date(Date.now() - 3 * 3_600_000);
        const { result } = renderHook(() => useRelativeTime(d));
        expect(result.current).toMatch(/3 h ago/);
    });

    it('returns "Nd ago" for 2 days', () => {
        const d = new Date(Date.now() - 2 * 24 * 3_600_000);
        const { result } = renderHook(() => useRelativeTime(d));
        expect(result.current).toMatch(/2 d ago/);
    });

    it('re-renders after ~15 s (uses interval)', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const d = new Date(Date.now() - 10_000);
        const { result } = renderHook(() => useRelativeTime(d));
        const first = result.current;
        await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
        expect(result.current).not.toBe(first);
    });
});
