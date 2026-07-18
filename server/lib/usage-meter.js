import db from '../db.js';
import { getUserTier } from '../middleware/require-tier.js';
import { getFeatures } from './feature-flags.js';

/**
 * Returns the `{ start, end }` ISO bounds of the calendar month that contains
 * `now`, computed in **UTC** so the monthly quota boundary (AI queries +
 * metered migrations) is a single global instant rather than the host server's
 * local midnight. A non-UTC server otherwise misbuckets usage near the month
 * rollover, and a TZ change between read and write could split a user's month.
 *
 * `period_start` is part of the `usage_metrics` unique key (ON CONFLICT) and
 * the `getCurrentUsage` lookup key, so both read and write share this function
 * and stay consistent.
 *
 * Exported (with an injectable `now`) for boundary unit tests.
 */
export function getCurrentPeriod(now = new Date()) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const start = new Date(Date.UTC(year, month, 1)).toISOString();
    const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59)).toISOString();
    return { start, end };
}

export function incrementUsage(userId, metricType) {
    const { start, end } = getCurrentPeriod();
    db.prepare(`
        INSERT INTO usage_metrics (user_id, metric_type, count, period_start, period_end)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(user_id, metric_type, period_start) DO UPDATE SET
            count = count + 1, updated_at = datetime('now')
    `).run(userId, metricType, start, end);
}

export function getCurrentUsage(userId, metricType) {
    const { start } = getCurrentPeriod();
    const row = db.prepare(
        'SELECT count FROM usage_metrics WHERE user_id = ? AND metric_type = ? AND period_start = ?'
    ).get(userId, metricType, start);
    return row?.count || 0;
}

// Maps a usage metric to the tier-feature key that bounds it.
// New per-feature Free-tier metrics let us enforce meaningful trial caps
// (e.g. 5 README generations / month) independently of the global ai_queries quota.
const METRIC_TO_FEATURE = {
    ai_queries: 'aiQueriesPerMonth',
    repos_managed: 'maxRepos',
    ai_readme: 'readmeGenPerMonth',
    ai_commit: 'commitGenPerMonth',
    ai_insights: 'repoInsightsPerMonth',
    ai_migration_risk: 'migrationRiskPerMonth',
    ai_semantic_search: 'semanticSearchPerMonth',
    migration_assist: 'migrationAssistPerMonth',
    // Non-AI: Free gets N full (non-dry-run) migrations per calendar month.
    migration_full_executions: 'migrationFullPerMonth',
    // 2026-07-18 rebalance: Deep Review / PR Chat / PR Commands / Prompt
    // Studio "test preset" moved off the Pro paywall to Free, each with its
    // own per-feature monthly cap (mirrors the ai_readme/ai_commit pattern).
    ai_deep_review: 'deepReviewPerMonth',
    ai_pr_chat: 'prChatMessagesPerMonth',
    ai_pr_command: 'prCommandPerMonth',
    ai_prompt_test: 'promptStudioTestPerMonth',
    // Mirror sync APPLY moved to Free but newly metered — mirrors
    // migration_full_executions's pattern exactly.
    sync_apply_executions: 'syncApplyPerMonth',
    // Tier-independent daily anti-abuse ceiling on destructive bulk ops
    // (delete/transfer). Metered via the DAILY-window helpers below, not
    // checkUsageLimit()/incrementUsage() (which are monthly-only).
    bulk_destructive_daily: 'bulkDestructiveDailyMax',
};

export function checkUsageLimit(userId, metricType) {
    const tier = getUserTier(userId);
    const features = getFeatures(tier);
    const featureKey = METRIC_TO_FEATURE[metricType] || metricType;
    const limit = features[featureKey] ?? Infinity;
    const current = getCurrentUsage(userId, metricType);
    return {
        allowed: current < limit,
        current,
        limit,
        remaining: Math.max(0, limit - current),
    };
}

