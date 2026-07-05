// @vitest-environment node
/**
 * Proves the data-lifecycle janitors are wired: retention pass + gh_cache /
 * gh_outbox / undo-log purges run on a schedule (not just via manual CLI), the
 * timers are unref()'d, start is idempotent, stop clears them, and one failing
 * step never blocks the others.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

const runRetentionPass = vi.fn(async () => ({ checked: 0, warned: 0, purged: 0, skipped: 0 }));
const purgeGhCache = vi.fn(() => 5);
const purgeGhOutbox = vi.fn(() => 3);
const cleanupUndoLog = vi.fn(() => 2);
const runDbBackupOnce = vi.fn(async () => ({ skipped: false, destPath: '/tmp/manager-x.db', pruned: 0 }));

// A real in-memory SQLite handle stands in for the app db: exercises the actual
// event-purge SQL, and keeps runDailyMaintenanceOnce's purge step harmless.
const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE pr_events (id INTEGER PRIMARY KEY, created_at DATETIME);
    CREATE TABLE issue_events (id INTEGER PRIMARY KEY, created_at DATETIME);
    CREATE TABLE deployment_events (id INTEGER PRIMARY KEY, created_at DATETIME);
    CREATE TABLE review_assignments (id INTEGER PRIMARY KEY, requested_at DATETIME);
    CREATE TABLE workflow_runs (id INTEGER PRIMARY KEY, created_at DATETIME);
`);

vi.mock('../lib/retention.js', () => ({ runRetentionPass }));
vi.mock('../lib/gh-cache.js', () => ({ purgeOlderThan: purgeGhCache }));
vi.mock('../lib/gh-outbox.js', () => ({ purgeOldSucceeded: purgeGhOutbox }));
vi.mock('../lib/work-board-undo-log.js', () => ({ cleanupExpired: cleanupUndoLog }));
vi.mock('../lib/db-backup.js', () => ({ runDbBackupOnce }));
vi.mock('../db.js', () => ({ default: testDb }));
vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
    startMaintenanceJanitors,
    stopMaintenanceJanitors,
    runDailyMaintenanceOnce,
    runHourlyMaintenanceOnce,
    purgeOldEvents,
} = await import('../lib/maintenance-janitors.js');

function clearEventTables() {
    for (const t of ['pr_events', 'issue_events', 'deployment_events', 'review_assignments', 'workflow_runs']) {
        testDb.exec(`DELETE FROM ${t}`);
    }
}

describe('maintenance-janitors', () => {
    beforeEach(() => {
        runRetentionPass.mockClear();
        purgeGhCache.mockClear();
        purgeGhOutbox.mockClear();
        cleanupUndoLog.mockClear();
        runDbBackupOnce.mockClear();
        clearEventTables();
        delete process.env.EVENT_RETENTION_DAYS;
    });
    afterEach(() => { stopMaintenanceJanitors(); });

    it('runDailyMaintenanceOnce runs the retention pass, gh_cache purge, event purge and backup', async () => {
        const summary = await runDailyMaintenanceOnce();
        expect(runRetentionPass).toHaveBeenCalledOnce();
        expect(purgeGhCache).toHaveBeenCalledOnce();
        expect(runDbBackupOnce).toHaveBeenCalledOnce();
        expect(summary.ghCachePurged).toBe(5);
        expect(summary.eventsPurged).toMatchObject({ skipped: false });
        expect(summary.backup).toMatchObject({ skipped: false });
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

describe('purgeOldEvents', () => {
    beforeEach(() => {
        clearEventTables();
        delete process.env.EVENT_RETENTION_DAYS;
    });

    // Insert one old row (well past the window) and one fresh row into each table.
    function seedOldAndNew() {
        for (const { table, col } of [
            { table: 'pr_events', col: 'created_at' },
            { table: 'issue_events', col: 'created_at' },
            { table: 'deployment_events', col: 'created_at' },
            { table: 'review_assignments', col: 'requested_at' },
            { table: 'workflow_runs', col: 'created_at' },
        ]) {
            testDb.prepare(`INSERT INTO ${table} (${col}) VALUES (datetime('now', '-400 days'))`).run();
            testDb.prepare(`INSERT INTO ${table} (${col}) VALUES (datetime('now', '-10 days'))`).run();
        }
    }

    const count = (t) => testDb.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

    it('deletes rows older than the retention window and keeps recent rows', () => {
        seedOldAndNew();
        const result = purgeOldEvents({ database: testDb, retentionDays: 365 });

        expect(result.skipped).toBe(false);
        expect(result.retentionDays).toBe(365);
        for (const t of ['pr_events', 'issue_events', 'deployment_events', 'review_assignments', 'workflow_runs']) {
            expect(count(t)).toBe(1);              // only the recent row survives
            expect(result.perTable[t]).toBe(1);    // exactly one old row purged
        }
    });

    it('honors the per-table timestamp column (requested_at for review_assignments)', () => {
        testDb.prepare(`INSERT INTO review_assignments (requested_at) VALUES (datetime('now', '-500 days'))`).run();
        testDb.prepare(`INSERT INTO review_assignments (requested_at) VALUES (datetime('now', '-1 days'))`).run();
        const result = purgeOldEvents({ database: testDb, retentionDays: 90 });
        expect(result.perTable.review_assignments).toBe(1);
        expect(count('review_assignments')).toBe(1);
    });

    it('is disabled (skipped, no deletes) when retentionDays is 0', () => {
        seedOldAndNew();
        const result = purgeOldEvents({ database: testDb, retentionDays: 0 });
        expect(result.skipped).toBe(true);
        expect(count('pr_events')).toBe(2); // nothing deleted
    });

    it('reads EVENT_RETENTION_DAYS from the environment', () => {
        seedOldAndNew();
        process.env.EVENT_RETENTION_DAYS = '365';
        const result = purgeOldEvents({ database: testDb });
        expect(result.retentionDays).toBe(365);
        expect(count('pr_events')).toBe(1);
    });

    it('treats an empty EVENT_RETENTION_DAYS as disabled (0/empty disables)', () => {
        seedOldAndNew();
        process.env.EVENT_RETENTION_DAYS = '';
        const result = purgeOldEvents({ database: testDb });
        // Empty string → parseInt NaN → non-finite → disabled (no deletes).
        expect(result.skipped).toBe(true);
        expect(count('pr_events')).toBe(2);
    });

    it('batches deletes across multiple statements (batchSize smaller than backlog)', () => {
        for (let i = 0; i < 12; i++) {
            testDb.prepare(`INSERT INTO pr_events (created_at) VALUES (datetime('now', '-400 days'))`).run();
        }
        const result = purgeOldEvents({ database: testDb, retentionDays: 365, batchSize: 5 });
        expect(result.perTable.pr_events).toBe(12); // all purged across batches
        expect(count('pr_events')).toBe(0);
    });
});
