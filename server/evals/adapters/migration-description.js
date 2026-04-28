/**
 * server/evals/adapters/migration-description.js
 *
 * Eval adapter for the migration-description AI handler.
 *
 * Exposes the handler's core logic (prompt generation + response parsing) as
 * a testable function that accepts a mock provider.
 *
 * Parse logic lives in server/lib/migration-ai-parsers.js (shared with the route).
 */

import { sanitizeForPrompt } from '../../ai-service.js';
import { REPO_DESCRIPTION_MAX } from '../../lib/repo-description.js';
import { parseDescriptionResponse } from '../../lib/migration-ai-parsers.js';

export const feature = 'migration-description';

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
// Adapter entry point (called by the eval runner)
// ---------------------------------------------------------------------------

/**
 * Run a single eval case through the migration-description handler logic.
 *
 * @param {{ input: object, mockResponse: string, provider: object }} opts
 * @returns {Promise<{ description: string }>}
 */
export async function runCase({ input, mockResponse: _mockResponse, provider }) {
    // Build prompt (validates buildPrompt doesn't throw; mock ignores it).
    buildPrompt(input);

    // Call mock provider.
    const { text } = await provider.generate({ prompt: 'eval-prompt' });

    // Parse using the shared parser (same as the route).
    return parseDescriptionResponse(text, { repoName: input.repoName, source: input.source });
}