// Check both a per-feature cap AND the global ai_queries cap.
// Returns the first limit that would be exceeded, so error messages can
// point the user at the specific quota they hit.
export function checkAIFeatureLimit(userId, featureMetric) {
    const featureCheck = checkUsageLimit(userId, featureMetric);
    if (!featureCheck.allowed) return { ...featureCheck, metric: featureMetric };
    const globalCheck = checkUsageLimit(userId, 'ai_queries');
    if (!globalCheck.allowed) return { ...globalCheck, metric: 'ai_queries' };
    return { ...featureCheck, metric: featureMetric };
}

// Increment the feature-specific counter AND the global ai_queries counter in a
// single transaction so the two rows never drift on a partial write (crash,
// OS-level sqlite sync failure, etc).
const incrementAIUsageTxn = db.transaction((userId, featureMetric) => {
    if (featureMetric && featureMetric !== 'ai_queries') {
        incrementUsage(userId, featureMetric);
    }
    incrementUsage(userId, 'ai_queries');
});

export function incrementAIUsage(userId, featureMetric) {
    incrementAIUsageTxn(userId, featureMetric);
}

// ---------------------------------------------------------------------------
// Atomic guarded increment — closes the check-then-increment TOCTOU race that
// checkUsageLimit()/incrementUsage() (and checkAIFeatureLimit()/
// incrementAIUsage()) have whenever a slow provider call sits between the
// (read-only) check and the (write) increment: N concurrent requests can all
// read count < limit before any of them writes, letting all N through even
// though only `limit - count` should have been allowed.
//
// Mirrors `chargeMigrationQuotaTxn` (server/routes/migration.js): a single
// guarded UPDATE (`WHERE count < ?`) so the check-and-increment is one atomic
// step. Call BEFORE the guarded work (e.g. the AI provider call); on failure,
// call the matching release function to give the unit(s) back (compensating
// decrement) so a failed call doesn't permanently burn the user's quota.
//
// These are additive, opt-in primitives for new/updated call sites.
// checkUsageLimit()/incrementUsage()/checkAIFeatureLimit()/incrementAIUsage()
// above are UNCHANGED — every existing caller keeps working exactly as before.
// ---------------------------------------------------------------------------

// SQLite bind parameters can't be Infinity (better-sqlite3 rejects non-finite
// numbers); substitute a ceiling no real monthly count will ever reach so an
// "unlimited" tier's guarded UPDATE is still functionally unlimited.
const UNBOUNDED_LIMIT = Number.MAX_SAFE_INTEGER;

function guardedBump(userId, metricType, start, end, limit) {
    db.prepare(`
        INSERT INTO usage_metrics (user_id, metric_type, count, period_start, period_end)
        VALUES (?, ?, 0, ?, ?)
        ON CONFLICT(user_id, metric_type, period_start) DO NOTHING
    `).run(userId, metricType, start, end);
    return db.prepare(`
        UPDATE usage_metrics SET count = count + 1, updated_at = datetime('now')
        WHERE user_id = ? AND metric_type = ? AND period_start = ? AND count < ?
    `).run(userId, metricType, start, limit);
}

function guardedUnbump(userId, metricType, start) {
    db.prepare(`
        UPDATE usage_metrics SET count = MAX(0, count - 1), updated_at = datetime('now')
        WHERE user_id = ? AND metric_type = ? AND period_start = ?
    `).run(userId, metricType, start);
}

const guardedIncrementTxn = db.transaction(guardedBump);

/**
 * Atomically check-and-consume one unit of `metricType` for `userId`, gated
 * by the tier's resolved limit. Returns the same `{ allowed, current, limit,
 * remaining }` shape as checkUsageLimit(), except when `allowed` is true the
 * increment has ALREADY happened — callers must NOT also call incrementUsage()
 * for this unit, and MUST call releaseGuardedIncrement() if the work that
 * consumed the unit subsequently fails.
 */
