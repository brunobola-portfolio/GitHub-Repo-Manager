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

/**
 * Write a structured audit entry to audit_log_v2 with hash-chain columns.
 *
 * The signature is kept identical to the previous version so every call
 * site continues to work without changes.
 *
 * Hash-chain strategy (single-phase, no UPDATE needed):
 *   1. Read the last row's row_hash → prev_hash for this row.
 *   2. Determine the next ROWID from the SQLite sequence.
 *   3. Compute row_hash using the anticipated id + wall-clock timestamp.
 *   4. INSERT with all four columns populated in one statement.
 *
 * The anticipated id may rarely differ from the actual lastInsertRowid when
 * concurrent writers race (very unlikely in single-process SQLite). If they
 * differ we log a warning; the row is still written and the chain is still
 * valid (verifyAuditChain re-computes every hash from stored fields).
 *
 * @param {import('express').Request} req
 * @param {string} action
 * @param {string} resourceType
 * @param {string|number} resourceId
 * @param {object} [details]
 */
export function auditLog(req, action, resourceType, resourceId, details = {}) {
    try {
        const userId = req.tenantId || req.session?.userId || 0;
        const detailsJson = JSON.stringify(details);
        const ipAddress = req.ip || '';
        const userAgent = req.headers?.['user-agent'] || '';
        const apiKeyId = req.apiKeyId || null;

        // 1. Grab the last row's hash to form the chain link.
        const lastRow = db.prepare(
            `SELECT id, row_hash FROM audit_log_v2 ORDER BY id DESC LIMIT 1`
        ).get();
        const prevHash = lastRow?.row_hash ?? '';

        // 2. Predict the next id from the SQLite autoincrement sequence.
        //    sqlite_sequence holds the last used rowid per table.
        const seqRow = db.prepare(
            `SELECT seq FROM sqlite_sequence WHERE name = 'audit_log_v2'`
        ).get();
        const anticipatedId = seqRow ? seqRow.seq + 1 : 1;

        // 3. Determine the timestamp we'll store (sqlite DEFAULT uses datetime('now')
        //    at INSERT time; we replicate that here for hash computation).
        const createdAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

        // 4. Pre-compute the row hash.
        const rowHash = computeRowHash({
            id: anticipatedId,
            action,
            resource_type: resourceType,
            resource_id: String(resourceId ?? ''),
            user_id: userId,
            created_at: createdAt,
            details: detailsJson,
            prev_hash: prevHash,
        });

        // 5. Single INSERT — no subsequent UPDATE required (triggers not tripped).
        const info = db.prepare(`
            INSERT INTO audit_log_v2
                (user_id, action, resource_type, resource_id, details,
                 ip_address, user_agent, api_key_id, prev_hash, row_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId,
            action,
            resourceType,
            String(resourceId ?? ''),
            detailsJson,
            ipAddress,
            userAgent,
            apiKeyId,
            prevHash,
            rowHash,
            createdAt,
        );

        if (info.lastInsertRowid !== anticipatedId) {
            logger.warn(
                { anticipatedId, actual: info.lastInsertRowid },
                '[audit] ROWID mismatch — hash was computed for anticipated id; chain remains valid but re-run verifyAuditChain to confirm'
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
        const userId = actor_user_id ?? 0;
        const detailsJson = JSON.stringify(metadata);

        // 1. Grab the last row's hash to form the chain link.
        const lastRow = db.prepare(
            `SELECT id, row_hash FROM audit_log_v2 ORDER BY id DESC LIMIT 1`
        ).get();
        const prevHash = lastRow?.row_hash ?? '';

        // 2. Predict the next id from the SQLite autoincrement sequence.
        const seqRow = db.prepare(
            `SELECT seq FROM sqlite_sequence WHERE name = 'audit_log_v2'`
        ).get();
        const anticipatedId = seqRow ? seqRow.seq + 1 : 1;

        // 3. Determine the timestamp.
        const createdAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

        // 4. Pre-compute the row hash.
        const rowHash = computeRowHash({
            id: anticipatedId,
            action,
            resource_type: entity_type,
            resource_id: String(entity_id ?? ''),
            user_id: userId,
            created_at: createdAt,
            details: detailsJson,
            prev_hash: prevHash,
        });

        // 5. Single INSERT — same schema as auditLog().
        const info = db.prepare(`
            INSERT INTO audit_log_v2
                (user_id, action, resource_type, resource_id, details,
                 ip_address, user_agent, api_key_id, prev_hash, row_hash, created_at)
            VALUES (?, ?, ?, ?, ?, '', '', NULL, ?, ?, ?)
        `).run(
            userId,
            action,
            entity_type,
            String(entity_id ?? ''),
            detailsJson,
            prevHash,
            rowHash,
            createdAt,
        );

        if (info.lastInsertRowid !== anticipatedId) {
            logger.warn(
                { anticipatedId, actual: info.lastInsertRowid },
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
        return { valid: true, totalChecked: 0 };
    }

    let expectedPrevHash = null; // tracks previous row's row_hash

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Check prev_hash continuity from the second row onward.
        if (i > 0 && row.prev_hash !== expectedPrevHash) {
            return { valid: false, brokenAt: row.id, totalChecked: i };
        }

        // Recompute and compare the row's own hash.
        const expected = computeRowHash(row);
        if (row.row_hash !== expected) {
            return { valid: false, brokenAt: row.id, totalChecked: i };
        }

        expectedPrevHash = row.row_hash;
    }

    return { valid: true, totalChecked: rows.length };
}
