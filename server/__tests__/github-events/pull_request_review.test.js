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
import { handle } from '../../lib/github-events/pull_request_review.js';

function makePayload(overrides = {}) {
    return {
        action: 'submitted',
        review: {
            user: { login: 'bob' },
            state: 'approved',
        },
        pull_request: {
            number: 42,
            title: 'feat: new thing',
            base: { ref: 'main' },
            head: { ref: 'feat/new-thing' },
        },
        repository: { id: 101, full_name: 'org/repo' },
        ...overrides,
    };
}

describe('pull_request_review handler', () => {
    beforeEach(() => {
        mockPrepare.mockClear();
        mockRun.mockClear();
        mockRun.mockReturnValue({ changes: 1 });
        mockPrepare.mockReturnValue({ run: mockRun });
    });

    it('submitted → inserts pr_events row with action=reviewed embedded in SQL', async () => {
        let capturedSql = '';
        let capturedArgs = [];
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('INSERT OR IGNORE INTO pr_events')) {
                capturedSql = sql;
                return { run: vi.fn((...args) => { capturedArgs = args; return { changes: 1 }; }) };
            }
            return { run: mockRun };
        });

        await handle(makePayload(), 'delivery-review-1');

        // 'reviewed' is a SQL literal, not a bound parameter
        expect(capturedSql).toMatch(/'reviewed'/);
        // Bound params: [eventId, repoId, repoFullName, prNumber, authorLogin, title, baseRef, headRef]
        expect(capturedArgs[0]).toBe('delivery-review-1'); // eventId
        expect(capturedArgs[1]).toBe(101);                  // repo_id
        expect(capturedArgs[3]).toBe(42);                   // pr_number
        expect(capturedArgs[4]).toBe('bob');                // author_login (reviewer)
    });

    it('submitted → marks review_assignments state=submitted', async () => {
        let updateSql = '';
        let updateArgs = [];
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('UPDATE review_assignments')) {
                updateSql = sql;
                return { run: vi.fn((...args) => { updateArgs = args; return { changes: 1 }; }) };
            }
            return { run: mockRun };
        });

        await handle(makePayload(), 'delivery-review-2');

        expect(updateSql).toMatch(/submitted/);
        expect(updateArgs[2]).toBe('bob'); // reviewer_login
    });

    it('dismissed → inserts pr_events but does NOT update review_assignments to submitted', async () => {
        let updateCalled = false;
        mockPrepare.mockImplementation((sql) => {
            if (sql.includes('UPDATE review_assignments')) {
                updateCalled = true;
            }
            return { run: mockRun };
        });

        await handle(makePayload({ action: 'dismissed' }), 'delivery-review-3');

        // The UPDATE is gated on action === 'submitted'
        expect(updateCalled).toBe(false);
    });

    it('review for unknown PR reviewer (0 changes) → no crash', async () => {
        mockRun.mockReturnValue({ changes: 0 });
        await expect(handle(makePayload(), 'delivery-review-4')).resolves.not.toThrow();
    });

    it('malformed payload (missing review) → handler does not throw', async () => {
        await expect(handle({ action: 'submitted', pull_request: { number: 1 } }, 'delivery-bad')).resolves.not.toThrow();
        expect(mockPrepare).not.toHaveBeenCalled();
    });
});