export function guardedIncrement(userId, metricType) {
    const tier = getUserTier(userId);
    const features = getFeatures(tier);
    const featureKey = METRIC_TO_FEATURE[metricType] || metricType;
    const limit = features[featureKey] ?? Infinity;
    const { start, end } = getCurrentPeriod();
    const boundLimit = Number.isFinite(limit) ? limit : UNBOUNDED_LIMIT;

    const r = guardedIncrementTxn(userId, metricType, start, end, boundLimit);
    const current = getCurrentUsage(userId, metricType);
    return {
        allowed: r.changes > 0,
        current,
        limit,
        remaining: Number.isFinite(limit) ? Math.max(0, limit - current) : Infinity,
    };
}

/**
 * Compensating decrement — releases one unit reserved by guardedIncrement()
 * when the work it guarded (e.g. an AI provider call) fails after the
 * reservation succeeded. Floors at 0 so a double-release can't go negative.
 */
export function releaseGuardedIncrement(userId, metricType) {
    const { start } = getCurrentPeriod();
    guardedUnbump(userId, metricType, start);
}

// Atomic analogue of incrementAIUsage(): reserves one unit of BOTH the
// feature metric and the global ai_queries counter in a single transaction.
// If either is at its limit, NEITHER is incremented (full rollback) and the
// blocking metric is reported.
const guardedIncrementAIUsageTxn = db.transaction((userId, featureMetric, start, end, featureLimit, queriesLimit) => {
    const hasFeature = !!featureMetric && featureMetric !== 'ai_queries';
    if (hasFeature) {
        const fr = guardedBump(userId, featureMetric, start, end, featureLimit);
        if (fr.changes === 0) return { blockedOn: featureMetric };
    }
    const qr = guardedBump(userId, 'ai_queries', start, end, queriesLimit);
    if (qr.changes === 0) {
        if (hasFeature) guardedUnbump(userId, featureMetric, start);
        return { blockedOn: 'ai_queries' };
    }
    return { blockedOn: null };
});

/**
 * Atomic analogue of checkAIFeatureLimit() + incrementAIUsage(): reserves one
 * unit of `featureMetric` AND the global `ai_queries` counter atomically,
 * gated by both limits — mirroring incrementAIUsage()'s existing pairing, but
 * BEFORE the provider call instead of after. Returns `{ allowed, metric,
 * current, limit, remaining }` (same shape checkAIFeatureLimit() returns, so
 * `quotaExceededResponse()` accepts it unchanged). Call
 * releaseGuardedAIUsage() if the guarded work subsequently fails.
 */
export function guardedIncrementAIUsage(userId, featureMetric) {
    const { start, end } = getCurrentPeriod();
    const tier = getUserTier(userId);
    const features = getFeatures(tier);
    const featureLimit = features[METRIC_TO_FEATURE[featureMetric] || featureMetric] ?? Infinity;
    const queriesLimit = features[METRIC_TO_FEATURE.ai_queries] ?? Infinity;
    const fBound = Number.isFinite(featureLimit) ? featureLimit : UNBOUNDED_LIMIT;
    const qBound = Number.isFinite(queriesLimit) ? queriesLimit : UNBOUNDED_LIMIT;

    const result = guardedIncrementAIUsageTxn(userId, featureMetric, start, end, fBound, qBound);
    const metric = result.blockedOn || featureMetric;
    const limit = metric === 'ai_queries' ? queriesLimit : featureLimit;
    const current = getCurrentUsage(userId, metric);
    return {
        allowed: !result.blockedOn,
        metric,
        current,
        limit,
        remaining: Number.isFinite(limit) ? Math.max(0, limit - current) : Infinity,
    };
}

/**
 * Release the unit(s) reserved by guardedIncrementAIUsage() when the AI call
 * it guarded fails. Mirrors incrementAIUsage()'s pairing: releases BOTH the
 * feature metric (if any) and the global ai_queries counter.
 */
