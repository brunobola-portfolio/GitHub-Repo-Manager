// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Work Board — tracked repos CRUD + prefs + undo + discover trigger.
 * Mounted at /api/v1/work-board.
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
    getTrackedRepos,
    upsertTrackedRepo,
} from '../lib/work-board-tracking.js';

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
        res.status(500).json({ error: err.message });
    }
});

export default router;
