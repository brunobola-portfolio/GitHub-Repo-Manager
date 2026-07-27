import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTier, getUserTier } from '../middleware/require-tier.js';
import { getFeatures } from '../lib/feature-flags.js';
import { auditLog } from '../lib/audit.js';

const router = Router();

// Hard ceiling on a single export. The whole point of the export is bulk
// retrieval, so the paginated 200-row cap would defeat it — but audit_log_v2
// grows without bound, and better-sqlite3 is synchronous, so an unbounded
// SELECT would block the event loop for every other request while it
// materialises. Callers page with `before` (see the response's `nextBefore`).
const EXPORT_MAX_ROWS = 10000;

// Columns the export exposes. `prev_hash`/`row_hash` are the tamper-evident
// chain's internals and are deliberately included — an exported log that
// cannot be verified offline is not much of a compliance artifact.
const EXPORT_COLUMNS = [
    'id', 'created_at', 'action', 'resource_type', 'resource_id',
    'details', 'ip_address', 'user_agent', 'prev_hash', 'row_hash',
];

function csvCell(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    // Quote when the value could break the row/column structure, and double
    // any embedded quote per RFC 4180.
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// List audit log entries (paginated). Audit log is an Enterprise feature.
// The tier check is ALSO applied at the mount point; enforcing it here too is
// defense-in-depth so a future remount can't silently expose it to lower tiers.
router.get('/', requireAuth, requireTier('enterprise'), (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;
        const { action, resource_type, from, to } = req.query;

        // Validate date parameters
        if (from && isNaN(Date.parse(from))) return res.status(400).json({ error: 'Invalid "from" date format' });
        if (to && isNaN(Date.parse(to))) return res.status(400).json({ error: 'Invalid "to" date format' });

        let sql = 'SELECT * FROM audit_log_v2 WHERE user_id = ?';
        const params = [req.session.userId];

        if (action) { sql += ' AND action = ?'; params.push(action); }
        if (resource_type) { sql += ' AND resource_type = ?'; params.push(resource_type); }
        if (from) { sql += ' AND created_at >= ?'; params.push(from); }
        if (to) { sql += ' AND created_at <= ?'; params.push(to); }

        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const entries = db.prepare(sql).all(...params);

        // Get total count
        let countSql = 'SELECT COUNT(*) as total FROM audit_log_v2 WHERE user_id = ?';
        const countParams = [req.session.userId];
        if (action) { countSql += ' AND action = ?'; countParams.push(action); }
        if (resource_type) { countSql += ' AND resource_type = ?'; countParams.push(resource_type); }
        if (from) { countSql += ' AND created_at >= ?'; countParams.push(from); }
        if (to) { countSql += ' AND created_at <= ?'; countParams.push(to); }

        const { total } = db.prepare(countSql).get(...countParams);

        res.json({ entries, total, page, limit });
    } catch (err) {
        req.log?.error?.({ err }, 'Failed to fetch audit log');
        res.status(500).json({ error: 'Failed to fetch audit log' });
    }
});

/**
 * GET /export — bulk audit-log download (CSV or JSON).
 *
 * Sold as an Enterprise deliverable in docs/LICENSE-COMMERCIAL.md. Until this
 * existed, `auditExport` was a feature flag with zero consumers: a contractual
 * promise backed by a boolean nobody read.
 *
 * Gated on the flag itself rather than on requireTier('enterprise') alone, so
 * the contract and the code have exactly one source of truth.
 */
router.get('/export', requireAuth, requireTier('enterprise'), (req, res) => {
    const tier = getUserTier(req.session.userId);
    if (!getFeatures(tier)?.auditExport) {
        return res.status(403).json({
            error: 'Tier required',
            code: 'TIER_REQUIRED_ENTERPRISE',
            feature: 'auditExport',
            currentTier: tier,
            requiredTier: 'enterprise',
        });
    }

    try {
        const format = req.query.format === 'json' ? 'json' : 'csv';
        const limit = Math.min(EXPORT_MAX_ROWS, Math.max(1, parseInt(req.query.limit) || EXPORT_MAX_ROWS));
        const { action, resource_type, from, to, before } = req.query;

        if (from && isNaN(Date.parse(from))) return res.status(400).json({ error: 'Invalid "from" date format' });
        if (to && isNaN(Date.parse(to))) return res.status(400).json({ error: 'Invalid "to" date format' });
        if (before !== undefined && !/^\d+$/.test(String(before))) {
            return res.status(400).json({ error: 'Invalid "before" cursor' });
        }

        // Keyset pagination on the primary key, not OFFSET: an export that
        // walks a large log with OFFSET re-scans everything it already
        // returned, and rows inserted mid-walk shift the window.
        let sql = `SELECT ${EXPORT_COLUMNS.join(', ')} FROM audit_log_v2 WHERE user_id = ?`;
        const params = [req.session.userId];
        if (action) { sql += ' AND action = ?'; params.push(action); }
        if (resource_type) { sql += ' AND resource_type = ?'; params.push(resource_type); }
        if (from) { sql += ' AND created_at >= ?'; params.push(from); }
        if (to) { sql += ' AND created_at <= ?'; params.push(to); }
        if (before) { sql += ' AND id < ?'; params.push(parseInt(before, 10)); }
        sql += ' ORDER BY id DESC LIMIT ?';
        params.push(limit);

        const rows = db.prepare(sql).all(...params);
        const nextBefore = rows.length === limit ? rows[rows.length - 1].id : null;

        auditLog(req, 'audit.export', 'audit', null, { format, rows: rows.length, truncated: nextBefore !== null });

        const stamp = new Date().toISOString().slice(0, 10);
        if (format === 'json') {
            res.setHeader('Content-Disposition', `attachment; filename="audit-log-${stamp}.json"`);
            return res.json({ entries: rows, count: rows.length, nextBefore });
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="audit-log-${stamp}.csv"`);
        const body = [
            EXPORT_COLUMNS.join(','),
            ...rows.map((row) => EXPORT_COLUMNS.map((col) => csvCell(row[col])).join(',')),
        ].join('\r\n');
        // A trailing newline keeps the last row well-formed for line-based tools.
        res.send(rows.length ? `${body}\r\n` : `${body}\r\n`);
    } catch (err) {
        req.log?.error?.({ err }, 'Failed to export audit log');
        res.status(500).json({ error: 'Failed to export audit log' });
    }
});

export default router;
