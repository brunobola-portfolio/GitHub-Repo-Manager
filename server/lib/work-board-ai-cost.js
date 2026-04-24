// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AI Assistant monthly cost tracking. Accumulates estimated spend per user
 * per month. Read by the cost-cap middleware; written by routes that make
 * provider calls.
 */

import db from '../db.js';

export function getCurrentMonthKey() {
    return new Date().toISOString().slice(0, 7);
}

export function recordSpend(userId, cents) {
    if (!Number.isFinite(cents) || cents < 0) {
        throw new Error('Cents must be non-negative');
    }
    if (cents === 0) return;
    const month = getCurrentMonthKey();
    db.prepare(`
        INSERT INTO work_board_ai_spend (user_id, month, cents)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, month) DO UPDATE SET cents = cents + excluded.cents
    `).run(userId, month, Math.round(cents));
}

export function getMonthlySpend(userId) {
    const month = getCurrentMonthKey();
    const row = db.prepare(
        'SELECT cents FROM work_board_ai_spend WHERE user_id = ? AND month = ?'
    ).get(userId, month);
    return row?.cents ?? 0;
}
