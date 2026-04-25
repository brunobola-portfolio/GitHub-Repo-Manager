// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Translate Search — turns a natural-language palette query into one or two
 * GitHub search query strings the existing /search/github endpoint already
 * understands. Pure helpers; the route handler glues the AI provider call
 * and the cache to these.
 *
 * The translator is deliberately conservative:
 *   - Output is JSON with at most 2 queries.
 *   - Each query has a `type` (pr | issue | repo) the frontend dispatches to.
 *   - The `summary` is a one-sentence plain-English read-back so the user
 *     can sanity-check what the AI inferred.
 *   - We never emit `org:` filters the user didn't supply, because palette
 *     search must default to the user's own scope.
 *
 * Cached 5 min per (userId, q-hash) so retyping the same query doesn't
 * re-bill the AI provider.
 */

import crypto from 'node:crypto';
import { createCache } from './memory-cache.js';

const FIVE_MIN_MS = 5 * 60 * 1000;
const MAX_QUERIES = 2;
const MAX_OUTPUT_TOKENS = 200;

const ALLOWED_TYPES = new Set(['pr', 'issue', 'repo']);

const cache = createCache({ ttlMs: FIVE_MIN_MS, maxSize: 500 });

export function hashQuery(q) {
    return crypto.createHash('sha1').update(q || '').digest('hex').slice(0, 12);
}

export function buildCacheKey({ userId, q }) {
    return `${userId ?? 'anon'}:${hashQuery(q)}`;
}

export function readCachedTranslation(args) {
    return cache.get(buildCacheKey(args));
}

export function writeCachedTranslation(args, value) {
    return cache.set(buildCacheKey(args), value);
}

export function clearTranslateSearchCache() {
    cache.clear();
}

/**
 * Build the prompt sent to the AI provider. Constraints are baked in so
 * the route handler can validate the response strictly.
 */
export function buildPrompt({ q }) {
    return [
        'You are translating a natural-language search query into GitHub search syntax.',
        '',
        'Constraints:',
        '- Return JSON only, no markdown fences, no commentary.',
        '- Schema: { "summary": string, "queries": [ { "type": "pr"|"issue"|"repo", "ghQuery": string } ] }',
        '- At most 2 queries. Pick the most useful types.',
        '- summary is one short sentence in plain English (max 200 chars). Address the user as "you".',
        '- ghQuery uses GitHub search syntax: is:pr / is:issue, state:open, author:@me, assignee:@me, review-requested:@me, label:foo, repo:owner/name, in:title, updated:>YYYY-MM-DD, etc.',
        '- Never invent an org: or user: scope the user did not name.',
        '- For "I", "me", "my" use @me on the relevant qualifier.',
        '- If the query is too vague to translate, return {"summary": "...", "queries": []} and explain why in summary.',
        '',
        `User query: ${q}`,
    ].join('\n');
}

/**
 * Validate + normalise the model output. Returns a clean object with at
 * most MAX_QUERIES entries, dropping anything malformed.
 *
 * Always returns an object — never throws. Callers decide whether an
 * empty queries[] should surface as a soft fallback or an error.
 */
export function shapeTranslation(parsed) {
    const out = { summary: '', queries: [], fallback: false };
    if (!parsed || typeof parsed !== 'object') {
        out.fallback = true;
        out.summary = 'Could not interpret the query.';
        return out;
    }

    if (typeof parsed.summary === 'string') {
        out.summary = parsed.summary.trim().slice(0, 240);
    }

    if (Array.isArray(parsed.queries)) {
        for (const q of parsed.queries) {
            if (!q || typeof q !== 'object') continue;
            const type = String(q.type || '').toLowerCase();
            const ghQuery = typeof q.ghQuery === 'string' ? q.ghQuery.trim() : '';
            if (!ALLOWED_TYPES.has(type) || !ghQuery) continue;
            out.queries.push({ type, ghQuery: ghQuery.slice(0, 500) });
            if (out.queries.length >= MAX_QUERIES) break;
        }
    }

    if (out.queries.length === 0) {
        out.fallback = true;
        if (!out.summary) out.summary = 'No specific GitHub query inferred — using your text as-is.';
    }

    return out;
}

export const TRANSLATE_SEARCH_LIMITS = Object.freeze({
    ttlMs: FIVE_MIN_MS,
    maxQueries: MAX_QUERIES,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
});
