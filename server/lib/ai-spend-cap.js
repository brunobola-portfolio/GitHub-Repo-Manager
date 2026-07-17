// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generalized monthly AI spend cap — a denial-of-wallet guard (OWASP LLM10)
 * for the whole AI surface, not just the Work Board (which has its own per-user
 * opt-in cap). Keyed per user per UTC-ish month in the `ai_spend` table.
 *
 * Disabled by default: self-hosted AGPL deployments keep today's opt-in-only
 * behavior (0 = unlimited) unless an operator sets an env override. Hosted
 * operation resolves a **tier-aware** cap; see resolveSpendCapCents() below.
 *
 * Mirrors the proven Work Board pattern (`work-board-ai-gate.js`) and the
 * tier-resolution pattern in `usage-meter.js`'s `checkUsageLimit()`.
 */

import db from '../db.js';
import { getUserTier } from '../middleware/require-tier.js';
import { getFeatures } from './feature-flags.js';

export const SPEND_CAP_DISABLED = 0;

const TIER_ENV_OVERRIDE = {
    free: 'AI_SPEND_CAP_CENTS_FREE',
    pro: 'AI_SPEND_CAP_CENTS_PRO',
    enterprise: 'AI_SPEND_CAP_CENTS_ENTERPRISE',
};

export function getCurrentMonthKey() {
    return new Date().toISOString().slice(0, 7);
}

/** Convert a USD cost to whole cents (rounded), clamped to >= 0. */
export function usdToCents(costUSD) {
    const cents = Math.round((Number(costUSD) || 0) * 100);
    return cents > 0 ? cents : 0;
}

/** Parse an env var into a non-negative integer cents value, or null if unset/invalid. */
function parseCapEnv(raw) {
    if (raw === undefined || raw === '') return null;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
}

/**
 * Resolve the monthly per-user spend cap (cents) for a tier. 0 = disabled.
 *
 * Resolution order:
 *   1. Tier-specific env override (AI_SPEND_CAP_CENTS_FREE/_PRO/_ENTERPRISE)
 *   2. Legacy flat env override (AI_SPEND_CAP_CENTS) — a self-hoster's
 *      one-number override-everything escape hatch, kept for back-compat.
 *   3. The tier's TIER_FEATURES default (aiSpendCapCents)
 *   4. 0 (disabled)
 */
export function resolveSpendCapCents(tier) {
    const tierEnvName = TIER_ENV_OVERRIDE[tier];
    const tierOverride = tierEnvName ? parseCapEnv(process.env[tierEnvName]) : null;
    if (tierOverride !== null) return tierOverride;

    const legacyOverride = parseCapEnv(process.env.AI_SPEND_CAP_CENTS);
    if (legacyOverride !== null) return legacyOverride;

    const tierDefault = getFeatures(tier)?.aiSpendCapCents;
    if (Number.isFinite(tierDefault) && tierDefault > 0) return tierDefault;

    return SPEND_CAP_DISABLED;
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
    const tier = getUserTier(userId);
    const capCents = resolveSpendCapCents(tier);
    if (capCents === SPEND_CAP_DISABLED) {
        return { allowed: true, capCents, spentCents: 0 };
    }
    const spentCents = getAIMonthlySpend(userId);
    return { allowed: spentCents < capCents, capCents, spentCents };
}
