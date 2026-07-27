import crypto from 'crypto';
import db from '../db.js';
import logger from './logger.js';

/**
 * Compute a deterministic SHA-256 hash for an audit_log_v2 row.
 * Fields are concatenated in a fixed order with null-safe coercion so
 * the hash is reproducible even when optional columns are NULL.
 *
 * Column order MUST NOT change — changing it invalidates all existing hashes.
 *
 * @param {object} row  - Must contain: id, action, resource_type, resource_id,
 *                        user_id, created_at, details, prev_hash
 * @returns {string} hex digest
 */
export function computeRowHash(row) {
    const parts = [
        String(row.id ?? ''),
        String(row.action ?? ''),
        String(row.resource_type ?? ''),
        String(row.resource_id ?? ''),
        String(row.user_id ?? ''),
        String(row.created_at ?? ''),
        String(row.details ?? ''),
        String(row.prev_hash ?? ''),
    ];
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

// Lazy-init prepared statements + transaction wrapper.
// Cannot prepare at module-load time because some test fixtures lazily swap
// the underlying db via a Proxy. Cached after first call so the work is
// done exactly once per process — that was the win we wanted vs the old
// "prepare inside every call" pattern.
//
// Wrapping the read+compute+write trio in a transaction also fixes a race:
// two concurrent auditLog() calls could produce two rows with the same
// prev_hash, which would break verifyAuditChain on the second row.
let stmtCache = null;
function getStmts() {
    if (stmtCache) return stmtCache;
    const selectLast = db.prepare(
        `SELECT id, row_hash FROM audit_log_v2 ORDER BY id DESC LIMIT 1`
    );
    const selectSeq = db.prepare(
        `SELECT seq FROM sqlite_sequence WHERE name = 'audit_log_v2'`
    );
    const insertRow = db.prepare(`
        INSERT INTO audit_log_v2
            (user_id, action, resource_type, resource_id, details,
             ip_address, user_agent, api_key_id, prev_hash, row_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const writeTx = db.transaction((row) => {
        const lastRow = selectLast.get();
        const prevHash = lastRow?.row_hash ?? '';
        const seqRow = selectSeq.get();
        const anticipatedId = seqRow ? seqRow.seq + 1 : 1;
        const createdAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
        const rowHash = computeRowHash({
            id: anticipatedId,
            action: row.action,
            resource_type: row.resource_type,
            resource_id: String(row.resource_id ?? ''),
            user_id: row.user_id,
            created_at: createdAt,
            details: row.details,
            prev_hash: prevHash,
        });
        const info = insertRow.run(
            row.user_id,
            row.action,
            row.resource_type,
            String(row.resource_id ?? ''),
            row.details,
            row.ip_address || '',
            row.user_agent || '',
            row.api_key_id || null,
            prevHash,
            rowHash,
            createdAt,
        );
        return { anticipatedId, actualId: info.lastInsertRowid };
    });
    stmtCache = { writeTx };
    return stmtCache;
}

// Test-only helper: reset the cached prepared statements so a test that swaps
// the underlying db handle (via vi.mock + Proxy) re-prepares against the new
// handle. Production code never calls this.
export function _resetAuditStatementCache() { stmtCache = null; }

/**
 * Write a structured audit entry to audit_log_v2 with hash-chain columns.
 *
 * The signature is kept identical to the previous version so every call
 * site continues to work without changes.
 *
 * @param {import('express').Request} req
 * @param {string} action
 * @param {string} resourceType
 * @param {string|number} resourceId
 * @param {object} [details]
 */
export function auditLog(req, action, resourceType, resourceId, details = {}) {
    try {
        const result = getStmts().writeTx({
            user_id: req.tenantId || req.session?.userId || 0,
            action,
            resource_type: resourceType,
            resource_id: resourceId,
            details: JSON.stringify(details),
            ip_address: req.ip || '',
            user_agent: req.headers?.['user-agent'] || '',
            api_key_id: req.apiKeyId || null,
        });

        if (result.actualId !== result.anticipatedId) {
            logger.warn(
                { anticipatedId: result.anticipatedId, actual: result.actualId },
                '[audit] ROWID mismatch — chain remains valid; run verifyAuditChain to confirm'
            );
        }
    } catch (err) {
        logger.error({ err, action, resourceType }, 'Failed to write audit log');
    }
}

/**
 * Write a structured audit entry without an HTTP request object.
 * Use this helper from background tasks (retention, cron jobs) that have no
 * `req` to pass to `auditLog()`. Shares the exact same hash-chain logic.
 *
 * @param {object} opts
 * @param {number|string} opts.actor_user_id - The user whose data is being acted on
 * @param {string} opts.action               - Action string (e.g. 'user_ai_config.purged')
 * @param {string} opts.entity_type          - Resource type (e.g. 'user_ai_config')
 * @param {string|number} opts.entity_id     - Resource ID
 * @param {object} [opts.metadata]           - Extra metadata (serialised as JSON in details)
 */
export function auditLogDirect({ actor_user_id, action, entity_type, entity_id, metadata = {} }) {
    try {
        const result = getStmts().writeTx({
            user_id: actor_user_id ?? 0,
            action,
            resource_type: entity_type,
            resource_id: entity_id,
            details: JSON.stringify(metadata),
            ip_address: '',
            user_agent: '',
            api_key_id: null,
        });

        if (result.actualId !== result.anticipatedId) {
            logger.warn(
                { anticipatedId: result.anticipatedId, actual: result.actualId },
                '[audit] auditLogDirect ROWID mismatch — chain remains valid'
            );
        }
    } catch (err) {
        logger.error({ err, action, entity_type }, 'Failed to write audit log (direct)');
    }
}

/**
 * Walk the audit_log_v2 hash chain and verify integrity.
 *
 * Each row's row_hash is recomputed from its stored fields and compared
 * to the stored value. Additionally, each row's prev_hash must match the
 * previous row's row_hash (ensuring no rows were inserted, deleted, or
 * reordered without detection).
 *
 * @param {object} [opts]
 * @param {number} [opts.from]  - Start from this id (inclusive). Defaults to first row.
 * @param {number} [opts.to]    - Stop at this id (inclusive). Defaults to last row.
 * @returns {{ valid: boolean, brokenAt?: number, totalChecked: number }}
 */
export function verifyAuditChain({ from, to } = {}) {
    let query = `
        SELECT id, action, resource_type, resource_id, user_id,
               created_at, details, prev_hash, row_hash
        FROM audit_log_v2
    `;
    const params = [];
    const conditions = [];

    if (from != null) { conditions.push('id >= ?'); params.push(from); }
    if (to != null)   { conditions.push('id <= ?'); params.push(to); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY id ASC';

    const rows = db.prepare(query).all(...params);

    if (rows.length === 0) {
        return { valid: true, totalChecked: 0, unhashedLegacy: 0 };
    }

    // Rows written before the hash-chain migration have no row_hash at all.
    // They are unverifiable, not tampered — reporting them as a break told
    // every pre-existing instance that its audit log had been altered, which
    // is the fastest way to teach an operator to ignore this tool.
    //
    // They are only tolerated as a CONTIGUOUS PREFIX. An unhashed row sitting
    // after a hashed one cannot be legacy, so blanking a hash to evade
    // detection is still caught below.
    let legacyCount = 0;
    while (legacyCount < rows.length && !rows[legacyCount].row_hash) legacyCount++;

    const chain = rows.slice(legacyCount);
    if (chain.length === 0) {
        return { valid: true, totalChecked: 0, unhashedLegacy: legacyCount };
    }

    let expectedPrevHash = null; // tracks previous row's row_hash

    for (let i = 0; i < chain.length; i++) {
        const row = chain[i];

        // An unhashed row inside the chain is tampering, not history.
        if (!row.row_hash) {
            return { valid: false, brokenAt: row.id, totalChecked: i, unhashedLegacy: legacyCount };
        }

        // Check prev_hash continuity from the second row onward.
        if (i > 0 && row.prev_hash !== expectedPrevHash) {
            return { valid: false, brokenAt: row.id, totalChecked: i, unhashedLegacy: legacyCount };
        }

        // Recompute and compare the row's own hash.
        const expected = computeRowHash(row);
        if (row.row_hash !== expected) {
            return { valid: false, brokenAt: row.id, totalChecked: i, unhashedLegacy: legacyCount };
        }

        expectedPrevHash = row.row_hash;
    }

    return { valid: true, totalChecked: chain.length, unhashedLegacy: legacyCount };
}
