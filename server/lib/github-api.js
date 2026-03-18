/*
 * GitHub Repo Manager - GitHub API Helper
 *
 * Shared module providing an authenticated GitHub API fetch wrapper with:
 * - ETag-based conditional request caching (304 Not Modified support)
 * - Rate limit tracking and pre-emptive wait/throw logic
 * - Standardized error parsing
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import logger from './logger.js';

const MAX_STATS_CACHE = 200;
const MAX_ETAG_CACHE = 2000;

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
 * Stores URL -> { etag, data } mappings. Conditional requests returning
 * 304 Not Modified do not count against the GitHub rate limit.
 * Capped at MAX_ETAG_CACHE entries with oldest-first eviction.
 */
const etagCache = new Map();

/**
 * GitHub API rate limit tracking.
 * Updated after every GitHub API response from X-RateLimit-* headers.
 */
let rateLimitInfo = { remaining: null, reset: null };

/**
 * Wrapper for GitHub API calls.
 * Handles authentication headers, API versioning, ETag-based conditional
 * requests, rate limit tracking, and standardized error parsing.
 *
 * @param {string} path - The API endpoint path (e.g., '/user/repos') or full URL
 * @param {string} token - The user's OAuth access token
 * @param {object} options - Fetch options (method, body, headers, etc.)
 * @returns {{ data: any, headers: Headers }}
 */
export async function githubApi(path, token, options = {}) {
    const url = path.startsWith('http') ? path : `https://api.github.com${path}`;

    // Rate limit pre-check: if we know we're exhausted, wait or throw
    if (rateLimitInfo.remaining !== null && rateLimitInfo.remaining <= 0 && rateLimitInfo.reset !== null) {
        const now = Math.floor(Date.now() / 1000);
        if (now < rateLimitInfo.reset) {
            const waitSeconds = rateLimitInfo.reset - now;
            if (waitSeconds <= 60) {
                // Short wait - sleep until reset
                logger.warn({ waitSeconds }, 'Rate limit exhausted, waiting for reset');
                await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
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
    const cached = etagCache.get(url);
    if (method === 'GET' && cached?.etag) {
        requestHeaders['If-None-Match'] = cached.etag;
    }

    let res;
    try {
        res = await fetch(url, {
            ...options,
            headers: requestHeaders,
            signal: options.signal || AbortSignal.timeout(30000)
        });
    } catch (err) {
        if (err.name === 'AbortError' || err.name === 'TimeoutError') {
            const error = new Error('GitHub API request timed out. Please try again.');
            error.status = 504;
            throw error;
        }
        throw err;
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
        return { data: cached.data, headers: res.headers };
    }

    // Attempt to parse JSON, but handle empty responses gracefully
    const data = await res.json().catch(() => null);

    if (!res.ok) {
        const error = new Error(
            res.status === 401
                ? 'GitHub token expired or revoked. Please login again.'
                : (data?.message || `GitHub API error: ${res.status}`)
        );
        error.status = res.status;
        error.data = data;
        throw error;
    }

    // Cache the ETag and response data for future conditional requests
    const responseEtag = res.headers.get('ETag');
    if (method === 'GET' && responseEtag) {
        etagCache.set(url, { etag: responseEtag, data });
        evictOldest(etagCache, MAX_ETAG_CACHE);
    }

    return { data, headers: res.headers };
}
