// @vitest-environment node
/**
 * G1 — Append-only audit log: hash-chain tests
 *
 * Tests:
 *  1. auditLog() chains correctly (prev_hash links + row_hash is valid).
 *  2. Manual UPDATE on audit_log_v2 is rejected by trigger.
 *  3. Manual DELETE on audit_log_v2 is rejected by trigger.
 *  4. verifyAuditChain returns { valid: true } on a clean chain.
 *  5. Corrupting a row_hash → verifyAuditChain returns { valid: false, brokenAt }.
 *  6. Empty table → { valid: true, totalChecked: 0 }.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// In-memory SQLite database — swapped per test via Proxy
// ---------------------------------------------------------------------------

let _db;

// vi.mock is hoisted to the top of the module by Vitest — the Proxy reads
// _db lazily so that beforeEach can swap it between tests.
vi.mock('../db.js', () => ({
    default: new Proxy({}, {
        get(_target, prop) { return _db[prop]; },
    }),
}));

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

function createSchema(database) {
    database.exec(`
        CREATE TABLE IF NOT EXISTS audit_log_v2 (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            action        TEXT    NOT NULL,
            resource_type TEXT    NOT NULL,
            resource_id   TEXT,
            details       TEXT,
            ip_address    TEXT,
            user_agent    TEXT,
            api_key_id    TEXT,
            created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
            prev_hash     TEXT    NOT NULL DEFAULT '',
            row_hash      TEXT    NOT NULL DEFAULT ''
        )
    `);
    database.exec(`
        CREATE TRIGGER IF NOT EXISTS audit_log_v2_no_update
        BEFORE UPDATE ON audit_log_v2
        BEGIN
            SELECT RAISE(ABORT, 'audit_log_v2 is append-only; updates are not permitted');
        END
    `);
    database.exec(`
        CREATE TRIGGER IF NOT EXISTS audit_log_v2_no_delete
        BEFORE DELETE ON audit_log_v2
        BEGIN
            SELECT RAISE(ABORT, 'audit_log_v2 is append-only; deletions are not permitted');
        END
    `);
}

// ---------------------------------------------------------------------------
// Module-under-test — imported once; relies on the _db Proxy being mutable.
// ---------------------------------------------------------------------------

import { auditLog, verifyAuditChain, computeRowHash } from '../lib/audit.js';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
    _db = new Database(':memory:');
    createSchema(_db);
});

afterEach(() => {
    _db?.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeReq(userId = 1) {
    return {
        tenantId: null,
        session: { userId },
        ip: '127.0.0.1',
        headers: { 'user-agent': 'test-agent' },
        apiKeyId: null,
    };
}

function allRows() {
    return _db.prepare(
        `SELECT id, action, resource_type, resource_id, user_id,
                created_at, details, prev_hash, row_hash
         FROM audit_log_v2 ORDER BY id ASC`
    ).all();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('G1 — auditLog hash chain', () => {
    it('writes prev_hash + row_hash on first insert', () => {
        auditLog(fakeReq(), 'repo.deleted', 'repo', 42);

        const rows = allRows();
        expect(rows).toHaveLength(1);

        const row = rows[0];
        expect(row.prev_hash).toBe('');   // first row — no predecessor
        expect(row.row_hash).toHaveLength(64); // sha256 hex

        // Verify the stored hash matches re-computation
        const recomputed = computeRowHash(row);
        expect(row.row_hash).toBe(recomputed);
    });

    it('links each row to the previous row_hash', () => {
        const req = fakeReq(10);
        auditLog(req, 'repo.created', 'repo', 1);
        auditLog(req, 'repo.updated', 'repo', 1);
        auditLog(req, 'repo.deleted', 'repo', 1);

        const rows = allRows();
        expect(rows).toHaveLength(3);

        // Row 1: prev_hash must be '' (genesis)
        expect(rows[0].prev_hash).toBe('');

        // Rows 2 and 3: prev_hash must equal the previous row's row_hash
        expect(rows[1].prev_hash).toBe(rows[0].row_hash);
        expect(rows[2].prev_hash).toBe(rows[1].row_hash);
    });

    it('row_hash is reproducible from stored columns', () => {
        auditLog(fakeReq(5), 'user.login', 'user', 5, { ip: '1.2.3.4' });

        const row = allRows()[0];
        const recomputed = computeRowHash(row);
        expect(row.row_hash).toBe(recomputed);
    });
});

describe('G1 — append-only triggers', () => {
    it('rejects UPDATE on audit_log_v2', () => {
        auditLog(fakeReq(), 'test.action', 'test', 1);

        expect(() => {
            _db.prepare(`UPDATE audit_log_v2 SET action = 'tampered' WHERE id = 1`).run();
        }).toThrow(/append-only/i);
    });

    it('rejects DELETE on audit_log_v2', () => {
        auditLog(fakeReq(), 'test.action', 'test', 1);

        expect(() => {
            _db.prepare(`DELETE FROM audit_log_v2 WHERE id = 1`).run();
        }).toThrow(/append-only/i);
    });
});

describe('G1 — verifyAuditChain', () => {
    it('returns { valid: true, totalChecked: 0 } on empty table', () => {
        const result = verifyAuditChain();
        expect(result).toEqual({ valid: true, totalChecked: 0 });
    });

    it('returns valid: true on a clean chain', () => {
        const req = fakeReq(7);
        auditLog(req, 'a', 'resource', 1);
        auditLog(req, 'b', 'resource', 2);
        auditLog(req, 'c', 'resource', 3);

        const result = verifyAuditChain();
        expect(result.valid).toBe(true);
        expect(result.totalChecked).toBe(3);
    });

    it('returns valid: false with brokenAt when row_hash is corrupted', () => {
        const req = fakeReq(8);
        auditLog(req, 'a', 'resource', 1);
        auditLog(req, 'b', 'resource', 2);
        auditLog(req, 'c', 'resource', 3);

        // Directly corrupt the second row's row_hash by temporarily removing
        // the trigger (simulates an out-of-band tamper against the DB file).
        _db.prepare(`DROP TRIGGER IF EXISTS audit_log_v2_no_update`).run();
        _db.prepare(`UPDATE audit_log_v2 SET row_hash = 'badhash' WHERE id = 2`).run();
        // Restore trigger
        _db.exec(`
            CREATE TRIGGER audit_log_v2_no_update
            BEFORE UPDATE ON audit_log_v2
            BEGIN
                SELECT RAISE(ABORT, 'audit_log_v2 is append-only; updates are not permitted');
            END
        `);

        const result = verifyAuditChain();
        expect(result.valid).toBe(false);
        expect(result.brokenAt).toBe(2);
    });

    it('verifyAuditChain with from/to range only checks that window', () => {
        const req = fakeReq(9);
        auditLog(req, 'a', 'resource', 1);
        auditLog(req, 'b', 'resource', 2);
        auditLog(req, 'c', 'resource', 3);

        const rows = allRows();
        const result = verifyAuditChain({ from: rows[1].id, to: rows[2].id });
        expect(result.valid).toBe(true);
        expect(result.totalChecked).toBe(2);
    });
});
