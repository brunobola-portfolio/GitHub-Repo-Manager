// @vitest-environment node
/**
 * Proves the data-lifecycle janitors are wired: retention pass + gh_cache /
 * gh_outbox / undo-log purges run on a schedule (not just via manual CLI), the
 * timers are unref()'d, start is idempotent, stop clears them, and one failing
 * step never blocks the others.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const runRetentionPass = vi.fn(async () => ({ checked: 0, warned: 0, purged: 0, skipped: 0 }));
const purgeGhCache = vi.fn(() => 5);
const purgeGhOutbox = vi.fn(() => 3);
const cleanupUndoLog = vi.fn(() => 2);

vi.mock('../lib/retention.js', () => ({ runRetentionPass }));
vi.mock('../lib/gh-cache.js', () => ({ purgeOlderThan: purgeGhCache }));
vi.mock('../lib/gh-outbox.js', () => ({ purgeOldSucceeded: purgeGhOutbox }));
vi.mock('../lib/work-board-undo-log.js', () => ({ cleanupExpired: cleanupUndoLog }));
vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
    startMaintenanceJanitors,
    stopMaintenanceJanitors,
    runDailyMaintenanceOnce,
    runHourlyMaintenanceOnce,
} = await import('../lib/maintenance-janitors.js');

describe('maintenance-janitors', () => {
    beforeEach(() => {
        runRetentionPass.mockClear();
        purgeGhCache.mockClear();
        purgeGhOutbox.mockClear();
        cleanupUndoLog.mockClear();
    });
    afterEach(() => { stopMaintenanceJanitors(); });

    it('runDailyMaintenanceOnce runs the retention pass and gh_cache purge', async () => {
        const summary = await runDailyMaintenanceOnce();
        expect(runRetentionPass).toHaveBeenCalledOnce();
        expect(purgeGhCache).toHaveBeenCalledOnce();
        expect(summary.ghCachePurged).toBe(5);
    });

    it('runHourlyMaintenanceOnce purges gh_outbox and the undo-log', () => {
        const summary = runHourlyMaintenanceOnce();
        expect(purgeGhOutbox).toHaveBeenCalledOnce();
        expect(cleanupUndoLog).toHaveBeenCalledOnce();
        expect(summary).toEqual({ ghOutboxPurged: 3, undoLogPurged: 2 });
    });

    it('startMaintenanceJanitors fires both initial passes immediately', async () => {
        startMaintenanceJanitors({ dailyIntervalMs: 1_000_000, hourlyIntervalMs: 1_000_000 });
        await new Promise((r) => setImmediate(r));
        expect(runRetentionPass).toHaveBeenCalledTimes(1);
        expect(purgeGhOutbox).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — a second start without stop is a no-op', async () => {
        startMaintenanceJanitors({ dailyIntervalMs: 1_000_000, hourlyIntervalMs: 1_000_000 });
        startMaintenanceJanitors({ dailyIntervalMs: 1_000_000, hourlyIntervalMs: 1_000_000 });
        await new Promise((r) => setImmediate(r));
        expect(runRetentionPass).toHaveBeenCalledTimes(1);
    });

    it('schedules the intervals and stop clears them', async () => {
        vi.useFakeTimers();
        try {
            startMaintenanceJanitors({ dailyIntervalMs: 1000, hourlyIntervalMs: 1000 });
            await vi.advanceTimersByTimeAsync(3500);
            expect(purgeGhOutbox.mock.calls.length).toBeGreaterThanOrEqual(3);
            const countBeforeStop = purgeGhOutbox.mock.calls.length;
            stopMaintenanceJanitors();
            await vi.advanceTimersByTimeAsync(5000);
            expect(purgeGhOutbox.mock.calls.length).toBe(countBeforeStop);
        } finally {
            vi.useRealTimers();
        }
    });

    it('unref()s both timers so they never keep the process alive', () => {
        const unrefs = [];
        const realSetInterval = globalThis.setInterval;
        vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, ms) => {
            const t = realSetInterval(fn, ms);
            const originalUnref = t.unref?.bind(t);
            const spy = vi.fn(() => originalUnref?.());
            t.unref = spy;
            unrefs.push(spy);
            return t;
        });
        try {
            startMaintenanceJanitors({ dailyIntervalMs: 1_000_000, hourlyIntervalMs: 1_000_000 });
            expect(unrefs.length).toBe(2);
            expect(unrefs.every((s) => s.mock.calls.length === 1)).toBe(true);
        } finally {
            globalThis.setInterval.mockRestore();
            stopMaintenanceJanitors();
        }
    });

    it('a failing retention pass does not block the gh_cache purge', async () => {
        runRetentionPass.mockRejectedValueOnce(new Error('boom'));
        const summary = await runDailyMaintenanceOnce();
        expect(purgeGhCache).toHaveBeenCalledOnce();
        expect(summary.ghCachePurged).toBe(5);
    });

    it('the overlap guard skips a re-entrant daily pass', async () => {
        let release;
        runRetentionPass.mockImplementationOnce(() => new Promise((r) => { release = r; }));
        const first = runDailyMaintenanceOnce();
        const second = await runDailyMaintenanceOnce(); // should short-circuit
        expect(second.skipped).toBe(true);
        release({ checked: 0 });
        await first;
    });
});
