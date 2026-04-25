/**
 * In-memory health probe for AI providers.
 *
 * The /config/ai-status endpoint surfaces a `keyHealth` field that the UI uses
 * to distinguish "not configured" from "configured but the key is rejected".
 * This module manages the small in-memory cache that backs that field plus the
 * async probe that refreshes it.
 *
 * Why in-memory and not the DB:
 *   - The probe only matters for the lifetime of the server process — keys
 *     change rarely, and a cold cache after restart is fine.
 *   - Avoids extra schema and migration churn for a UX-only concern.
 *
 * Why a 5-minute TTL:
 *   - Long enough to absorb burst traffic on Settings without billing extra
 *     completions for every page-load.
 *   - Short enough that fixing a bad key shows green within a coffee-break.
 *
 * Why we never throw from runProbe():
 *   - The status endpoint is read-only and must never fail because of a flaky
 *     downstream call. Failures degrade to `keyHealth: 'unknown'` and the UI
 *     keeps working.
 */

import logger from './logger.js';
import { captureBreadcrumb } from './monitoring.js';

const TTL_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 5_000;

// Map<cacheKey, { state, checkedAt, inflight }>
const cache = new Map();

// Cumulative probe outcome counters. Reset on process restart — designed
// for short-window operational visibility, not long-term metrics. Use a
// real metrics backend (Prom, StatsD) when those are wired up.
const counters = {
    ok: 0,
    invalid: 0,
    unreachable: 0,
    unknown: 0,
    total: 0,
    lastOutcomeAt: null,
};

/**
 * Record a probe outcome. Bumps counters, structured-logs the event, and
 * (when Sentry is configured) emits a breadcrumb so any subsequent error
 * has the recent probe trail attached.
 *
 * Severity policy:
 *   - 'invalid' is a real config issue → warning
 *   - 'unreachable' / 'unknown' are noisy; info-only to avoid alert fatigue
 *   - 'ok' is info, mostly useful as a heartbeat
 */
function recordOutcome({ state, userId, durationMs, source }) {
    counters[state] = (counters[state] ?? 0) + 1;
    counters.total += 1;
    counters.lastOutcomeAt = new Date().toISOString();
    const level = state === 'invalid' ? 'warning' : 'info';
    captureBreadcrumb({
        event: 'ai.probe_outcome',
        level,
        data: { state, userId: userId ?? null, durationMs, source },
        message: `AI key health probe → ${state}`,
    });
}

/**
 * Read-only snapshot of probe outcome counters. Exposed so an admin route
 * (or operator REPL) can sanity-check key health distribution without
 * touching the cache directly.
 */
export function getProbeStats() {
    return { ...counters };
}

/**
 * Reset counters (tests + a future admin endpoint).
 */
export function resetProbeStats() {
    counters.ok = 0;
    counters.invalid = 0;
    counters.unreachable = 0;
    counters.unknown = 0;
    counters.total = 0;
    counters.lastOutcomeAt = null;
}

/**
 * Cache key for a probe. Authenticated calls key by userId so each BYOK user
 * gets their own state. Unauthenticated reads use a constant key so the
 * server-fallback state is shared across anonymous probes.
 */
function makeCacheKey(userId) {
    return userId == null ? 'server' : `user:${userId}`;
}

/**
 * Map a provider error to one of the keyHealth states.
 * 401/403 → invalid (auth failure). Network errors → unreachable. Anything
 * else → unknown so we don't surface an alarm for transient issues.
 */
function classifyError(err) {
    const status = err?.status ?? err?.cause?.status;
    if (status === 401 || status === 403) return 'invalid';
    const code = err?.code;
    if (code === 'AUTH') return 'invalid';
    if (code === 'NETWORK' || code === 'TIMEOUT') return 'unreachable';
    if (code === 'NOT_FOUND') return 'invalid';
    if (/api[_ ]key|invalid|unauthorized/i.test(err?.message || '')) return 'invalid';
    return 'unknown';
}

/**
 * Run a tiny completion against the provider to verify the key works.
 * Returns one of: 'ok', 'invalid', 'unreachable', 'unknown'.
 *
 * Records the outcome via captureBreadcrumb / counters so operators can see
 * the probe trail without spelunking through logs.
 */
