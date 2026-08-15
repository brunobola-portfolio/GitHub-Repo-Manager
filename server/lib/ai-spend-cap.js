// SPDX-License-Identifier: Apache-2.0
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

// 1 cent = 10,000 micro-cents. Fine enough that every realistic per-call cost
// is an exact integer (a $0.0004 call is 4,000 micro-cents, not a rounding
// artifact), and integer arithmetic throughout so accumulated spend can never
// drift the way a floating-point column would.
const MICRO_CENTS_PER_CENT = 10_000;

/** Convert a USD cost to micro-cents, clamped to >= 0. */
export function usdToMicroCents(costUSD) {
    const micro = Math.round((Number(costUSD) || 0) * 100 * MICRO_CENTS_PER_CENT);
    return micro > 0 ? micro : 0;
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
 *  zero / unknown cost (e.g. a provider/model without pricing data).
 *
 *  Accumulates in micro-cents. Rounding each call to whole cents first meant
 *  every sub-half-cent call recorded 0, so thousands of flash-model calls
 *  summed to a recorded spend of zero and the cap never fired. */
export function recordAISpend(userId, costUSD) {
    const micro = usdToMicroCents(costUSD);
    if (micro <= 0) return;
    db.prepare(`
        INSERT INTO ai_spend (user_id, month, cents, micro_cents)
        VALUES (?, ?, 0, ?)
        ON CONFLICT(user_id, month) DO UPDATE SET micro_cents = micro_cents + excluded.micro_cents
    `).run(userId, getCurrentMonthKey(), micro);
}

/** Current month's spend for a user, in whole cents.
 *
 *  `cents` is the pre-migration-33 baseline and is never written again; new
 *  spend lands in `micro_cents`. Summing both preserves historical spend
 *  without double-counting it. Floor, not round, so a user is never denied
 *  over a fraction of a cent they have not actually spent. */
export function getAIMonthlySpend(userId) {
    const row = db.prepare(
        'SELECT cents, micro_cents FROM ai_spend WHERE user_id = ? AND month = ?',
    ).get(userId, getCurrentMonthKey());
    if (!row) return 0;
    return (row.cents ?? 0) + Math.floor((row.micro_cents ?? 0) / MICRO_CENTS_PER_CENT);
}

/** Exact current-month spend in micro-cents — for metrics and diagnostics,
 *  where sub-cent precision is the whole point of the column. */
export function getAIMonthlySpendMicroCents(userId) {
    const row = db.prepare(
        'SELECT cents, micro_cents FROM ai_spend WHERE user_id = ? AND month = ?',
    ).get(userId, getCurrentMonthKey());
    if (!row) return 0;
    return (row.cents ?? 0) * MICRO_CENTS_PER_CENT + (row.micro_cents ?? 0);
}

/**
 * Decide whether a user may make another AI call under the monthly spend cap.
 * Short-circuits (no DB read) when the cap is disabled.
 * @returns {{ allowed: boolean, capCents: number, spentCents: number }}
 */
export function checkAISpendCap(userId, { billsOperator = true } = {}) {
    // BYOK calls cost the operator nothing, so the operator's ceiling must not
    // apply to them. Callers pass billsOperator=false when the request used the
    // user's own provider key (see isServerKeyProvider in lib/ai-provider.js).
    // Defaults to true so an un-updated caller stays metered.
    if (!billsOperator) {
        return { allowed: true, capCents: SPEND_CAP_DISABLED, spentCents: 0 };
    }
    const tier = getUserTier(userId);
    const capCents = resolveSpendCapCents(tier);
    if (capCents === SPEND_CAP_DISABLED) {
        return { allowed: true, capCents, spentCents: 0 };
    }
    const spentCents = getAIMonthlySpend(userId);
    return { allowed: spentCents < capCents, capCents, spentCents };
}
