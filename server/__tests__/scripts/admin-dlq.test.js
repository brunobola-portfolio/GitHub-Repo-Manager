// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit tests for the admin-dlq CLI core functions (summary/list/retry/resolve).
 *
 * Named `admin-dlq.test.js` but scoped to `server/__tests__/scripts/` — this
 * does NOT collide with the existing `server/__tests__/admin-dlq.test.js`
 * which covers the HTTP router at `/api/v1/admin/dlq/*`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeIntegrationDb } from '../helpers/integration-db.js';

const { initDB: realInitDB } = await vi.importActual('../../db.js');
const testDb = makeIntegrationDb(realInitDB);

const { dlqSummary, dlqList, dlqRetry, dlqResolve } = await import('../../scripts/admin-dlq.mjs');

beforeEach(() => {
    testDb.exec(`
        DELETE FROM email_dead_letter;
        DELETE FROM webhook_events_dead_letter;
    `);
    // Seed: 2 unresolved (one with attempts>5), 1 resolved.
    const stmt = testDb.prepare(`
        INSERT INTO email_dead_letter
            (to_address, subject, body_html, body_text, context_json,
             attempts, last_error, next_retry_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+1 hour'), ?)
    `);
    stmt.run('a@x.io', 'Welcome', '<p>a</p>', 'a', '{}', 2, 'smtp 421', null);
    stmt.run('b@x.io', 'Bill',    '<p>b</p>', 'b', '{}', 9, 'smtp 550 — a very long error message that should be truncated in the list output beyond sixty chars', null);
    stmt.run('c@x.io', 'Done',    '<p>c</p>', 'c', '{}', 1, 'smtp 421', '2026-01-01 00:00:00');
});

describe('dlqSummary', () => {
    it('counts unresolved, resolved, and attempts>5 for the email queue', () => {
        const s = dlqSummary({ db: testDb, queue: 'email' });
        expect(s).toEqual({ queue: 'email', unresolved: 2, resolved: 1, overAttempts: 1 });
    });
});

describe('dlqList', () => {
    it('returns unresolved-only rows with truncated last_error', () => {
        const rows = dlqList({ db: testDb, queue: 'email', unresolvedOnly: true });
        expect(rows).toHaveLength(2);
        const long = rows.find(r => r.to_address === 'b@x.io');
        expect(long.last_error.endsWith('...')).toBe(true);
        expect(long.last_error.length).toBeLessThanOrEqual(60);
    });
});

describe('dlqRetry', () => {
    it('moves next_retry_at to now and invokes the audit callback', () => {
        const target = testDb.prepare(
            'SELECT id, next_retry_at FROM email_dead_letter WHERE to_address = ?',
        ).get('a@x.io');

        const audit = vi.fn();
        const res = dlqRetry({ db: testDb, queue: 'email', id: target.id, audit });

        expect(res).toEqual({ ok: true, id: target.id });

        const after = testDb.prepare(
            'SELECT next_retry_at FROM email_dead_letter WHERE id = ?',
        ).get(target.id);
        expect(after.next_retry_at < target.next_retry_at).toBe(true);

        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0]).toMatchObject({
            action: 'dlq.email.retry',
            entity_type: 'email_dlq',
            entity_id: target.id,
        });
    });
});

describe('dlqResolve', () => {
    it('sets resolved_at and audit-logs dlq.email.delete', () => {
        const target = testDb.prepare(
            'SELECT id FROM email_dead_letter WHERE to_address = ?',
        ).get('a@x.io');

        const audit = vi.fn();
        const res = dlqResolve({ db: testDb, queue: 'email', id: target.id, audit });

        expect(res).toEqual({ ok: true, id: target.id });

        const after = testDb.prepare(
            'SELECT resolved_at, last_error FROM email_dead_letter WHERE id = ?',
        ).get(target.id);
        expect(after.resolved_at).not.toBeNull();
        expect(after.last_error).toMatch(/Operator-marked resolved/);

        expect(audit.mock.calls[0][0].action).toBe('dlq.email.delete');
    });
});
