/*
 * GitHub Repo Manager - GitHub API Helper
 *
 * Shared module providing an authenticated GitHub API fetch wrapper with:
 * - ETag-based conditional request caching (304 Not Modified support)
 * - Rate limit tracking and pre-emptive wait/throw logic
 * - Exponential backoff + jittered retry on 5xx / network errors
 * - Retry-After honouring for 429 / secondary rate limits
 * - Module-scope circuit breaker to fail fast during a GitHub incident
 * - Standardized error parsing
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import crypto from 'crypto';
import logger from './logger.js';
import { createCache } from './memory-cache.js';

const MAX_STATS_CACHE = 200;

// ETag cache sizing. The old 2000-entry cap counted entries only, and every
// entry holds a fully parsed GitHub response — a few hundred repo/PR listings
// are enough to reach hundreds of megabytes that nothing ever reclaims, because
// insertion-order eviction throws away hot keys long before cold ones. The
// bound below is deliberately expressed in bytes as well as entries: at most
// ~300 responses, none larger than 128 KB, all expiring after 10 minutes of
// disuse. Anything bigger skips the cache — a single 5 MB diff costs more
// resident memory than the conditional request it would save.
const MAX_ETAG_CACHE = 300;
const MAX_ETAG_ENTRY_BYTES = 128 * 1024;
const ETAG_TTL_MS = 10 * 60 * 1000;

// Retry / backoff tunables
const MAX_RETRIES = 3;                    // total attempts = MAX_RETRIES + 1 (1 initial + 3 retries)
const BASE_BACKOFF_MS = 400;              // 400, 800, 1600 ms
const MAX_RETRY_AFTER_SECONDS = 60;       // clamp Retry-After to protect request latency

// Circuit breaker tunables
const CB_FAILURE_THRESHOLD = 5;           // trip after this many consecutive failures
const CB_FAILURE_WINDOW_MS = 60_000;      // failures must be within this rolling window
const CB_OPEN_DURATION_MS = 30_000;       // keep breaker open for this long

// Circuit breaker states
const CB_CLOSED = 'CLOSED';
const CB_OPEN = 'OPEN';
const CB_HALF_OPEN = 'HALF_OPEN';

export function evictOldest(map, max) {
    while (map.size > max) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
    }
}

/**
 * Stats cache for caching computed repository statistics.
 * Keyed by arbitrary string identifiers chosen by callers.
 * Capped at MAX_STATS_CACHE entries with oldest-first eviction.
 */
export const statsCache = new Map();

/**
 * In-memory ETag cache for GitHub API conditional requests.
 * Stores `${userHash}:${url}` -> { etag, data }. Conditional requests that
 * answer 304 Not Modified do not count against the GitHub rate limit.
 *
 * Backed by the shared LRU+TTL cache so a hit refreshes the entry's position:
 * the keys a user actually polls stay resident and the ones they visited once
 * age out, which insertion-order eviction got exactly backwards.
 */
export const etagCache = createCache({
    ttlMs: ETAG_TTL_MS,
    maxSize: MAX_ETAG_CACHE,
});

/**
 * Byte size of a response body, from Content-Length when GitHub sends it.
 * Returns null when the size is unknown (chunked responses, test doubles), in
 * which case the entry-count cap alone bounds the cache.
 *
 * @param {Headers} headers
 * @returns {number|null}
 */
