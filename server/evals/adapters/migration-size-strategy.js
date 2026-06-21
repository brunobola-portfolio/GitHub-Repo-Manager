/**
 * server/evals/adapters/migration-size-strategy.js
 *
 * Eval adapter for the migration-size-strategy AI handler.
 *
 * Exposes the handler's core logic (prompt generation + response parsing) as
 * a testable function that accepts a mock provider. The eval framework calls
 * this adapter with a mock provider configured to return a fixed response string,
 * so the actual prompt text doesn't matter for MVP — what we're testing is the
 * parse/validation logic.
 *
 * Parse logic lives in server/lib/migration-ai-parsers.js (shared with the route).
 */

import { sanitizeForPrompt } from '../../ai-service.js';
import { parseSizeStrategyResponse } from '../../lib/migration-ai-parsers.js';

export const feature = 'migration-size-strategy';

// ---------------------------------------------------------------------------
// Prompt builder (mirrors server/routes/ai.js:1393-1407 prompt template)
// Keep in sync with server/routes/ai.js:1393-1407.
// ---------------------------------------------------------------------------

/**
 * Build the migration-size-strategy prompt from input facts.
 * @param {{ size: number, hasLfsMarker: boolean, branches: number, lastCommitDate?: string }} input
 * @returns {string}
 */
export function buildPrompt(input) {
    const { size, hasLfsMarker, branches, lastCommitDate } = input;
    const sizeGb = (size / (1024 * 1024)).toFixed(1);
    return `You are a migration assistant helping decide the best strategy for a repository that exceeds GitHub's 10 GB push limit.

Repository facts (no names or business context provided):
- Size: ${sizeGb} GB
- Has LFS markers in .gitattributes: ${hasLfsMarker ? 'yes' : 'no'}
- Branch count: ${branches}
- Last commit date: ${sanitizeForPrompt(lastCommitDate || 'unknown', 50)}

Choose exactly one strategy from: "exclude" or "lfs-migrate".
- "exclude": the repository is stale, archival, or too unwieldy; skip it.
- "lfs-migrate": run git-lfs migrate import --above=100MiB before pushing; appropriate when the size is caused by large binary assets.

Respond with strict JSON only, no prose outside the JSON:
{"strategy": "exclude" | "lfs-migrate", "rationale": "one short sentence", "confidence": 0.0-1.0}`;
}

// ---------------------------------------------------------------------------
// Adapter entry point (called by the eval runner)
// ---------------------------------------------------------------------------

/**
 * Run a single eval case through the migration-size-strategy handler logic.
 *
 * @param {{ input: object, mockResponse: string, provider: object }} opts
 * @returns {Promise<{ strategy: string, rationale: string, confidence: number } | null>}
 */
export async function runCase({ input, mockResponse: _mockResponse, provider }) {
    // Build the prompt exactly as the route does (irrelevant for mock evals,
    // but verifies that buildPrompt doesn't throw on the given input).
    buildPrompt(input);

    // Call the mock provider — it ignores the prompt and returns mockResponse.
    const { text } = await provider.generate({ prompt: 'eval-prompt' });

    // Parse the response using the shared parser (same as the route).
    return parseSizeStrategyResponse(text);
}
