// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unit tests for dlq-sweep's core sweep() + countSweepable().
 * Seeds rows with explicit old/new resolved_at timestamps so the cutoff
 * logic is exercised without waiting on wall-clock.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeIntegrationDb } from '../helpers/integration-db.js';
import { vi } from 'vitest';

const { initDB: realInitDB } = await vi.importActual('../../db.js');
const testDb = makeIntegrationDb(realInitDB);

const { countSweepable, sweep } = await import('../../scripts/dlq-sweep.mjs');

beforeEach(() => {
    testDb.exec(`
        DELETE FROM email_dead_letter;
        DELETE FROM webhook_events_dead_letter;
    `);
    // Two resolved rows — one far older than 30 days, one from yesterday.
    // Plus one unresolved row that must NEVER be swept.
    // resolved_at is populated via UPDATE so we can use datetime('now', ...)
    // (bound values can't reference SQLite functions).
    const stmt = testDb.prepare(`
        INSERT INTO email_dead_letter
            (to_address, subject, body_html, body_text, context_json,
             attempts, last_error, next_retry_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run('old@x.io',  'Old',  '<p/>', 'x', '{}', 1, 'done',    null, null);
    stmt.run('new@x.io',  'New',  '<p/>', 'x', '{}', 1, 'done',    null, null);
    stmt.run('open@x.io', 'Open', '<p/>', 'x', '{}', 1, 'pending', null, null);
    testDb.prepare(
        `UPDATE email_dead_letter SET resolved_at = datetime('now', '-90 days') WHERE to_address = 'old@x.io'`,
    ).run();
    testDb.prepare(
        `UPDATE email_dead_letter SET resolved_at = datetime('now', '-1 days') WHERE to_address = 'new@x.io'`,
    ).run();
});

describe('dlq-sweep', () => {
    it('dry-run counts eligible rows without deleting', () => {
        const n = countSweepable({ db: testDb, queue: 'email', days: 30 });
        expect(n).toBe(1);

        const remaining = testDb.prepare('SELECT COUNT(*) AS n FROM email_dead_letter').get().n;
        expect(remaining).toBe(3);
    });

    it('non-dry sweep deletes only the old-resolved row', () => {
        const deleted = sweep({ db: testDb, queue: 'email', days: 30 });
        expect(deleted).toBe(1);

        const remaining = testDb.prepare(
            `SELECT to_address FROM email_dead_letter ORDER BY to_address`,
        ).all().map(r => r.to_address);
        expect(remaining).toEqual(['new@x.io', 'open@x.io']);
    });
});
