/**
 * server/evals/adapters/migration-description.js
 *
 * Eval adapter for the migration-description AI handler.
 *
 * Exposes the handler's core logic (prompt generation + response parsing) as
 * a testable function that accepts a mock provider.
 *
 * Parse logic mirrors server/routes/ai.js:1436-1494.
 * Keep in sync if the route handler changes.
 */

import {
    defaultRepoDescription,
    sanitizeRepoDescription,
    REPO_DESCRIPTION_MAX,
} from '../../lib/repo-description.js';

export const feature = 'migration-description';

// ---------------------------------------------------------------------------
// Helpers (mirrors server/routes/ai.js imports)
// ---------------------------------------------------------------------------

// Mirrors server/lib/utils.js:safeJsonParse
function safeJsonParse(json, fallback = null) {
    if (json == null) return fallback;
    try { return JSON.parse(json); } catch { return fallback; }
}

// Mirrors server/ai-service.js:sanitizeForPrompt
function sanitizeForPrompt(text, maxLen = 5000) {
    if (!text) return '';
    const cleaned = String(text).replace(/\0/g, '');
    return cleaned.slice(0, maxLen);
}

// ---------------------------------------------------------------------------
// Prompt builder (mirrors server/routes/ai.js:1447-1472 prompt construction)
// Keep in sync with server/routes/ai.js:1447-1472.
// ---------------------------------------------------------------------------

/**
 * Build the migration-description prompt from input facts.
 *
 * @param {{ repoName: string, language?: string, size: number, branches: number,
 *           hasLfsMarker: boolean, lastCommitDate?: string,
 *           source: { isTfvc?: boolean, tfvcPath?: string, project: string, org: string } }} input
 * @returns {string}
 */
export function buildPrompt(input) {
    const { repoName, language, size, branches, hasLfsMarker, lastCommitDate, source } = input;

    const facts = [
        `Repo name: ${sanitizeForPrompt(repoName, 100)}`,
        language ? `Primary language: ${sanitizeForPrompt(language, 50)}` : null,
        `Size: ${size} KB`,
        `Branch count: ${branches}`,
        `LFS markers present: ${hasLfsMarker ? 'yes' : 'no'}`,
        lastCommitDate ? `Last commit: ${sanitizeForPrompt(lastCommitDate, 50)}` : null,
        source.isTfvc
            ? `Source: Azure DevOps TFVC folder "${sanitizeForPrompt(source.tfvcPath || '', 200)}" in project "${sanitizeForPrompt(source.project, 100)}"`
            : `Source: Azure DevOps Git repo in ${sanitizeForPrompt(source.org, 100)}/${sanitizeForPrompt(source.project, 100)}`,
    ].filter(Boolean).join('\n- ');

    return `You write short, professional GitHub repository descriptions.

Context about the repository being migrated:
- ${facts}

Rules:
- Single line, max ${REPO_DESCRIPTION_MAX} characters.
- No markdown, no code blocks, no line breaks, no emoji.
- English only.
- Ground the description in the facts above. Do not invent features or stack details not listed.
- If the source is Azure DevOps TFVC, mention it came from TFVC so readers understand the history.

Respond with strict JSON only, no prose outside the JSON:
{"description": "..."}`;
}

// ---------------------------------------------------------------------------
// Response parser (mirrors server/routes/ai.js:1479-1485 parse logic)
// Keep in sync with server/routes/ai.js:1479-1485.
// ---------------------------------------------------------------------------

/**
 * Parse the raw text from the AI provider and return a { description } object.
 *
 * Mirrors the route handler's fallback logic exactly: if the AI returns an
 * invalid or empty description, falls back to the deterministic default template.
 *
 * @param {string} text
 * @param {{ repoName: string, source: object }} inputForFallback
 * @returns {{ description: string }}
 */
export function parseResponse(text, inputForFallback) {
    const parsed = safeJsonParse(text);
    const rawDescription = parsed?.description;
    const description = typeof rawDescription === 'string' && rawDescription.trim()
        ? sanitizeRepoDescription(rawDescription)
        : defaultRepoDescription(inputForFallback);
    return { description };
}

// ---------------------------------------------------------------------------
// Adapter entry point (called by the eval runner)
// ---------------------------------------------------------------------------

/**
 * Run a single eval case through the migration-description handler logic.
 *
 * @param {{ input: object, mockResponse: string, provider: object }} opts
 * @returns {Promise<{ description: string }>}
 */
export async function runCase({ input, mockResponse, provider }) {
    // Build prompt (validates buildPrompt doesn't throw; mock ignores it).
    buildPrompt(input);

    // Call mock provider.
    const { text } = await provider.generate({ prompt: 'eval-prompt' });

    // Parse exactly as the route does.
    return parseResponse(text, { repoName: input.repoName, source: input.source });
}
