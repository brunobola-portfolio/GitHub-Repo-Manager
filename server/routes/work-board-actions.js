// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Work Board mutation endpoints — snooze, review-action, presets, ai-summary.
 * Split from work-board.js so read and write concerns live in focused files.
 */
import express from 'express';
import { requireAuth, errorResponse, safeError } from '../middleware/auth.js';
import * as snoozeLib from '../lib/work-board-snooze.js';
import { invalidate as invalidateCache } from '../lib/work-board-cache.js';

const router = express.Router();

const VALID_SNOOZE_HOURS = new Set([1, 4, 8, 24, 72, 168, 720]);
const VALID_ITEM_TYPES = new Set(['pr', 'issue']);

function validateSnoozeBody(body) {
    const { repoFullName, itemType, itemNumber, hours } = body || {};
    if (typeof repoFullName !== 'string' || !/^[^/]+\/[^/]+$/.test(repoFullName)) return 'invalid repoFullName';
    if (!VALID_ITEM_TYPES.has(itemType)) return 'itemType must be "pr" or "issue"';
    if (!Number.isInteger(itemNumber) || itemNumber <= 0) return 'itemNumber must be a positive integer';
    if (hours !== undefined && !VALID_SNOOZE_HOURS.has(Number(hours))) {
        return `hours must be one of ${[...VALID_SNOOZE_HOURS].join(', ')}`;
    }
    return null;
}

function cacheKeyForItemType(itemType) {
    return itemType === 'pr' ? 'my_reviews' : 'my_issues';
}

router.post('/snooze', requireAuth, (req, res) => {
    try {
        const err = validateSnoozeBody(req.body);
        if (err) return errorResponse(res, 400, err);
        const { repoFullName, itemType, itemNumber, hours = 24 } = req.body;
        const result = snoozeLib.snooze({
            userId: req.session.userId, repoFullName, itemType, itemNumber, hours: Number(hours),
        });
        invalidateCache(req.session.userId, cacheKeyForItemType(itemType));
        res.json({ data: result });
    } catch (e) {
        errorResponse(res, 500, safeError(e, 'Failed to snooze'));
    }
});

router.delete('/snooze', requireAuth, (req, res) => {
    try {
        const { repoFullName, itemType, itemNumber } = req.body || {};
        if (typeof repoFullName !== 'string' || !/^[^/]+\/[^/]+$/.test(repoFullName)) return errorResponse(res, 400, 'invalid repoFullName');
        if (!VALID_ITEM_TYPES.has(itemType)) return errorResponse(res, 400, 'itemType must be "pr" or "issue"');
        if (!Number.isInteger(itemNumber) || itemNumber <= 0) return errorResponse(res, 400, 'itemNumber must be a positive integer');
        const removed = snoozeLib.unsnooze({
            userId: req.session.userId, repoFullName, itemType, itemNumber,
        });
        invalidateCache(req.session.userId, cacheKeyForItemType(itemType));
        res.json({ data: { removed } });
    } catch (e) {
        errorResponse(res, 500, safeError(e, 'Failed to unsnooze'));
    }
});

router.get('/snoozes', requireAuth, (req, res) => {
    try {
        const rows = snoozeLib.listSnoozes({ userId: req.session.userId });
        res.json({ data: rows });
    } catch (e) {
        errorResponse(res, 500, safeError(e, 'Failed to list snoozes'));
    }
});

export default router;
