// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the admin-grant CLI core.
 *
 * We import the extracted `grantAdmin()` function directly against an
 * in-memory SQLite (via makeIntegrationDb) rather than spawning a child
 * process — this keeps the test fast and lets us assert the audit-log
 * callback shape without parsing stdout.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeIntegrationDb } from '../helpers/integration-db.js';

const { initDB: realInitDB } = await vi.importActual('../../db.js');
const testDb = makeIntegrationDb(realInitDB);

const { grantAdmin } = await import('../../scripts/admin-grant.mjs');

beforeEach(() => {
    testDb.exec('DELETE FROM users');
    testDb.prepare(
        'INSERT INTO users (id, username, avatar_url, is_admin) VALUES (?, ?, ?, ?)',
    ).run(42, 'alice', null, 0);
});

describe('grantAdmin', () => {
    it('sets is_admin=1 and audit-logs with admin.grant', () => {
        const audit = vi.fn();
        const res = grantAdmin({ db: testDb, user: 'alice', audit });

        expect(res).toMatchObject({ ok: true, id: 42, username: 'alice', revoke: false });

        const row = testDb.prepare('SELECT is_admin FROM users WHERE id = 42').get();
        expect(row.is_admin).toBe(1);

        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0]).toMatchObject({
            action: 'admin.grant',
            entity_type: 'user',
            entity_id: 42,
        });
    });

    it('sets is_admin=0 with --revoke and audit-logs admin.revoke', () => {
        // Pre-grant so we can actually revoke.
        testDb.prepare('UPDATE users SET is_admin = 1 WHERE id = 42').run();
        const audit = vi.fn();
        const res = grantAdmin({ db: testDb, user: '42', revoke: true, audit });

        expect(res).toMatchObject({ ok: true, id: 42, revoke: true });

        const row = testDb.prepare('SELECT is_admin FROM users WHERE id = 42').get();
        expect(row.is_admin).toBe(0);

        expect(audit.mock.calls[0][0].action).toBe('admin.revoke');
    });

    it('returns ok=false with reason=not_found when no user matches', () => {
        const audit = vi.fn();
        const res = grantAdmin({ db: testDb, user: 'ghost', audit });
        expect(res).toMatchObject({ ok: false, reason: 'not_found', user: 'ghost' });
        expect(audit).not.toHaveBeenCalled();
    });
});