function responseBytes(headers) {
    const raw = headers?.get?.('Content-Length');
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * GitHub API rate limit tracking.
 * Updated after every GitHub API response from X-RateLimit-* headers.
 */
let rateLimitInfo = { remaining: null, reset: null };

/**
 * Circuit breaker state (module-scope, process-wide).
 *
 *   CLOSED     -> normal: every request attempted. On repeated failures
 *                 we count up toward CB_FAILURE_THRESHOLD.
 *   OPEN       -> short-circuit: all requests fail fast with 503 until
 *                 CB_OPEN_DURATION_MS has elapsed since openedAt.
 *   HALF_OPEN  -> probe: first request through is attempted. Success ->
 *                 CLOSED (counter reset). Failure -> OPEN again.
 */
const circuitBreaker = {
    state: CB_CLOSED,
    consecutiveFailures: 0,
    firstFailureAt: 0,     // timestamp of the failure that started the current streak
    openedAt: 0
};

/**
 * Reset the circuit breaker. Exposed for tests and for operator-triggered
 * recovery; not part of the normal runtime flow.
 */
export function resetCircuitBreaker() {
    circuitBreaker.state = CB_CLOSED;
    circuitBreaker.consecutiveFailures = 0;
    circuitBreaker.firstFailureAt = 0;
    circuitBreaker.openedAt = 0;
}

/**
 * Internal: sleep helper. Uses setTimeout so vitest fake timers can
 * advance it (vi.advanceTimersByTimeAsync).
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Internal: compute the next backoff delay (ms) with ±20% jitter.
 * attempt is 1-indexed (1 = first retry).
 */
function computeBackoff(attempt) {
    const base = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
    const jitter = 0.8 + Math.random() * 0.4; // 0.8 .. 1.2
    return Math.round(base * jitter);
}

/**
 * Internal: decide whether an error/response code is retryable.
 *   - 5xx server errors             -> retry
 *   - Network errors (fetch threw)  -> retry
 *   - Everything else (4xx, 2xx)    -> do not retry
 * 429 is handled separately via Retry-After.
 */
function isRetryableStatus(status) {
    return typeof status === 'number' && status >= 500 && status < 600;
}

const NETWORK_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);

function isNetworkError(err) {
    if (!err) return false;
    if (err.name === 'TypeError') return true; // fetch() throws TypeError on network failure
    if (err.name === 'FetchError') return true;
    if (err.code && NETWORK_ERROR_CODES.has(err.code)) return true;
    // Node's fetch surfaces causes on err.cause
    if (err.cause?.code && NETWORK_ERROR_CODES.has(err.cause.code)) return true;
    return false;
}

/**
 * Internal: evaluate whether the breaker should short-circuit. Also
 * handles the OPEN -> HALF_OPEN transition once the open window expires.
 * Returns an Error to throw, or null if the request may proceed.
 */
function checkCircuitBreaker() {
    if (circuitBreaker.state === CB_OPEN) {
        const elapsed = Date.now() - circuitBreaker.openedAt;
        if (elapsed >= CB_OPEN_DURATION_MS) {
            // Move to HALF_OPEN: allow exactly one probe request through.
            circuitBreaker.state = CB_HALF_OPEN;
            return null;
        }
        const err = new Error('GitHub API circuit breaker is open. Upstream is degraded; please retry shortly.');
        err.status = 503;
        err.code = 'github_circuit_open';
        err.retryAfter = Math.ceil((CB_OPEN_DURATION_MS - elapsed) / 1000);
        return err;
    }
    return null;
}

/**
 * Internal: record a successful response. Closes the breaker if it was
 * HALF_OPEN, and resets the failure counter.
 */
function recordSuccess() {
    if (circuitBreaker.state !== CB_CLOSED) {
        circuitBreaker.state = CB_CLOSED;
    }
    circuitBreaker.consecutiveFailures = 0;
    circuitBreaker.firstFailureAt = 0;
    circuitBreaker.openedAt = 0;
}

/**
 * Internal: record a retryable failure (5xx or network). Trips the
 * breaker if the threshold is crossed within the rolling window.
 * Non-retryable 4xx errors do NOT call this — they're deterministic and
 * shouldn't trip the breaker.
 */
function recordFailure() {
    const now = Date.now();

    // If the previous streak started outside the rolling window, reset it.
    if (circuitBreaker.firstFailureAt === 0 ||
        (now - circuitBreaker.firstFailureAt) > CB_FAILURE_WINDOW_MS) {
        circuitBreaker.consecutiveFailures = 1;
        circuitBreaker.firstFailureAt = now;
    } else {
        circuitBreaker.consecutiveFailures += 1;
    }

    // HALF_OPEN probe failed -> reopen immediately.
    if (circuitBreaker.state === CB_HALF_OPEN) {
        circuitBreaker.state = CB_OPEN;
        circuitBreaker.openedAt = now;
        logger.error({ consecutiveFailures: circuitBreaker.consecutiveFailures }, 'github circuit re-opened after half-open probe failed');
        return;
    }

    if (circuitBreaker.consecutiveFailures >= CB_FAILURE_THRESHOLD && circuitBreaker.state !== CB_OPEN) {
        circuitBreaker.state = CB_OPEN;
        circuitBreaker.openedAt = now;
        logger.error({ consecutiveFailures: circuitBreaker.consecutiveFailures }, 'github circuit opened');
    }
}

