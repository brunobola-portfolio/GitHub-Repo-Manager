// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- DB mock (factory approach — avoids vi.mock hoisting issues) -----------
vi.mock('../../db.js', () => {
    const mockRun = vi.fn(() => ({ changes: 1 }));
    const mockPrepare = vi.fn(() => ({ run: mockRun }));
    return {
        default: { prepare: mockPrepare },
        __mockPrepare: mockPrepare,
        __mockRun: mockRun,
    };
});

vi.mock('../../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { default as _db, __mockPrepare as mockPrepare, __mockRun as mockRun } from '../../db.js';
import { handle } from '../../lib/github-events/pull_request.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makePayload(overrides = {}) {
    return {
        action: 'opened',
        pull_request: {
            number: 42,
            title: 'feat: new thing',
            user: { login: 'alice' },
            base: { ref: 'main' },
            head: { ref: 'feat/new-thing' },
            merged: false,
            assignees: [],
            requested_reviewers: [],
        },
        repository: { id: 101, full_name: 'org/repo' },
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('pull_request handler', () => {
    beforeEach(() => {
        mockPrepare.mockClear();
        mockRun.mockClear();
        mockRun.mockReturnValue({ changes: 1 });
        mockPrepare.mockReturnValue({ run: mockRun });
    });

    it('opened → inserts one pr_events row with correct fields', async () => {
        let capturedArgs = [];
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('INSERT OR IGNORE INTO pr_events')) {
                return { run: vi.fn((...args) => { capturedArgs = args; return { changes: 1 }; }) };
            }
            return { run: mockRun };
        });

        await handle(makePayload(), 'delivery-1');

        const sqls = mockPrepare.mock.calls.map((c) => c[0]);
        const prEventsInsert = sqls.find((s) => s.includes('INSERT OR IGNORE INTO pr_events'));
        expect(prEventsInsert).toBeDefined();

        expect(capturedArgs[0]).toBe('delivery-1'); // eventId
        expect(capturedArgs[1]).toBe(101);           // repo_id
        expect(capturedArgs[2]).toBe('org/repo');    // repo_full_name
        expect(capturedArgs[3]).toBe(42);            // pr_number
        expect(capturedArgs[4]).toBe('opened');      // action
        expect(capturedArgs[5]).toBe('alice');       // author_login
    });

    it('review_requested → inserts pr_events AND upserts review_assignments', async () => {
        const payload = makePayload({
            action: 'review_requested',
            requested_reviewer: { login: 'bob' },
            pull_request: {
                number: 42,
                title: 'feat: new thing',
                user: { login: 'alice' },
                base: { ref: 'main' },
                head: { ref: 'feat/new-thing' },
                merged: false,
                assignees: [],
                requested_reviewers: [{ login: 'bob' }],
            },
        });

        await handle(payload, 'delivery-2');

        const sqls = mockPrepare.mock.calls.map((c) => c[0]);
        expect(sqls.some((s) => s.includes('INSERT OR IGNORE INTO pr_events'))).toBe(true);
        expect(sqls.some((s) => s.includes('INSERT INTO review_assignments'))).toBe(true);
    });

    it('review_requested → review_assignments row has state=pending (via upsert)', async () => {
        let capturedSql = '';
        let capturedArgs = [];
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('INSERT INTO review_assignments')) {
                capturedSql = sql;
                return { run: vi.fn((...args) => { capturedArgs = args; return { changes: 1 }; }) };
            }
            return { run: mockRun };
        });

        const payload = makePayload({
            action: 'review_requested',
            requested_reviewer: { login: 'carol' },
            pull_request: {
                number: 7,
                title: 'fix: bug',
                user: { login: 'alice' },
                base: { ref: 'main' },
                head: { ref: 'fix/bug' },
                merged: false,
                assignees: [],
                requested_reviewers: [{ login: 'carol' }],
            },
        });

        await handle(payload, 'delivery-3');

        expect(capturedSql).toMatch(/INSERT INTO review_assignments/);
        expect(capturedArgs[3]).toBe('carol');
    });

    it('review_request_removed → updates review_assignments to dismissed', async () => {
        let capturedSql = '';
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('UPDATE review_assignments')) capturedSql = sql;
            return { run: mockRun };
        });

        const payload = makePayload({
            action: 'review_request_removed',
            requested_reviewer: { login: 'dave' },
        });

        await handle(payload, 'delivery-4');

        expect(capturedSql).toMatch(/UPDATE review_assignments/);
        expect(capturedSql).toMatch(/dismissed/);
    });

    it('closed with merged=true → pr_events has merged=1', async () => {
        let capturedArgs = [];
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('INSERT OR IGNORE INTO pr_events')) {
                return { run: vi.fn((...args) => { capturedArgs = args; return { changes: 1 }; }) };
            }
            return { run: mockRun };
        });

        const payload = makePayload({
            action: 'closed',
            pull_request: {
                number: 42,
                title: 'feat: done',
                user: { login: 'alice' },
                base: { ref: 'main' },
                head: { ref: 'feat/done' },
                merged: true,
                assignees: [],
                requested_reviewers: [],
            },
        });

        await handle(payload, 'delivery-5');

        // merged is at index 9 in the run call
        expect(capturedArgs[9]).toBe(1);
    });

    it('closed → all pending review_assignments transition to pr_closed', async () => {
        let closeSql = '';
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('UPDATE review_assignments') && sql.includes('pr_closed')) {
                closeSql = sql;
            }
            return { run: mockRun };
        });

        await handle(makePayload({ action: 'closed' }), 'delivery-6');

        expect(closeSql).toMatch(/pr_closed/);
    });

    it('assigned → pr_events with serialised assignee_logins JSON array', async () => {
        let capturedArgs = [];
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('INSERT OR IGNORE INTO pr_events')) {
                return { run: vi.fn((...args) => { capturedArgs = args; return { changes: 1 }; }) };
            }
            return { run: mockRun };
        });

        const payload = makePayload({
            action: 'assigned',
            pull_request: {
                number: 42,
                title: 'feat: new thing',
                user: { login: 'alice' },
                base: { ref: 'main' },
                head: { ref: 'feat/new-thing' },
                merged: false,
                assignees: [{ login: 'bob' }, { login: 'carol' }],
                requested_reviewers: [],
            },
        });

        await handle(payload, 'delivery-7');

        // assignee_logins is at index 11
        const assigneeLogins = JSON.parse(capturedArgs[11]);
        expect(assigneeLogins).toEqual(['bob', 'carol']);
    });

    it('duplicate deliveryId → INSERT OR IGNORE returns 0 changes (idempotency)', async () => {
        mockRun.mockReturnValue({ changes: 0 });
        await expect(handle(makePayload(), 'delivery-dup')).resolves.not.toThrow();
        expect(mockRun).toHaveBeenCalled();
    });

    it('duplicate deliveryId with SQLITE_CONSTRAINT error → logged, no throw', async () => {
        const constraintErr = Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT' });
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('INSERT OR IGNORE INTO pr_events')) {
                return { run: vi.fn(() => { throw constraintErr; }) };
            }
            return { run: mockRun };
        });

        await expect(handle(makePayload(), 'delivery-dup2')).resolves.not.toThrow();
    });

    it('malformed payload (missing pull_request) → handler does not throw', async () => {
        await expect(handle({ action: 'opened', repository: { id: 1 } }, 'delivery-bad')).resolves.not.toThrow();
        expect(mockPrepare).not.toHaveBeenCalled();
    });

    it('unhandled action → no DB writes', async () => {
        await handle(makePayload({ action: 'synchronize' }), 'delivery-skip');
        expect(mockPrepare).not.toHaveBeenCalled();
    });
});
