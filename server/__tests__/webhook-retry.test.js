// @vitest-environment node
/**
 * Tests for the GitHub webhook dead-letter queue + retry worker.
 *
 * Verifies:
 *   1. When the handler throws, the webhook request still returns 200 (fast-ack
 *      stays intact) AND a row is inserted into webhook_events_dead_letter.
 *   2. A duplicate delivery_id does NOT throw — ON CONFLICT bumps `attempts`.
 *   3. runWebhookRetryOnce replays a due DLQ row; on success `resolved_at` is
 *      stamped.
 *   4. When the retry handler throws, `attempts` is incremented and
 *      `next_retry_at` is pushed forward.
 *   5. After 10 attempts, the worker stops retrying and logs loudly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// -----------------------------------------------------------------------------
// In-memory DB shared by the route SUT and the retry worker.
// -----------------------------------------------------------------------------
let memDb;

function createDeadLetterTable(database) {
    database.exec(`
        CREATE TABLE IF NOT EXISTS webhook_events_dead_letter (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            delivery_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            last_error TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            next_retry_at DATETIME,
            resolved_at DATETIME
        )
    `);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_dl_next_retry
                   ON webhook_events_dead_letter(next_retry_at)
                   WHERE resolved_at IS NULL`);
    database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_dl_delivery
                   ON webhook_events_dead_letter(delivery_id)`);
}

vi.mock('../db.js', () => {
    return {
        default: new Proxy({}, {
            get(_target, prop) {
                const val = memDb?.[prop];
                return typeof val === 'function' ? val.bind(memDb) : val;
            },
        }),
    };
});

vi.mock('../lib/logger.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        fatal: vi.fn(),
    },
}));

// Mock auth middleware used by the route.
const mockVerifyWebhookSignature = vi.fn(() => true);
const mockErrorResponse = vi.fn((res, status, message) => {
    res.statusCode = status;
    res.body = { error: message };
    return res;
});
vi.mock('../middleware/auth.js', () => ({
    verifyWebhookSignature: (...args) => mockVerifyWebhookSignature(...args),
    errorResponse: (...args) => mockErrorResponse(...args),
}));

// Mock the individual event handlers — we control success/failure per test.
const mockPullRequestHandle = vi.fn(() => Promise.resolve());
const mockPRReviewHandle = vi.fn(() => Promise.resolve());
const mockIssuesHandle = vi.fn(() => Promise.resolve());
const mockDeploymentHandle = vi.fn(() => Promise.resolve());

vi.mock('../lib/github-events/pull_request.js', () => ({
    handle: (...args) => mockPullRequestHandle(...args),
}));
vi.mock('../lib/github-events/pull_request_review.js', () => ({
    handle: (...args) => mockPRReviewHandle(...args),
}));
vi.mock('../lib/github-events/issues.js', () => ({
    handle: (...args) => mockIssuesHandle(...args),
}));
vi.mock('../lib/github-events/deployment_status.js', () => ({
    handle: (...args) => mockDeploymentHandle(...args),
}));

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function makeReqRes({ headers = {}, body = Buffer.from('{}') } = {}) {
    const req = { headers, body };
    const res = {
        statusCode: 200,
        body: null,
        headersSent: false,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; this.headersSent = true; return this; },
    };
    return { req, res };
}

function toSqliteDatetime(d) {
    return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------
describe('webhook retry + dead-letter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        memDb = new Database(':memory:');
        createDeadLetterTable(memDb);
        mockVerifyWebhookSignature.mockReturnValue(true);
        mockPullRequestHandle.mockResolvedValue(undefined);
        mockPRReviewHandle.mockResolvedValue(undefined);
        mockIssuesHandle.mockResolvedValue(undefined);
        mockDeploymentHandle.mockResolvedValue(undefined);
    });

    afterEach(() => {
        try { memDb?.close(); } catch { /* noop */ }
        memDb = null;
        vi.restoreAllMocks();
    });

    // -------------------------------------------------------------------------
    // 1. Handler throws → 200 is still returned AND a DLQ row appears.
    // -------------------------------------------------------------------------
    it('handler throws → webhook still 200 AND event stored in DLQ', async () => {
        mockPullRequestHandle.mockRejectedValue(new Error('SQLITE_BUSY: db is locked'));

        const payload = { action: 'opened', pull_request: { number: 7 } };
        const { req, res } = makeReqRes({
            headers: {
                'x-hub-signature-256': 'sha256=valid',
                'x-github-event': 'pull_request',
                'x-github-delivery': 'dlq-1',
            },
            body: Buffer.from(JSON.stringify(payload)),
        });

        const { githubEventsWebhookHandler } = await import('../routes/github-events-webhook.js');
        await expect(githubEventsWebhookHandler(req, res)).resolves.not.toThrow();

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ received: true, eventType: 'pull_request' });

        const row = memDb
            .prepare('SELECT * FROM webhook_events_dead_letter WHERE delivery_id = ?')
            .get('dlq-1');

        expect(row).toBeDefined();
        expect(row.event_type).toBe('pull_request');
        expect(row.attempts).toBe(1);
        expect(row.last_error).toMatch(/SQLITE_BUSY/);
        expect(row.resolved_at).toBeNull();
        expect(row.next_retry_at).toBeTruthy();
        expect(JSON.parse(row.payload)).toEqual(payload);
    });

    // -------------------------------------------------------------------------
    // 2. Duplicate delivery_id — ON CONFLICT handles it, no throw.
    // -------------------------------------------------------------------------
    it('duplicate delivery_id does not throw — ON CONFLICT increments attempts', async () => {
        mockIssuesHandle.mockRejectedValue(new Error('transient network error'));

        const payload = { action: 'opened', issue: { number: 3 } };
        const body = Buffer.from(JSON.stringify(payload));
        const headers = {
            'x-hub-signature-256': 'sha256=valid',
            'x-github-event': 'issues',
            'x-github-delivery': 'dlq-dup',
        };

        const { githubEventsWebhookHandler } = await import('../routes/github-events-webhook.js');

        // First dispatch — inserts the row.
        const r1 = makeReqRes({ headers, body });
        await githubEventsWebhookHandler(r1.req, r1.res);
        expect(r1.res.statusCode).toBe(200);

        // Second dispatch with the SAME delivery_id — must not throw.
        mockIssuesHandle.mockRejectedValue(new Error('still broken'));
        const r2 = makeReqRes({ headers, body });
        await expect(githubEventsWebhookHandler(r2.req, r2.res)).resolves.not.toThrow();
        expect(r2.res.statusCode).toBe(200);

        const rows = memDb
            .prepare('SELECT * FROM webhook_events_dead_letter WHERE delivery_id = ?')
            .all('dlq-dup');

        expect(rows).toHaveLength(1);
        expect(rows[0].attempts).toBe(2);
        expect(rows[0].last_error).toBe('still broken');
    });

    // -------------------------------------------------------------------------
    // 3. runWebhookRetryOnce — replays a due row, stamps resolved_at on success.
    // -------------------------------------------------------------------------
    it('runWebhookRetryOnce replays a due DLQ row and stamps resolved_at on success', async () => {
        // Seed: one row due for retry, one not yet due.
        const pastIso = toSqliteDatetime(new Date(Date.now() - 60 * 1000));
        const futureIso = toSqliteDatetime(new Date(Date.now() + 24 * 60 * 60 * 1000));

        memDb.prepare(`
            INSERT INTO webhook_events_dead_letter
                (delivery_id, event_type, payload, last_error, attempts, next_retry_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run('due-1', 'pull_request', JSON.stringify({ action: 'opened' }), 'timeout', 1, pastIso);

        memDb.prepare(`
            INSERT INTO webhook_events_dead_letter
                (delivery_id, event_type, payload, last_error, attempts, next_retry_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run('later-1', 'issues', JSON.stringify({ action: 'opened' }), 'timeout', 1, futureIso);

        mockPullRequestHandle.mockResolvedValue(undefined);

        const { runWebhookRetryOnce } = await import('../lib/webhook-retry-worker.js');
        const summary = await runWebhookRetryOnce();

        expect(summary.picked).toBe(1);
        expect(summary.resolved).toBe(1);
        expect(mockPullRequestHandle).toHaveBeenCalledTimes(1);
        expect(mockPullRequestHandle).toHaveBeenCalledWith({ action: 'opened' }, 'due-1');

        const due = memDb
            .prepare('SELECT * FROM webhook_events_dead_letter WHERE delivery_id = ?')
            .get('due-1');
        expect(due.resolved_at).toBeTruthy();

        const later = memDb
            .prepare('SELECT * FROM webhook_events_dead_letter WHERE delivery_id = ?')
            .get('later-1');
        expect(later.resolved_at).toBeNull();
    });

    // -------------------------------------------------------------------------
    // 4. Retry handler throws → attempts++, next_retry_at pushed forward.
    // -------------------------------------------------------------------------
    it('retry handler throws → attempts increments and next_retry_at is pushed out', async () => {
        const pastIso = toSqliteDatetime(new Date(Date.now() - 60 * 1000));

        memDb.prepare(`
            INSERT INTO webhook_events_dead_letter
                (delivery_id, event_type, payload, last_error, attempts, next_retry_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run('fail-1', 'pull_request', JSON.stringify({ action: 'opened' }), 'initial', 1, pastIso);

        mockPullRequestHandle.mockRejectedValue(new Error('still failing'));

        const nowBefore = Date.now();
        const { runWebhookRetryOnce } = await import('../lib/webhook-retry-worker.js');
        const summary = await runWebhookRetryOnce();

        expect(summary.picked).toBe(1);
        expect(summary.stillPending).toBe(1);
        expect(summary.resolved).toBe(0);
        expect(summary.givenUp).toBe(0);

        const row = memDb
            .prepare('SELECT * FROM webhook_events_dead_letter WHERE delivery_id = ?')
            .get('fail-1');

        expect(row.attempts).toBe(2);
        expect(row.last_error).toBe('still failing');
        expect(row.resolved_at).toBeNull();

        // next_retry_at must be in the future (past the original pastIso).
        expect(row.next_retry_at).toBeTruthy();
        const nextRetryMs = Date.parse(row.next_retry_at.replace(' ', 'T') + 'Z');
        expect(nextRetryMs).toBeGreaterThan(nowBefore);
    });

    // -------------------------------------------------------------------------
    // 5. After 10 attempts, worker gives up + logs loudly.
    // -------------------------------------------------------------------------
    it('after 10 attempts, worker gives up; row stays unresolved with next_retry_at NULL', async () => {
        const pastIso = toSqliteDatetime(new Date(Date.now() - 60 * 1000));

        // One row at attempts=10 (already exhausted) — must not be picked.
        memDb.prepare(`
            INSERT INTO webhook_events_dead_letter
                (delivery_id, event_type, payload, last_error, attempts, next_retry_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run('dead-1', 'pull_request', JSON.stringify({ action: 'opened' }), 'exhausted', 10, pastIso);

        // One row at attempts=9 — this one gets picked and pushed to 10 = given up.
        memDb.prepare(`
            INSERT INTO webhook_events_dead_letter
                (delivery_id, event_type, payload, last_error, attempts, next_retry_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run('almost-1', 'pull_request', JSON.stringify({ action: 'opened' }), 'fail', 9, pastIso);

        mockPullRequestHandle.mockRejectedValue(new Error('unfixable'));

        const logger = (await import('../lib/logger.js')).default;

        const { runWebhookRetryOnce } = await import('../lib/webhook-retry-worker.js');
        const summary = await runWebhookRetryOnce();

        // Only almost-1 is picked (dead-1 already at MAX_ATTEMPTS).
        expect(summary.picked).toBe(1);
        expect(mockPullRequestHandle).toHaveBeenCalledTimes(1);
        expect(summary.givenUp).toBe(1);
        expect(summary.resolved).toBe(0);
        expect(summary.stillPending).toBe(0);

        const dead = memDb
            .prepare('SELECT * FROM webhook_events_dead_letter WHERE delivery_id = ?')
            .get('dead-1');
        expect(dead.attempts).toBe(10);
        expect(dead.resolved_at).toBeNull();

        const almost = memDb
            .prepare('SELECT * FROM webhook_events_dead_letter WHERE delivery_id = ?')
            .get('almost-1');
        expect(almost.attempts).toBe(10);
        expect(almost.resolved_at).toBeNull();
        expect(almost.next_retry_at).toBeNull();

        // Worker logged loudly at error level with the "giving up" message.
        const loudCalls = logger.error.mock.calls.filter(
            args => typeof args[1] === 'string' && args[1].includes('giving up after 10 attempts'),
        );
        expect(loudCalls.length).toBeGreaterThanOrEqual(1);

        // Second pass = no-op (both rows now exhausted).
        const second = await runWebhookRetryOnce();
        expect(second.picked).toBe(0);
        expect(mockPullRequestHandle).toHaveBeenCalledTimes(1);
    });
});