/**
 * Internal: parse Retry-After header. Returns seconds (integer) or null.
 * Handles both delta-seconds ("2") and HTTP-date formats.
 */
function parseRetryAfter(headerValue) {
    if (!headerValue) return null;
    const asNumber = Number(headerValue);
    if (Number.isFinite(asNumber) && asNumber >= 0) {
        return Math.floor(asNumber);
    }
    const asDate = Date.parse(headerValue);
    if (!Number.isNaN(asDate)) {
        const seconds = Math.ceil((asDate - Date.now()) / 1000);
        return seconds > 0 ? seconds : 0;
    }
    return null;
}

/**
 * Internal: detect GitHub secondary rate limit responses (403 where the
 * body message mentions "secondary rate limit" or "abuse detection").
 */
function isSecondaryRateLimit(status, body) {
    if (status !== 403) return false;
    const msg = (body?.message || '').toLowerCase();
    return msg.includes('secondary rate limit') || msg.includes('abuse detection');
}

/**
 * Wrapper for GitHub API calls.
 * Handles authentication headers, API versioning, ETag-based conditional
 * requests, rate limit tracking, retries with exponential backoff, and
 * a circuit breaker that fails fast during upstream incidents.
 *
 * @param {string} path - The API endpoint path (e.g., '/user/repos') or full URL
 * @param {string} token - The user's OAuth access token
 * @param {object} options - Fetch options (method, body, headers, etc.)
 * @returns {{ data: any, headers: Headers }}
 */
