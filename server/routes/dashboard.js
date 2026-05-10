// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from 'express';
import { requireAuth, safeError } from '../middleware/auth.js';
import { composeInbox } from '../lib/dashboard-aggregator.js';

const router = Router();

router.get('/inbox', requireAuth, (req, res) => {
    try {
        const sections = req.query.sections
            ? String(req.query.sections).split(',').map(s => s.trim()).filter(Boolean)
            : undefined;
        const includeArchived = req.query.include_archived === '1';

        const result = composeInbox(req.session.userId, {
            userLogin: req.session.userLogin,
            sections,
            includeArchived,
        });
        res.json(result);
    } catch (err) {
        req.log?.error?.({ err }, 'dashboard inbox failed');
        res.status(500).json({ error: safeError(err, 'Failed to compose inbox') });
    }
});

export default router;
