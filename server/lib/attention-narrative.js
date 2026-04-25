/**
 * Attention narrative — generates a one-line, plain-text explanation of why a
 * single repo is asking for the user's attention. Lives behind a 1-hour
 * per-(user, repo, kind, signal-hash) cache so repeated dashboard loads don't
 * re-bill the AI provider for the same context.
 *
 * Pure helpers — the route handler at server/routes/ai/core.js wires this to
 * the request lifecycle. Kept framework-free so unit tests can exercise the
 * cache + signal-hash + prompt-shaping rules without spinning up Express or
 * an AI provider.
 */

import crypto from 'node:crypto';
import { createCache } from './memory-cache.js';

const ONE_HOUR_MS = 60 * 60 * 1000;
const MAX_NARRATIVE_CHARS = 240;
const MAX_OUTPUT_TOKENS = 80;

const KIND_LABELS = Object.freeze({
    failed_migration: 'a recent migration that failed',
    stale_pinned: 'being pinned but quiet for a while',
    abandoned: 'no activity for a long time',
    hot: 'a sudden burst of activity',
});

// One cache instance per process. 1h TTL, capped so a noisy dashboard cannot
// run unbounded.
const cache = createCache({ ttlMs: ONE_HOUR_MS, maxSize: 500 });

/**
 * Stable hash of the signal payload so two identical signals share a cache
 * entry, but a meaningful change (e.g. a new failure timestamp) busts it.
 * SHA-1 truncated to 12 hex chars — collision-resistant enough at this scale
 * (per-user, per-repo namespace) and small in storage.
 */
export function hashSignal(signal) {
    const json = JSON.stringify(signal ?? {});
    return crypto.createHash('sha1').update(json).digest('hex').slice(0, 12);
}

/**
 * Build the cache key. Includes the user id so two users looking at the same
 * repo+kind get independent narratives (the underlying signal differs).
 */
export function buildCacheKey({ userId, repo, kind, signal }) {
    return `${userId ?? 'anon'}:${repo}:${kind}:${hashSignal(signal)}`;
}

/**
 * Look up a cached narrative. Returns undefined on miss.
 */
export function readCachedNarrative(args) {
    return cache.get(buildCacheKey(args));
}

/**
 * Store a fresh narrative under the cache key.
 */
export function writeCachedNarrative(args, value) {
    return cache.set(buildCacheKey(args), value);
}

/**
 * Test/admin escape hatch.
 */
export function clearNarrativeCache() {
    cache.clear();
}

/**
 * Build the prompt sent to the AI provider. Constraints baked in:
 * - max 240 chars output (asserted by the route after generation too)
 * - plain text, no markdown, no enumeration of more than 3 facts
 * - no first-person voice
 */
export function buildPrompt({ repo, kind, signal }) {
    const reason = KIND_LABELS[kind] || 'attention is needed';
    const signalSummary = JSON.stringify(signal ?? {}, null, 0);
    return [
        'You are summarising why a GitHub repository needs the user\'s attention today.',
        '',
        'Constraints:',
        '- One sentence, plain text. No markdown, no bullet points, no quotes.',
        '- Maximum 240 characters.',
        '- Mention at most three concrete facts from the signal.',
        '- No first-person voice ("I", "we", "us").',
        '- Be specific. Avoid generic platitudes ("important repo", "needs work").',
        '',
        `Repository: ${repo}`,
        `Reason category: ${reason}`,
        `Signal payload: ${signalSummary}`,
        '',
        'Return only the sentence — no preamble, no labels.',
    ].join('\n');
}

/**
 * Trim and sanity-check the model output before returning to the client.
 * Always returns a string (possibly empty if the model returned junk).
 */
export function shapeNarrative(rawText) {
    if (typeof rawText !== 'string') return '';
    const cleaned = rawText
        .replace(/[\r\n]+/g, ' ')
        .replace(/^\s*["'`]+|["'`]+\s*$/g, '')
        .trim();
    if (cleaned.length <= MAX_NARRATIVE_CHARS) return cleaned;
    // Hard truncate at the last word boundary that fits.
    const sliced = cleaned.slice(0, MAX_NARRATIVE_CHARS - 1);
    const lastSpace = sliced.lastIndexOf(' ');
    return (lastSpace > 80 ? sliced.slice(0, lastSpace) : sliced) + '…';
}

export const ATTENTION_NARRATIVE_LIMITS = Object.freeze({
    maxChars: MAX_NARRATIVE_CHARS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    ttlMs: ONE_HOUR_MS,
});