export function releaseGuardedAIUsage(userId, featureMetric) {
    const { start } = getCurrentPeriod();
    if (featureMetric && featureMetric !== 'ai_queries') guardedUnbump(userId, featureMetric, start);
    guardedUnbump(userId, 'ai_queries', start);
}

// Build a standard 429 error body for quota-exceeded responses.
// All AI endpoints should use this so clients can parse a consistent shape
// (error, message, metric, limit, current, remaining, upgradeUrl).
const FEATURE_LABELS = {
    ai_readme: 'README Generator',
    ai_commit: 'Commit Generator',
    ai_insights: 'Repo Insights',
    ai_migration_risk: 'Migration Risk Analysis',
    ai_semantic_search: 'Semantic Search',
    ai_deep_review: 'AI Deep Review',
    ai_pr_chat: 'PR Chat',
    ai_pr_command: 'PR Commands',
    ai_prompt_test: 'Prompt Studio Test',
    sync_apply_executions: 'Mirror Sync',
    bulk_destructive_daily: 'Bulk Delete/Transfer',
};

export function quotaExceededResponse(check, fallbackLabel = 'AI') {
    const isFeature = check.metric && check.metric !== 'ai_queries';
    const label = FEATURE_LABELS[check.metric] || fallbackLabel;
    const message = isFeature
        ? `${label} limit reached (${check.current}/${check.limit} this month). Upgrade to Pro for unlimited.`
        : `AI query limit reached (${check.current}/${check.limit} this month). Upgrade to Pro for more.`;
    const now = new Date();
    const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    return {
        error: 'usage_limit_exceeded',
        // Wave 3 honesty-audit additions: structured fields the frontend
        // <QuotaExceededState /> primitive parses. Existing callers
        // unaffected — these are additive only.
        code: 'QUOTA_EXCEEDED',
        feature: check.metric || 'ai_queries',
        resetAt,
        upgradeTo: 'pro',
        message,
        metric: check.metric,
        limit: check.limit,
        current: check.current,
        remaining: check.remaining,
        upgradeUrl: '/pricing',
    };
}

// ---------------------------------------------------------------------------
// Uniform 429/403 payload helpers.
//
// `quotaExceededResponse()` (above) is the canonical 429 builder — every AI
// route uses it and the frontend's <QuotaExceededState /> primitive is
// gated on its `code: 'QUOTA_EXCEEDED'` envelope.
//
// `quotaErrorPayload()` was an earlier draft that emitted a slightly
// different shape (`used` vs `current`, no `message`/`upgradeUrl`). It has
// no production callers — kept exported for the dedicated test suite that
// pins its shape. New callers MUST prefer `quotaExceededResponse`.
//
// `tierRequiredPayload()` builds the 403 envelope used by the require-tier
// middleware so formatUserError() can map it to a "Pro feature" /
// "Enterprise feature" toast with a "See plans" CTA.
// ---------------------------------------------------------------------------

/**
 * @deprecated Use {@link quotaExceededResponse} for new callers — this helper
 * is kept solely for backwards compatibility with the legacy shape pinned
 * by `usage-meter-quota-payload.test.js`.
 */
export function quotaErrorPayload(check, { feature, upgradeTo = null, tier }) {
    const now = new Date();
    const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    return {
        error: 'Quota exceeded',
        code: 'QUOTA_EXCEEDED',
        feature,
        tier,
        limit: check.limit,
        used: check.current,
        resetAt,
        upgradeTo,
    };
}

export function tierRequiredPayload(currentTier, requiredTier, feature) {
    return {
        error: 'Tier required',
        code: `TIER_REQUIRED_${requiredTier.toUpperCase()}`,
        feature,
        currentTier,
        requiredTier,
    };
}

