import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// List audit log entries (paginated)
router.get('/', requireAuth, (req, res) => {
    const { page = 1, limit = 50, action, resource_type, from, to } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let sql = 'SELECT * FROM audit_log_v2 WHERE user_id = ?';
    const params = [req.session.userId];

    if (action) { sql += ' AND action = ?'; params.push(action); }
    if (resource_type) { sql += ' AND resource_type = ?'; params.push(resource_type); }
    if (from) { sql += ' AND created_at >= ?'; params.push(from); }
    if (to) { sql += ' AND created_at <= ?'; params.push(to); }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const entries = db.prepare(sql).all(...params);

    // Get total count
    let countSql = 'SELECT COUNT(*) as total FROM audit_log_v2 WHERE user_id = ?';
    const countParams = [req.session.userId];
    if (action) { countSql += ' AND action = ?'; countParams.push(action); }
    if (resource_type) { countSql += ' AND resource_type = ?'; countParams.push(resource_type); }
    if (from) { countSql += ' AND created_at >= ?'; countParams.push(from); }
    if (to) { countSql += ' AND created_at <= ?'; countParams.push(to); }

    const { total } = db.prepare(countSql).get(...countParams);

    res.json({ entries, total, page: parseInt(page), limit: parseInt(limit) });
});

export default router;
