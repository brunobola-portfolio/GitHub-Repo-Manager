import { Router } from 'express';
import db from '../db.js';
import { requireAuth, safeError } from '../middleware/auth.js';
import { auditLog } from '../lib/audit.js';
import { buildNotificationsDigest, markNotificationsSeen } from '../lib/notifications-digest.js';

const router = Router();

/**
 * GET /api/notifications/digest
 *
 * Returns categorised activity since the user last opened the bell. First
 * call seeds the window to NOW − 7d; subsequent calls scope to whatever
 * /mark-seen recorded last.
 */
router.get('/digest', requireAuth, (req, res) => {
    try {
        const userId = req.session.userId;
        const row = db
            .prepare('SELECT username, notifications_last_seen_at FROM users WHERE id = ?')
            .get(userId);
        const digest = buildNotificationsDigest(userId, {
            login: row?.username ?? null,
            last_seen_at: row?.notifications_last_seen_at ?? null,
        });
        res.json(digest);
    } catch (error) {
        req.log.error({ err: error }, 'notifications.digest failed');
        res.status(500).json({ error: safeError(error, 'Failed to compute notifications digest') });
    }
});

/**
 * POST /api/notifications/mark-seen
 *
 * Idempotent — sets notifications_last_seen_at to NOW. Returns 204.
 */
router.post('/mark-seen', requireAuth, (req, res) => {
    try {
        markNotificationsSeen(req.session.userId);
        auditLog(req, 'notifications.mark_seen', 'notifications', null, {});
        res.status(204).end();
    } catch (error) {
        req.log.error({ err: error }, 'notifications.mark-seen failed');
        res.status(500).json({ error: safeError(error, 'Failed to mark notifications as seen') });
    }
});

export default router;