export async function githubApi(path, token, options = {}) {
    const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
    const userHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 8);
    const cacheKey = `${userHash}:${url}`;

    // Circuit breaker pre-check: fail fast if GitHub is known-bad.
    const breakerError = checkCircuitBreaker();
    if (breakerError) throw breakerError;

    // Rate limit pre-check: if we know we're exhausted, wait or throw
    if (rateLimitInfo.remaining !== null && rateLimitInfo.remaining <= 0 && rateLimitInfo.reset !== null) {
        const now = Math.floor(Date.now() / 1000);
        if (now < rateLimitInfo.reset) {
            const waitSeconds = rateLimitInfo.reset - now;
            if (waitSeconds <= 60) {
                // Short wait - sleep until reset
                logger.warn({ waitSeconds }, 'Rate limit exhausted, waiting for reset');
                await sleep(waitSeconds * 1000);
            } else {
                const resetDate = new Date(rateLimitInfo.reset * 1000).toISOString();
                const error = new Error(`GitHub API rate limit exhausted. Resets at ${resetDate}. Please try again later.`);
                error.status = 429;
                error.code = 'RATE_LIMITED';
                error.resetsAt = resetDate;
                error.retryAfter = waitSeconds;
                throw error;
            }
        }
    }

    // Build request headers
    const requestHeaders = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...options.headers
    };

    // ETag conditional request: only for GET requests (or requests with no method specified)
    const method = (options.method || 'GET').toUpperCase();
    const cached = etagCache.get(cacheKey);
    if (method === 'GET' && cached?.etag) {
        requestHeaders['If-None-Match'] = cached.etag;
    }

    // Retry loop. Total attempts = 1 (initial) + MAX_RETRIES.
    // A Retry-After-driven wait counts as one retry by itself (per spec).
    let retriedForRetryAfter = false;
    let attempt = 0;

    for (;;) {
        let res;
        let fetchThrew = null;

        try {
            res = await fetch(url, {
                ...options,
                headers: requestHeaders,
                signal: options.signal || AbortSignal.timeout(30000)
            });
        } catch (err) {
            if (err.name === 'AbortError' || err.name === 'TimeoutError') {
                // User-initiated abort or our 30s timeout: treat as a
                // transient network error for retry purposes.
                fetchThrew = err;
            } else if (isNetworkError(err)) {
                fetchThrew = err;
            } else {
                // Unknown throw: bubble up unchanged.
                throw err;
            }
        }

        if (fetchThrew) {
            if (attempt < MAX_RETRIES) {
                attempt += 1;
                const delay = computeBackoff(attempt);
                logger.warn({ attempt, delay, err: fetchThrew.message || String(fetchThrew) }, 'github network error, backing off');
                await sleep(delay);
                continue;
            }
            // Exhausted retries. Record failure, throw a useful error.
            recordFailure();
            if (fetchThrew.name === 'AbortError' || fetchThrew.name === 'TimeoutError') {
                const error = new Error('GitHub API request timed out. Please try again.');
                error.status = 504;
                throw error;
            }
            throw fetchThrew;
        }

        // Track rate limit info from response headers
        const remainingHeader = res.headers.get('X-RateLimit-Remaining');
        const resetHeader = res.headers.get('X-RateLimit-Reset');
        if (remainingHeader !== null) {
            rateLimitInfo.remaining = parseInt(remainingHeader, 10);
        }
        if (resetHeader !== null) {
            rateLimitInfo.reset = parseInt(resetHeader, 10);
        }
        if (rateLimitInfo.remaining !== null && rateLimitInfo.remaining < 100) {
            const resetDate = rateLimitInfo.reset ? new Date(rateLimitInfo.reset * 1000).toISOString() : 'unknown';
            logger.warn({ remaining: rateLimitInfo.remaining, resetDate }, 'Rate limit low');
        }

        // Handle 304 Not Modified - return cached data (does not count against rate limit)
        if (res.status === 304 && cached?.data) {
            // GitHub just confirmed the entry is current, so slide its TTL —
            // otherwise a key that keeps answering 304 still expires on schedule
            // and forces a full, rate-limited refetch it never needed.
            etagCache.set(cacheKey, cached);
            recordSuccess();
            return { data: cached.data, headers: res.headers };
        }

        // Attempt to parse JSON, but handle empty responses gracefully
        const data = await res.json().catch(() => null);

        if (res.ok) {
            // Cache the ETag and response data for future conditional requests
            const responseEtag = res.headers.get('ETag');
            if (method === 'GET' && responseEtag) {
                const bytes = responseBytes(res.headers);
                if (bytes !== null && bytes > MAX_ETAG_ENTRY_BYTES) {
                    // Too big to be worth keeping resident — drop any older
                    // entry for this key so we don't serve its stale ETag.
                    etagCache.delete(cacheKey);
                } else {
                    etagCache.set(cacheKey, { etag: responseEtag, data });
                }
            }
            recordSuccess();
            return { data, headers: res.headers };
        }

        // ---- Error response: decide retry vs bubble-up ----

        // 429 primary rate limit, or 403 secondary rate limit: honour Retry-After
        // once per request.
        if ((res.status === 429 || isSecondaryRateLimit(res.status, data)) && !retriedForRetryAfter) {
            const retryAfterRaw = parseRetryAfter(res.headers.get('Retry-After'));
            if (retryAfterRaw !== null) {
                const waitSeconds = Math.min(retryAfterRaw, MAX_RETRY_AFTER_SECONDS);
                retriedForRetryAfter = true;
                logger.warn({ status: res.status, waitSeconds }, 'github rate limited (Retry-After), waiting before retry');
                await sleep(waitSeconds * 1000);
                continue;
            }
        }

        // 5xx: retryable with exponential backoff.
        if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
            attempt += 1;
            const delay = computeBackoff(attempt);
            logger.warn({ attempt, delay, status: res.status }, 'github server error, backing off');
            await sleep(delay);
            continue;
        }

        // Non-retryable (4xx) or retries exhausted: record failure (only
        // for 5xx — 4xx are deterministic client errors) and throw.
        if (isRetryableStatus(res.status)) {
            recordFailure();
        }

        const error = new Error(
            res.status === 401
                ? 'GitHub token expired or revoked. Please login again.'
                : (data?.message || `GitHub API error: ${res.status}`)
        );
        error.status = res.status;
        error.data = data;
        throw error;
    }
}
