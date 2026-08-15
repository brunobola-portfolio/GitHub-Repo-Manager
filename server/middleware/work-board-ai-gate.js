// SPDX-License-Identifier: Apache-2.0
/**
 * Gate for Work Board AI Assistant endpoints. Applies in this order:
 *   1. Feature flag (WORK_BOARD_AI_ENABLED env var) → 404 when off
 *   2. User opt-in (work_board_prefs.ai_assistant_enabled) → 403 when off
 *   3. Monthly cost cap → 429 when hit
 */

import db from '../db.js';

export function requireWorkBoardAI(req, res, next) {
    if (process.env.WORK_BOARD_AI_ENABLED !== 'true') {
        return res.status(404).json({ code: 'AI_FEATURE_FLAG_OFF', error: 'AI Assistant is not enabled on this deployment' });
    }

    const userId = req.session?.userId;
    if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const prefs = db.prepare(
        'SELECT ai_assistant_enabled, ai_monthly_cap_cents, ai_response_locale FROM work_board_prefs WHERE user_id = ?'
    ).get(userId);

    if (!prefs || prefs.ai_assistant_enabled !== 1) {
        return res.status(403).json({
            code: 'AI_ASSISTANT_DISABLED',
            error: 'Enable AI Assistant in Settings first',
        });
    }

    if (prefs.ai_monthly_cap_cents > 0) {
        const month = new Date().toISOString().slice(0, 7);
        const spendRow = db.prepare(
            'SELECT cents FROM work_board_ai_spend WHERE user_id = ? AND month = ?'
        ).get(userId, month);
        const spent = spendRow?.cents ?? 0;
        if (spent >= prefs.ai_monthly_cap_cents) {
            return res.status(429).json({
                code: 'AI_COST_CAP_REACHED',
                error: 'Monthly AI limit reached',
                spent_cents: spent,
                cap_cents: prefs.ai_monthly_cap_cents,
            });
        }
    }

    req.aiPrefs = prefs;
    next();
}