async function runProbe(provider, { userId = null, source = 'getKeyHealth' } = {}) {
    if (!provider) {
        recordOutcome({ state: 'unknown', userId, durationMs: 0, source });
        return 'unknown';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const startedAt = Date.now();

    try {
        await provider.generate({
            prompt: 'ping',
            generationConfig: { maxOutputTokens: 1 },
        });
        recordOutcome({ state: 'ok', userId, durationMs: Date.now() - startedAt, source });
        return 'ok';
    } catch (err) {
        const state = classifyError(err);
        logger.debug({ state, err: err?.message }, 'AI key health probe failed');
        recordOutcome({ state, userId, durationMs: Date.now() - startedAt, source });
        return state;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Read cached keyHealth and lazily refresh in the background when stale.
 *
 * @param {object} opts
 * @param {number|null} [opts.userId] — null/undefined for anonymous (server-fallback) probes
 * @param {() => Promise<object|null>} opts.resolveProvider — async factory that returns the provider to probe
 * @returns {{ state: 'ok'|'invalid'|'unreachable'|'unknown', checkedAt: string|null }}
 */
export function getKeyHealth({ userId, resolveProvider }) {
    const key = makeCacheKey(userId);
    const entry = cache.get(key);
    const now = Date.now();

    if (entry && (now - entry.checkedAt) < TTL_MS) {
        return { state: entry.state, checkedAt: new Date(entry.checkedAt).toISOString() };
    }

    // Fire the probe in the background so the read returns immediately.
    if (!entry?.inflight) {
        const inflight = (async () => {
            try {
                const provider = await resolveProvider();
                const state = await runProbe(provider, { userId, source: 'getKeyHealth' });
                cache.set(key, { state, checkedAt: Date.now(), inflight: null });
            } catch (err) {
                logger.debug({ err: err?.message }, 'AI key health probe resolveProvider threw');
                recordOutcome({ state: 'unknown', userId, durationMs: 0, source: 'getKeyHealth' });
                cache.set(key, { state: 'unknown', checkedAt: Date.now(), inflight: null });
            }
        })();
        cache.set(key, { ...(entry ?? { state: 'unknown', checkedAt: 0 }), inflight });
    }

    return {
        state: entry?.state ?? 'unknown',
        checkedAt: entry?.checkedAt ? new Date(entry.checkedAt).toISOString() : null,
    };
}

/**
 * Synchronously probe and write the cache. Used by /test endpoints and the
 * `?probe=1` query so callers that just changed the key see the new state on
 * the next read.
 *
 * @param {object} opts — same shape as getKeyHealth
 * @returns {Promise<{ state: string, checkedAt: string }>}
 */
export async function probeAndCache({ userId, resolveProvider }) {
    const key = makeCacheKey(userId);
    let provider = null;
    try {
        provider = await resolveProvider();
    } catch (err) {
        logger.debug({ err: err?.message }, 'AI key health probe resolveProvider threw');
    }
    let state;
    if (provider) {
        state = await runProbe(provider, { userId, source: 'probeAndCache' });
    } else {
        state = 'unknown';
        recordOutcome({ state: 'unknown', userId, durationMs: 0, source: 'probeAndCache' });
    }
    const checkedAt = Date.now();
    cache.set(key, { state, checkedAt, inflight: null });
    return { state, checkedAt: new Date(checkedAt).toISOString() };
}

/**
 * Clear the cache for a user (or the whole cache if userId is omitted).
 * Use after a config delete so the next read doesn't return stale "ok".
 */
export function invalidate(userId) {
    if (userId === undefined) {
        cache.clear();
        return;
    }
    cache.delete(makeCacheKey(userId));
}

/**
 * Manually write a state into the cache without running a probe. Used by the
 * Test Connection endpoint to record an "ok" result it just verified, so the
 * next status read returns immediately without billing a second completion.
 */
export function recordState(userId, state) {
    cache.set(makeCacheKey(userId), { state, checkedAt: Date.now(), inflight: null });
}

// Exposed for tests only — never use from production code.
export const __TEST__ = { cache, makeCacheKey };
