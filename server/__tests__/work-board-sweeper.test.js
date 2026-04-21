// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const purgeCache = vi.fn(() => 3);
const purgeSnoozes = vi.fn(() => 2);
vi.mock('../lib/work-board-cache.js', () => ({
    purgeExpired: purgeCache,
    getCached: vi.fn(), putCached: vi.fn(), invalidate: vi.fn(),
}));
vi.mock('../lib/work-board-snooze.js', () => ({
    purgeExpiredSnoozes: purgeSnoozes,
    snooze: vi.fn(), unsnooze: vi.fn(), listSnoozes: vi.fn(),
    isSnoozed: vi.fn(), filterOutSnoozed: vi.fn(),
}));
vi.mock('../lib/logger.js', () => ({
    default: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { startWorkBoardSweeper, stopWorkBoardSweeper, runSweepOnce } = await import('../lib/work-board-sweeper.js');

describe('work-board-sweeper', () => {
    beforeEach(() => { purgeCache.mockClear(); purgeSnoozes.mockClear(); });
    afterEach(() => { stopWorkBoardSweeper(); });

    it('runSweepOnce calls both purge helpers and returns the counts', async () => {
        const result = await runSweepOnce();
        expect(purgeCache).toHaveBeenCalledOnce();
        expect(purgeSnoozes).toHaveBeenCalledOnce();
        expect(result).toEqual({ cacheDeleted: 3, snoozesDeleted: 2 });
    });

    it('startWorkBoardSweeper fires an initial sweep immediately', async () => {
        startWorkBoardSweeper({ intervalMs: 1_000_000 });
        // Give the fire-and-forget promise a tick to resolve
        await new Promise(r => setImmediate(r));
        expect(purgeCache).toHaveBeenCalledTimes(1);
    });

    it('startWorkBoardSweeper is idempotent (second call without stop is a no-op)', async () => {
        startWorkBoardSweeper({ intervalMs: 1_000_000 });
        startWorkBoardSweeper({ intervalMs: 1_000_000 });
        await new Promise(r => setImmediate(r));
        // Only one initial sweep, not two
        expect(purgeCache).toHaveBeenCalledTimes(1);
    });

    it('startWorkBoardSweeper schedules the interval and stop clears it', async () => {
        vi.useFakeTimers();
        try {
            startWorkBoardSweeper({ intervalMs: 1000 });
            // initial sweep fires asynchronously — flush microtasks
            await vi.advanceTimersByTimeAsync(3500);
            // initial (1) + 3 intervals = 4
            expect(purgeCache.mock.calls.length).toBeGreaterThanOrEqual(3);
            const countBeforeStop = purgeCache.mock.calls.length;
            stopWorkBoardSweeper();
            await vi.advanceTimersByTimeAsync(5000);
            expect(purgeCache.mock.calls.length).toBe(countBeforeStop);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not throw when purgeExpired throws (logs warn)', async () => {
        purgeCache.mockImplementationOnce(() => { throw new Error('boom'); });
        await expect(runSweepOnce()).resolves.toBeDefined();
    });
});
