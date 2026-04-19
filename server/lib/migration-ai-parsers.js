/**
 * server/lib/migration-ai-parsers.js
 *
 * Shared parse helpers for migration-related AI endpoints.
 *
 * Single source of truth consumed by:
 *   - server/routes/ai.js  (POST /api/ai/migration-size-strategy and
 *                            POST /api/ai/migration-description)
 *   - server/evals/adapters/migration-size-strategy.js
 *   - server/evals/adapters/migration-description.js
 */

import { safeJsonParse } from './utils.js';
import { defaultRepoDescription, sanitizeRepoDescription } from './repo-description.js';

/**
 * Parse a Gemini response for the /ai/migration-size-strategy endpoint.
 * Returns the final response shape (strategy + rationale + confidence) or null
 * when the response is malformed / strategy invalid.
 *
 * @param {string} text  — raw text from the AI provider
 * @returns {{ strategy: string, rationale: string, confidence: number } | null}
 */
export function parseSizeStrategyResponse(text) {
    const parsed = safeJsonParse(text);
    if (!parsed || !['exclude', 'lfs-migrate'].includes(parsed.strategy)) return null;
    return {
        strategy: parsed.strategy,
        rationale: String(parsed.rationale || '').slice(0, 500),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    };
}

/**
 * Parse a Gemini response for the /ai/migration-description endpoint.
 * Always returns a { description } object — falls back to defaultRepoDescription()
 * when the model returns malformed / empty output.
 *
 * @param {string} text  — raw text from the AI provider
 * @param {{ repoName?: string, source?: object }} [context]  — used for fallback only
 * @returns {{ description: string }}
 */
export function parseDescriptionResponse(text, { repoName, source } = {}) {
    const parsed = safeJsonParse(text);
    const raw = parsed?.description;
    const description = typeof raw === 'string' && raw.trim()
        ? sanitizeRepoDescription(raw)
        : defaultRepoDescription({ repoName, source });
    return { description };
}
