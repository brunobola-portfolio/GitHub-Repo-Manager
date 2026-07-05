import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { useRelativeTime } = await import('@/hooks/useRelativeTime');

afterEach(() => { vi.useRealTimers(); });

// useRelativeTime is a thin ticking wrapper around formatRelativeTime, so it
// emits the single canonical vocabulary ('30s ago' / '5m ago' / '3h ago' /
// '2d ago' / '3mo ago') — no spaced 'h'/'min' dialect and no cap at days.
describe('useRelativeTime', () => {
    it('returns empty string for null', () => {
        const { result } = renderHook(() => useRelativeTime(null));
        expect(result.current).toBe('');
    });

    it("returns 'just now' for a future date", () => {
        const { result } = renderHook(() => useRelativeTime(new Date(Date.now() + 5_000)));
        expect(result.current).toBe('just now');
    });

    it("returns 'Ns ago' for 30 s", () => {
        const d = new Date(Date.now() - 30_000);
        const { result } = renderHook(() => useRelativeTime(d));
        expect(result.current).toBe('30s ago');
    });

    it("returns 'Nm ago' for 5 min", () => {
        const d = new Date(Date.now() - 5 * 60_000);
        const { result } = renderHook(() => useRelativeTime(d));
        expect(result.current).toBe('5m ago');
    });

    it("returns 'Nh ago' for 3 h", () => {
        const d = new Date(Date.now() - 3 * 3_600_000);
        const { result } = renderHook(() => useRelativeTime(d));
        expect(result.current).toBe('3h ago');
    });

    it("returns 'Nd ago' for 2 days", () => {
        const d = new Date(Date.now() - 2 * 24 * 3_600_000);
        const { result } = renderHook(() => useRelativeTime(d));
        expect(result.current).toBe('2d ago');
    });

    it("rolls past days into months (no longer caps at days)", () => {
        const d = new Date(Date.now() - 90 * 24 * 3_600_000);
        const { result } = renderHook(() => useRelativeTime(d));
        expect(result.current).toBe('3mo ago');
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
