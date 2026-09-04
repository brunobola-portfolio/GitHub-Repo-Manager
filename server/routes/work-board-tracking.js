// SPDX-License-Identifier: Apache-2.0
/**
 * Work Board — tracked repos CRUD + prefs + undo + discover trigger.
 * Mounted at /api/v1/work-board.
 */

import express from 'express';
import { requireAuth, safeError } from '../middleware/auth.js';
import {
    getTrackedRepos,
    upsertTrackedRepo,
    bulkUpdate,
    getPrefs,
    patchPrefs,
} from '../lib/work-board-tracking.js';
import { undoOperation } from '../lib/work-board-undo-log.js';
import { runDiscovery } from '../lib/work-board-discovery.js';
import logger from '../lib/logger.js';
import db from '../db.js';

const router = express.Router();

const REPO_FULL_NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}\/[a-zA-Z0-9_.-]{1,100}$/;
const VALID_ACTIONS_SET = new Set(['pin', 'unpin', 'mute', 'unmute', 'track', 'untrack']);

// GET /tracked-repos
router.get('/tracked-repos', requireAuth, (req, res) => {
    const { search, signal, org, muted, pinned, limit, offset } = req.query;
    const filters = {
        search: search || undefined,
        signal: signal || undefined,
        org: org || undefined,
        muted: muted === 'true' ? true : muted === 'false' ? false : undefined,
        pinned: pinned === 'true' ? true : pinned === 'false' ? false : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
    };
    const result = getTrackedRepos(req.session.userId, filters);
    res.json(result);
});

// POST /tracked-repos (single action)
router.post('/tracked-repos', requireAuth, (req, res) => {
    const { repo, action } = req.body ?? {};
    if (!repo || typeof repo !== 'string' || !REPO_FULL_NAME_RE.test(repo)) {
        return res.status(400).json({ error: 'Invalid or missing repo (expected owner/repo)' });
    }
    if (!VALID_ACTIONS_SET.has(action)) {
        return res.status(400).json({ error: `Invalid action; expected one of ${[...VALID_ACTIONS_SET].join(', ')}` });
    }

    try {
        const result = upsertTrackedRepo(req.session.userId, repo, action);
        res.json({ operation_id: result.operationId, new_state: result.newState });
    } catch (err) {
        logger.error({ err, userId: req.session.userId, repo, action }, 'tracked-repos upsert failed');
        res.status(500).json({ error: safeError(err, 'Failed to update tracked repo') });
    }
});

// POST /tracked-repos/bulk
router.post('/tracked-repos/bulk', requireAuth, (req, res) => {
    const { repos, action } = req.body ?? {};
    if (!Array.isArray(repos)) {
        return res.status(400).json({ error: 'repos must be an array' });
    }
    if (repos.length > 200) {
        return res.status(400).json({ error: 'Bulk size exceeds 200' });
    }
    if (!VALID_ACTIONS_SET.has(action)) {
        return res.status(400).json({ error: 'Invalid action' });
    }

    const valid = repos.filter(r => typeof r === 'string' && REPO_FULL_NAME_RE.test(r));

    try {
        const result = bulkUpdate(req.session.userId, valid, action);
        res.json({
            operation_id: result.operationId,
            updated: result.updated,
            skipped: result.skipped,
        });
    } catch (err) {
        logger.error({ err, userId: req.session.userId, action, count: valid.length }, 'tracked-repos bulk update failed');
        res.status(500).json({ error: safeError(err, 'Bulk update failed') });
    }
});

// GET /prefs
router.get('/prefs', requireAuth, (req, res) => {
    const prefs = getPrefs(req.session.userId);
    res.json(prefs);
});

// PATCH /prefs
router.patch('/prefs', requireAuth, (req, res) => {
    try {
        const merged = patchPrefs(req.session.userId, req.body ?? {});
        res.json(merged);
    } catch (err) {
        // patchPrefs throws Error with safe, user-facing messages for invalid
        // shape (e.g. "discovery_window_days must be 30..180"). Surface them.
        const userMsg = err?.message && err.message.length < 200 ? err.message : 'Invalid prefs payload';
        logger.warn({ err: err?.message, userId: req.session.userId }, 'patchPrefs failed');
        res.status(400).json({ error: userMsg, code: 'invalid_prefs' });
    }
});

