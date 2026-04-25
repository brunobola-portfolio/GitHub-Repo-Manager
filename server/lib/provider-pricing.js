// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Server-side AI provider pricing reference and cost estimator.
 *
 * Mirror of `src/utils/providerPricing.js` (kept independent so server code
 * never imports from src/). Used by Work Board AI cost-cap accounting and
 * any other route that needs to bill estimated spend.
 *
 * IMPORTANT: prices are informational. We never bill the user — they pay
 * their provider directly. Estimates exist so the per-user cost cap matches
 * reality within an order of magnitude rather than the previous flat 1¢.
 */

// Prices in USD per 1,000,000 tokens. Update alongside src/utils/providerPricing.js.
export const PROVIDER_PRICING = {
    'gemini-2.5-flash':  { input: 0.30, output: 2.50 },
    'gemini-2.5-pro':    { input: 1.25, output: 5.00 },
    'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
    'claude-opus-4-5':   { input: 15.00, output: 75.00 },
    'claude-haiku-4-5':  { input: 1.00, output: 5.00 },
    'gpt-4o-mini':       { input: 0.15, output: 0.60 },
    'gpt-4o':            { input: 2.50, output: 10.00 },
    'gpt-5-mini':        { input: 0.15, output: 0.60 },
    // Embedding-only models — input-priced, no output column.
    'text-embedding-3-small': { input: 0.02 },
    'text-embedding-3-large': { input: 0.13 },
    'gemini-embedding-001':   { input: 0.15 },
};

// Conservative fallback for models we don't recognise. Picked to be slightly
// pessimistic vs. the cheapest tier so estimates don't under-bill caps.
const FALLBACK_PRICING = { input: 0.50, output: 2.00 };

// Empirical heuristic: ~4 characters per token for English / code-like text.
// Off by ±30% in the worst case; good enough for cap accounting where the
// alternative was a flat constant.
const CHARS_PER_TOKEN = 4;

/**
 * Look up pricing for a model name, falling back to a known prefix when the
 * exact id (e.g. `gemini-2.5-flash-002`) doesn't match.
 *
 * @param {string|null|undefined} modelName
 * @returns {{ input: number, output?: number }}
 */
export function getPricingForModel(modelName) {
    if (!modelName) return FALLBACK_PRICING;
    if (PROVIDER_PRICING[modelName]) return PROVIDER_PRICING[modelName];

    let best = null;
    let bestLen = 0;
    for (const key of Object.keys(PROVIDER_PRICING)) {
        if (modelName.startsWith(key) && key.length > bestLen) {
            best = PROVIDER_PRICING[key];
            bestLen = key.length;
        }
    }
    return best ?? FALLBACK_PRICING;
}

/**
 * Estimate the cost in cents of a single completion call.
 *
 * @param {object} opts
 * @param {string|null|undefined} opts.modelName
 * @param {number} [opts.inputTokens]   — exact count when the SDK returns one
 * @param {number} [opts.outputTokens]  — exact count when the SDK returns one
 * @param {number} [opts.promptChars]   — fall back to char-based estimate
 * @param {number} [opts.responseChars] — ditto
 * @returns {number} cents (integer, rounded up so partial-cent calls still tick the meter)
 */
export function estimateCallCostCents({
    modelName,
    inputTokens,
    outputTokens,
    promptChars = 0,
    responseChars = 0,
} = {}) {
    const pricing = getPricingForModel(modelName);

    const inTok = Number.isFinite(inputTokens) && inputTokens >= 0
        ? inputTokens
        : Math.ceil(promptChars / CHARS_PER_TOKEN);
    const outTok = Number.isFinite(outputTokens) && outputTokens >= 0
        ? outputTokens
        : Math.ceil(responseChars / CHARS_PER_TOKEN);

    const inputDollars = (inTok / 1_000_000) * pricing.input;
    const outputDollars = pricing.output != null
        ? (outTok / 1_000_000) * pricing.output
        : 0;

    const cents = (inputDollars + outputDollars) * 100;
    // Always tick the meter at least 1 cent for accounted calls so frequent
    // tiny prompts don't free-ride past the cap.
    return Math.max(1, Math.ceil(cents));
}
