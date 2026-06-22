// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generalized monthly AI spend cap — a denial-of-wallet guard (OWASP LLM10)
 * for the whole AI surface, not just the Work Board (which has its own per-user
 * opt-in cap). Keyed per user per UTC-ish month in the `ai_spend` table.
 *
 * Disabled by default: set `AI_SPEND_CAP_CENTS` to a positive monthly per-user
 * ceiling (US cents) to enforce it. 0 / unset / invalid = unlimited — so this
 * never breaks an existing deployment, but gives operators a hard cost knob.
 *
 * Mirrors the proven Work Board pattern (`work-board-ai-gate.js`); a future
 * slice can unify the two and add per-tier defaults.
 */

import db from '../db.js';

export const SPEND_CAP_DISABLED = 0;

export function getCurrentMonthKey() {
    return new Date().toISOString().slice(0, 7);
}

/** Convert a USD cost to whole cents (rounded), clamped to >= 0. */
export function usdToCents(costUSD) {
    const cents = Math.round((Number(costUSD) || 0) * 100);
    return cents > 0 ? cents : 0;
}

/** Resolve the monthly per-user cap (cents) from env. 0 = disabled. */
export function resolveSpendCapCents() {
    const raw = Number.parseInt(process.env.AI_SPEND_CAP_CENTS ?? '', 10);
    if (!Number.isFinite(raw) || raw < 0) return SPEND_CAP_DISABLED;
    return raw;
}

/** Accumulate a call's cost into the user's running monthly spend. No-op for
 *  zero / unknown cost (e.g. a provider/model without pricing data). */
export function recordAISpend(userId, costUSD) {
    const cents = usdToCents(costUSD);
    if (cents <= 0) return;
    db.prepare(`
        INSERT INTO ai_spend (user_id, month, cents)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, month) DO UPDATE SET cents = cents + excluded.cents
    `).run(userId, getCurrentMonthKey(), cents);
}

/** Current month's spend for a user, in cents. */
export function getAIMonthlySpend(userId) {
    const row = db.prepare(
        'SELECT cents FROM ai_spend WHERE user_id = ? AND month = ?',
    ).get(userId, getCurrentMonthKey());
    return row?.cents ?? 0;
}

/**
 * Decide whether a user may make another AI call under the monthly spend cap.
 * Short-circuits (no DB read) when the cap is disabled.
 * @returns {{ allowed: boolean, capCents: number, spentCents: number }}
 */
export function checkAISpendCap(userId) {
    const capCents = resolveSpendCapCents();
    if (capCents === SPEND_CAP_DISABLED) {
        return { allowed: true, capCents, spentCents: 0 };
    }
    const spentCents = getAIMonthlySpend(userId);
    return { allowed: spentCents < capCents, capCents, spentCents };
}
