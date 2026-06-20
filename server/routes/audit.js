import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTier } from '../middleware/require-tier.js';

const router = Router();

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

export default router;
