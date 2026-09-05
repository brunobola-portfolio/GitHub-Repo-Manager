import { Router } from 'express';
import db from '../db.js';
import { requireAuth, safeError } from '../middleware/auth.js';
import { auditLog } from '../lib/audit.js';
import { buildNotificationsDigest, markNotificationsSeen } from '../lib/notifications-digest.js';
import { verifyUnsubscribeToken } from '../lib/digest-unsubscribe-token.js';
import { sendError } from '../lib/response-shapes.js';

const router = Router();

const DIGEST_FREQUENCIES = new Set(['off', 'daily', 'weekly']);

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

/**
 * GET /api/notifications/digest/settings
 *
 * G7 — the opt-in digest e-mail frequency for the current user.
 */
router.get('/digest/settings', requireAuth, (req, res) => {
    try {
        const row = db.prepare('SELECT digest_frequency FROM users WHERE id = ?').get(req.session.userId);
        res.json({ frequency: row?.digest_frequency || 'off' });
    } catch (error) {
        req.log.error({ err: error }, 'notifications.digest-settings-get failed');
        sendError(res, 500, safeError(error, 'Failed to load digest settings'));
    }
});

/**
 * PATCH /api/notifications/digest/settings
 *
 * Body: { frequency: 'off' | 'daily' | 'weekly' }
 */
router.patch('/digest/settings', requireAuth, (req, res) => {
    const { frequency } = req.body || {};
    if (!DIGEST_FREQUENCIES.has(frequency)) {
        return sendError(res, 400, 'frequency must be one of: off, daily, weekly');
    }
    try {
        db.prepare('UPDATE users SET digest_frequency = ? WHERE id = ?').run(frequency, req.session.userId);
        auditLog(req, 'notifications.digest_frequency_updated', 'user', req.session.userId, { frequency });
        res.json({ frequency });
    } catch (error) {
        req.log.error({ err: error }, 'notifications.digest-settings-patch failed');
        sendError(res, 500, safeError(error, 'Failed to update digest settings'));
    }
});

// Minimal standalone confirmation page — this link is opened straight from a
// mail client, never from inside the app, so it cannot assume any app chrome,
// script bundle, or session is available.
function unsubscribePage({ ok }) {
    const heading = ok ? 'You have been unsubscribed' : 'This unsubscribe link is invalid or expired';
    const body = ok
        ? 'You will no longer receive the GitHub Repo Manager digest e-mail. You can turn it back on any time from Settings.'
        : 'If you still want to stop the digest e-mail, sign in and turn it off from Settings, or request a fresh link from a more recent digest.';
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${heading}</title></head>
<body style="font-family: sans-serif; max-width: 480px; margin: 80px auto; padding: 0 24px; color: #222; text-align: center;">
  <h1 style="font-size: 20px;">${heading}</h1>
  <p style="color: #555;">${body}</p>
</body>
</html>`;
}

/**
 * GET /api/notifications/digest/unsubscribe?token=...
 *
 * G7 one-click unsubscribe — deliberately NOT behind requireAuth: the
 * recipient clicking this link from their mail client has no session for
 * this app. The signed token (server/lib/digest-unsubscribe-token.js) is
 * the only proof of identity, and it can only ever turn the setting OFF.
 */
router.get('/digest/unsubscribe', (req, res) => {
    const userId = verifyUnsubscribeToken(req.query.token);
    if (userId == null) {
        return res.status(400).type('html').send(unsubscribePage({ ok: false }));
    }
    try {
        db.prepare("UPDATE users SET digest_frequency = 'off' WHERE id = ?").run(userId);
        res.type('html').send(unsubscribePage({ ok: true }));
    } catch (error) {
        req.log.error({ err: error }, 'notifications.digest-unsubscribe failed');
        res.status(500).type('html').send(unsubscribePage({ ok: false }));
    }
});

export default router;
