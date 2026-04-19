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
 * Parse logic mirrors server/routes/ai.js:1382-1430.
 * Keep in sync if the route handler changes.
 */

export const feature = 'migration-size-strategy';

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
// Prompt builder (mirrors server/routes/ai.js:1393-1407)
// Keep in sync with server/routes/ai.js:1393-1407 prompt template.
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
- "lfs-migrate": run git-lfs migrate import --above=100M before pushing; appropriate when the size is caused by large binary assets.

Respond with strict JSON only, no prose outside the JSON:
{"strategy": "exclude" | "lfs-migrate", "rationale": "one short sentence", "confidence": 0.0-1.0}`;
}

// ---------------------------------------------------------------------------
// Response parser (mirrors server/routes/ai.js:1414-1425 parse logic)
// Keep in sync with server/routes/ai.js:1414-1425.
// ---------------------------------------------------------------------------

/**
 * Parse and validate the raw text from the AI provider.
 *
 * Mirrors the route handler's parse path exactly, including the same clamping
 * of confidence and slicing of rationale. Returns null if the response is
 * structurally invalid (unknown strategy).
 *
 * @param {string} text
 * @returns {{ strategy: string, rationale: string, confidence: number } | null}
 */
export function parseResponse(text) {
    const parsed = safeJsonParse(text);
    if (!parsed || !['exclude', 'lfs-migrate'].includes(parsed.strategy)) {
        return null;
    }
    return {
        strategy: parsed.strategy,
        rationale: String(parsed.rationale || '').slice(0, 500),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    };
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
export async function runCase({ input, mockResponse, provider }) {
    // Build the prompt exactly as the route does (irrelevant for mock evals,
    // but verifies that buildPrompt doesn't throw on the given input).
    buildPrompt(input);

    // Call the mock provider — it ignores the prompt and returns mockResponse.
    const { text } = await provider.generate({ prompt: 'eval-prompt' });

    // Parse the response exactly as the route does.
    return parseResponse(text);
}
