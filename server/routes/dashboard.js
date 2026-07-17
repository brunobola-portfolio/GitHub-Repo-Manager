// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from 'express';
import { requireAuth, safeError } from '../middleware/auth.js';
import { composeInbox } from '../lib/dashboard-aggregator.js';
import db from '../db.js';

const router = Router();

// Inbox item ids are always minted server-side by dashboard-aggregator.js as
// `pr:{owner}/{repo}#{number}` or `issue:{owner}/{repo}#{number}` — never
// user-composed. The archive/restore/snooze routes accept an arbitrary
// client-supplied `:itemId`, so validate against that exact shape (plus a
// length cap) before it reaches a write query; otherwise any opaque string
// is silently persisted, allowing unbounded junk rows in
// `dashboard_inbox_state`.
const ITEM_ID_PATTERN = /^(pr|issue):[^/]+\/[^#]+#\d+$/;
const ITEM_ID_MAX_LENGTH = 512;

function isValidItemId(itemId) {
    return typeof itemId === 'string'
        && itemId.length > 0
        && itemId.length <= ITEM_ID_MAX_LENGTH
        && ITEM_ID_PATTERN.test(itemId);
}

router.get('/inbox', requireAuth, async (req, res) => {
    try {
        const sections = req.query.sections
            ? String(req.query.sections).split(',').map(s => s.trim()).filter(Boolean)
            : undefined;
        const includeArchived = req.query.include_archived === '1';

        const userLogin = req.session.userLogin;
        if (!userLogin) {
            req.log?.warn?.({ userId: req.session.userId }, 'inbox requested with no userLogin in session');
        }
        const result = await composeInbox(req.session.userId, {
            userLogin,
            token: req.session.accessToken || null,
            sections,
            includeArchived,
            logger: req.log,
        });
        res.json(result);
    } catch (err) {
        req.log?.error?.({ err }, 'dashboard inbox failed');
        res.status(500).json({ error: safeError(err, 'Failed to compose inbox') });
    }
});

router.post('/inbox/:itemId/archive', requireAuth, (req, res) => {
    try {
        const itemId = decodeURIComponent(req.params.itemId);
        if (!isValidItemId(itemId)) {
            return res.status(400).json({ error: 'Invalid item id' });
        }
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO dashboard_inbox_state (user_id, item_id, archived_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, item_id) DO UPDATE SET archived_at = excluded.archived_at
        `).run(req.session.userId, itemId, now);
        res.json({ ok: true });
    } catch (err) {
        req.log?.error?.({ err }, 'archive failed');
        res.status(500).json({ error: safeError(err, 'Failed to archive') });
    }
});

router.post('/inbox/:itemId/restore', requireAuth, (req, res) => {
    try {
        const itemId = decodeURIComponent(req.params.itemId);
        if (!isValidItemId(itemId)) {
            return res.status(400).json({ error: 'Invalid item id' });
        }
        db.prepare(`
            UPDATE dashboard_inbox_state
            SET archived_at = NULL, snoozed_until = NULL
            WHERE user_id = ? AND item_id = ?
        `).run(req.session.userId, itemId);
        res.json({ ok: true });
    } catch (err) {
        req.log?.error?.({ err }, 'restore failed');
        res.status(500).json({ error: safeError(err, 'Failed to restore') });
    }
});

router.post('/inbox/:itemId/snooze', requireAuth, (req, res) => {
    try {
        const itemId = decodeURIComponent(req.params.itemId);
        if (!isValidItemId(itemId)) {
            return res.status(400).json({ error: 'Invalid item id' });
        }
        const until = req.body?.until;
        const ts = Date.parse(until);
        if (!until || Number.isNaN(ts)) {
            return res.status(400).json({ error: 'Invalid ISO timestamp in `until`' });
        }
        if (ts <= Date.now()) {
            return res.status(400).json({ error: '`until` must be in the future' });
        }
        db.prepare(`
            INSERT INTO dashboard_inbox_state (user_id, item_id, snoozed_until)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, item_id) DO UPDATE SET snoozed_until = excluded.snoozed_until
        `).run(req.session.userId, itemId, until);
        res.json({ ok: true });
    } catch (err) {
        req.log?.error?.({ err }, 'snooze failed');
        res.status(500).json({ error: safeError(err, 'Failed to snooze') });
    }
});

export default router;