// ---------------------------------------------------------------------------
// Daily-window metering — mirrors the monthly getCurrentPeriod()/
// incrementUsage()/guardedIncrement() family above, but keyed to a UTC
// calendar day instead of a UTC calendar month. Added for the 2026-07-18
// pricing rebalance's `bulk_destructive_daily` metric: a tier-INDEPENDENT
// anti-abuse ceiling on destructive bulk operations (delete/transfer) that
// applies on top of the (now largely free) `bulkAdvanced` tier gate — see
// `bulkDestructiveDailyMax` in feature-flags.js.
//
// Reuses the existing `usage_metrics` table: period_start/period_end just
// span a day instead of a month. The unique index on
// (user_id, metric_type, period_start) already keeps day-period rows and
// month-period rows apart as long as callers don't mix a daily metric_type
// with the monthly helpers (or vice versa) — bulk_destructive_daily is only
// ever driven through the daily helpers below.
// ---------------------------------------------------------------------------

/**
 * Returns the `{ start, end }` ISO bounds of the UTC calendar day containing
 * `now`. Sibling of getCurrentPeriod() (month) for daily-window metrics.
 */
export function getCurrentDayPeriod(now = new Date()) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const date = now.getUTCDate();
    const start = new Date(Date.UTC(year, month, date)).toISOString();
    const end = new Date(Date.UTC(year, month, date, 23, 59, 59)).toISOString();
    return { start, end };
}

export function incrementDailyUsage(userId, metricType) {
    const { start, end } = getCurrentDayPeriod();
    db.prepare(`
        INSERT INTO usage_metrics (user_id, metric_type, count, period_start, period_end)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(user_id, metric_type, period_start) DO UPDATE SET
            count = count + 1, updated_at = datetime('now')
    `).run(userId, metricType, start, end);
}

export function getCurrentDailyUsage(userId, metricType) {
    const { start } = getCurrentDayPeriod();
    const row = db.prepare(
        'SELECT count FROM usage_metrics WHERE user_id = ? AND metric_type = ? AND period_start = ?'
    ).get(userId, metricType, start);
    return row?.count || 0;
}

export function checkDailyUsageLimit(userId, metricType) {
    const tier = getUserTier(userId);
    const features = getFeatures(tier);
    const featureKey = METRIC_TO_FEATURE[metricType] || metricType;
    const limit = features[featureKey] ?? Infinity;
    const current = getCurrentDailyUsage(userId, metricType);
    return {
        allowed: current < limit,
        current,
        limit,
        remaining: Math.max(0, limit - current),
    };
}

const guardedDailyIncrementTxn = db.transaction(guardedBump);

/**
 * Atomic daily analogue of guardedIncrement() — check-and-consume one unit of
 * `metricType` for `userId` within the current UTC day, gated by the tier's
 * resolved daily limit. Same return shape and same "already incremented on
 * allowed:true, call releaseGuardedDailyIncrement() on failure" contract.
 */
export function guardedDailyIncrement(userId, metricType) {
    const tier = getUserTier(userId);
    const features = getFeatures(tier);
    const featureKey = METRIC_TO_FEATURE[metricType] || metricType;
    const limit = features[featureKey] ?? Infinity;
    const { start, end } = getCurrentDayPeriod();
    const boundLimit = Number.isFinite(limit) ? limit : UNBOUNDED_LIMIT;

    const r = guardedDailyIncrementTxn(userId, metricType, start, end, boundLimit);
    const current = getCurrentDailyUsage(userId, metricType);
    return {
        allowed: r.changes > 0,
        current,
        limit,
        remaining: Number.isFinite(limit) ? Math.max(0, limit - current) : Infinity,
    };
}

/**
 * Compensating decrement for guardedDailyIncrement() — mirrors
 * releaseGuardedIncrement() for the daily window.
 */
export function releaseGuardedDailyIncrement(userId, metricType) {
    const { start } = getCurrentDayPeriod();
    guardedUnbump(userId, metricType, start);
}