// POST /undo/:operation_id
router.post('/undo/:operation_id', requireAuth, (req, res) => {
    const { operation_id } = req.params;
    try {
        const { operationType, beforeState, afterState } = undoOperation(req.session.userId, operation_id);

        // An undo replays a bulk op, so both loops are BULK_MAX-sized (200).
        // Compile once, outside the transaction callback.
        const deleteRow = db.prepare(
            'DELETE FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?'
        );
        const restoreRow = db.prepare(`
            INSERT INTO work_board_tracked_repos
                (user_id, repo_full_name, source_signal, is_pinned, is_muted, last_synced_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, repo_full_name) DO UPDATE SET
                is_pinned = excluded.is_pinned,
                is_muted = excluded.is_muted,
                last_synced_at = CURRENT_TIMESTAMP
        `);

        const applyTx = db.transaction(() => {
            const beforeNames = new Set(beforeState.map(r => r.repo_full_name));

            // Delete rows that were created by the original op
            // (present in after_state but absent from before_state)
            for (const a of afterState) {
                if (!beforeNames.has(a.repo_full_name)) {
                    deleteRow.run(req.session.userId, a.repo_full_name);
                }
            }

            // Restore before_state rows
            for (const row of beforeState) {
                restoreRow.run(
                    req.session.userId,
                    row.repo_full_name,
                    row.source_signal ?? 'pinned',
                    row.is_pinned,
                    row.is_muted,
                );
            }
        });
        applyTx();

        res.json({ reverted: true, operation_type: operationType });
    } catch (err) {
        // undoOperation tags expected errors with `code` so we don't have to
        // grep err.message for control flow. Fall back to message-match for
        // legacy callers, but prefer the typed code.
        const isNotFound = err?.code === 'undo_not_found' || err?.code === 'undo_expired'
            || /not found|expired/i.test(err?.message || '');
        if (isNotFound) {
            return res.status(404).json({ error: safeError(err, 'Undo operation not found or expired'), code: 'undo_not_found' });
        }
        logger.error({ err, userId: req.session.userId, operation_id }, 'undoOperation failed');
        res.status(500).json({ error: safeError(err, 'Failed to undo operation') });
    }
});

// GET /ping — first-visit auto-migration + stale-while-revalidate discovery trigger
const TWENTY_FOUR_HOURS_MS = 24 * 3600 * 1000;

router.get('/ping', requireAuth, (req, res) => {
    // Ensure prefs row exists — patchPrefs with empty object is a cheap upsert
    patchPrefs(req.session.userId, {});
    const prefs = getPrefs(req.session.userId);

    const lastMs = prefs.last_discovery_at ? new Date(prefs.last_discovery_at).getTime() : 0;
    const isStale = (Date.now() - lastMs) > TWENTY_FOUR_HOURS_MS;
    let discoveryInFlight = false;

    if (isStale && req.session.accessToken) {
        discoveryInFlight = true;
        // fire-and-forget
        runDiscovery(req.session.userId, req.session.accessToken, prefs)
            .catch(err => logger.warn({ err, userId: req.session.userId }, 'background discovery failed'));
    }

    res.json({ prefs, discovery_in_flight: discoveryInFlight });
});

// GET /repo-search?q=<query>
router.get('/repo-search', requireAuth, (req, res) => {
    const q = (req.query.q ?? '').toString().trim();
    if (!q) return res.json({ tracked: [], untracked: [] });

    const like = `%${q.toLowerCase()}%`;
    const prefixLike = `${q.toLowerCase()}%`;

    const tracked = db.prepare(`
        SELECT repo_full_name, source_signal, is_pinned, is_muted, last_activity_at
        FROM work_board_tracked_repos
        WHERE user_id = ? AND LOWER(repo_full_name) LIKE ?
        ORDER BY
            CASE WHEN LOWER(repo_full_name) LIKE ? THEN 0 ELSE 1 END,
            last_activity_at DESC
        LIMIT 20
    `).all(req.session.userId, like, prefixLike);

    res.json({ tracked, untracked: [] });
});

// POST /discover
router.post('/discover', requireAuth, async (req, res) => {
    const prefs = getPrefs(req.session.userId);
    try {
        const result = await runDiscovery(
            req.session.userId,
            req.session.accessToken,
            prefs,
        );
        res.json(result);
    } catch (err) {
        logger.error({ err, userId: req.session.userId }, 'discovery failed');
        res.status(500).json({ error: safeError(err, 'Discovery failed') });
    }
});

export default router;
