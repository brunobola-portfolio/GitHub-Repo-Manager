// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { handle } from '../../lib/github-events/issues.js';

function makePayload(overrides = {}) {
    return {
        action: 'opened',
        issue: {
            number: 99,
            user: { login: 'alice' },
            assignees: [],
            labels: [],
        },
        repository: { id: 202, full_name: 'org/repo2' },
        ...overrides,
    };
}

describe('issues handler', () => {
    beforeEach(() => {
        mockPrepare.mockClear();
        mockRun.mockClear();
        mockRun.mockReturnValue({ changes: 1 });
        mockPrepare.mockReturnValue({ run: mockRun });
    });

    it('opened → inserts issue_events row with correct fields', async () => {
        let capturedArgs = [];
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('INSERT OR IGNORE INTO issue_events')) {
                return { run: vi.fn((...args) => { capturedArgs = args; return { changes: 1 }; }) };
            }
            return { run: mockRun };
        });

        await handle(makePayload(), 'delivery-issue-1');

        expect(capturedArgs[0]).toBe('delivery-issue-1');
        expect(capturedArgs[1]).toBe(202);
        expect(capturedArgs[2]).toBe('org/repo2');
        expect(capturedArgs[3]).toBe(99);
        expect(capturedArgs[4]).toBe('opened');
        expect(capturedArgs[5]).toBe('alice');
    });

    it('closed → inserts issue_events with action=closed', async () => {
        let capturedAction = '';
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('INSERT OR IGNORE INTO issue_events')) {
                return { run: vi.fn((...args) => { capturedAction = args[4]; return { changes: 1 }; }) };
            }
            return { run: mockRun };
        });

        await handle(makePayload({ action: 'closed' }), 'delivery-issue-2');

        expect(capturedAction).toBe('closed');
    });

    it('assigned → assignee_logins is a JSON array', async () => {
        let capturedAssignees = '';
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('INSERT OR IGNORE INTO issue_events')) {
                return { run: vi.fn((...args) => { capturedAssignees = args[6]; return { changes: 1 }; }) };
            }
            return { run: mockRun };
        });

        const payload = makePayload({
            action: 'assigned',
            issue: {
                number: 99,
                user: { login: 'alice' },
                assignees: [{ login: 'bob' }, { login: 'carol' }],
                labels: [],
            },
        });

        await handle(payload, 'delivery-issue-3');

        expect(JSON.parse(capturedAssignees)).toEqual(['bob', 'carol']);
    });

    it('labeled → labels is a JSON array of label names', async () => {
        let capturedLabels = '';
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('INSERT OR IGNORE INTO issue_events')) {
                return { run: vi.fn((...args) => { capturedLabels = args[7]; return { changes: 1 }; }) };
            }
            return { run: mockRun };
        });

        const payload = makePayload({
            action: 'labeled',
            issue: {
                number: 99,
                user: { login: 'alice' },
                assignees: [],
                labels: [{ name: 'bug' }, { name: 'urgent' }],
            },
        });

        await handle(payload, 'delivery-issue-4');

        expect(JSON.parse(capturedLabels)).toEqual(['bug', 'urgent']);
    });

    it('duplicate deliveryId → INSERT OR IGNORE returns 0 changes (idempotency)', async () => {
        mockRun.mockReturnValue({ changes: 0 });
        await expect(handle(makePayload(), 'delivery-dup')).resolves.not.toThrow();
    });

    it('unhandled action → no DB writes', async () => {
        await handle(makePayload({ action: 'transferred' }), 'delivery-skip');
        expect(mockPrepare).not.toHaveBeenCalled();
    });
});
