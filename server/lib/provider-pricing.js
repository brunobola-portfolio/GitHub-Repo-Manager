// SPDX-License-Identifier: Apache-2.0
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

// Prices in USD per 1,000,000 tokens. Must mirror src/utils/providerPricing.js
// exactly (input/output per model id) — server/__tests__/provider-pricing.test.js
// asserts parity so a drift here can't silently under-meter BYOK spend caps.
export const PROVIDER_PRICING = {
    // Gemini current
    'gemini-3.5-flash':       { input: 1.50, output: 9.00 },
    'gemini-2.5-flash-lite':  { input: 0.10, output: 0.40 },
    'gemini-2.5-pro':         { input: 1.25, output: 10.00 },
    // Gemini legacy — deprecated, retires no earlier than 2026-10-16
    'gemini-2.5-flash':       { input: 0.30, output: 2.50 },
    // Anthropic current
    'claude-sonnet-5':        { input: 2.00, output: 10.00 },
    'claude-haiku-4-5':       { input: 1.00, output: 5.00 },
    'claude-opus-4-8':        { input: 5.00, output: 25.00 },
    // Anthropic legacy
    'claude-opus-4-7':        { input: 5.00, output: 25.00 },
    'claude-sonnet-4-6':      { input: 3.00, output: 15.00 },
    'claude-opus-4-6':        { input: 5.00, output: 25.00 },
    'claude-sonnet-4-5':      { input: 3.00, output: 15.00 },
    'claude-opus-4-5':        { input: 5.00, output: 25.00 },
    'claude-opus-4-1':        { input: 15.00, output: 75.00 },
    // OpenAI current
    'gpt-5.6-sol':            { input: 5.00, output: 30.00 },
    'gpt-5.6-terra':          { input: 2.50, output: 15.00 },
    'gpt-5.6-luna':           { input: 1.00, output: 6.00 },
    // OpenAI legacy — superseded by GPT-5.6, still callable
    'gpt-5.4-mini':           { input: 0.75, output: 4.50 },
    'gpt-5.4-nano':           { input: 0.20, output: 1.25 },
    'gpt-5.4':                { input: 2.50, output: 15.00 },
    'gpt-5.5':                { input: 5.00, output: 30.00 },
    'gpt-5.4-pro':            { input: 30.00, output: 180.00 },
    'gpt-5.5-pro':            { input: 30.00, output: 180.00 },
    'gpt-4.1':                { input: 2.00, output: 8.00 },
    // OpenAI superseded but still callable
    'gpt-5-mini':             { input: 0.15, output: 0.60 },
    'gpt-4o':                 { input: 2.50, output: 10.00 },
    'gpt-4o-mini':            { input: 0.15, output: 0.60 },
    // OpenRouter open-weights fallback option — the vendor-prefix strip in
    // getPricingForModel resolves 'meta-llama/llama-3.3-70b-instruct' here.
    'llama-3.3-70b-instruct': { input: 0.30, output: 0.40 },
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

    // Try the raw id first — both exact match and longest-prefix match.
    const direct = lookupByPrefix(modelName);
    if (direct) return direct;

    // OpenRouter (and similar aggregators) prefix model ids with a vendor
    // namespace, e.g. `anthropic/claude-sonnet-4-6`. Strip a single leading
    // `<vendor>/` and re-attempt before falling back to the conservative
    // estimate — otherwise we under-report cost ~6× for OpenRouter users.
    const slashIdx = modelName.indexOf('/');
    if (slashIdx > 0 && slashIdx < modelName.length - 1) {
        const stripped = modelName.slice(slashIdx + 1);
        const second = lookupByPrefix(stripped);
        if (second) return second;
    }

    return FALLBACK_PRICING;
}

// Internal: exact match → longest-prefix match against PROVIDER_PRICING.
// Returns null when nothing matches so the caller can decide between
// further normalisation passes and the conservative fallback.
function lookupByPrefix(name) {
    if (PROVIDER_PRICING[name]) return PROVIDER_PRICING[name];
    let best = null;
    let bestLen = 0;
    for (const key of Object.keys(PROVIDER_PRICING)) {
        if (name.startsWith(key) && key.length > bestLen) {
            best = PROVIDER_PRICING[key];
            bestLen = key.length;
        }
    }
    return best;
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

/**
 * Compute the precise USD cost of a single call given exact token counts.
 *
 * Returns `null` when usage is unavailable (no input/output tokens) — callers
 * should treat this as "cost unknown" rather than zero. Unlike
 * estimateCallCostCents this does NOT round up to a 1¢ floor: it returns
 * the raw fractional dollar cost so the caller can persist it precisely.
 *
 * Used by provider wrappers to surface `costUSD` alongside `usage` from
 * `generate()`.
 *
 * @param {object} opts
 * @param {string|null|undefined} opts.modelName
 * @param {number|null|undefined} opts.inputTokens
 * @param {number|null|undefined} opts.outputTokens
 * @returns {number|null} dollars (fractional), or null when no usage data
 */
export function computeCostUSD({ modelName, inputTokens, outputTokens } = {}) {
    const hasInput = Number.isFinite(inputTokens) && inputTokens >= 0;
    const hasOutput = Number.isFinite(outputTokens) && outputTokens >= 0;
    if (!hasInput && !hasOutput) return null;

    // Fall back ONLY when the model is genuinely unknown — keep the user's
    // signal honest. We still return the fallback estimate (rather than null)
    // because the caller has real token counts; a coarse price is better than
    // dropping the cost entirely.
    const pricing = getPricingForModel(modelName);

    const inDollars = hasInput ? (inputTokens / 1_000_000) * pricing.input : 0;
    const outDollars = hasOutput && pricing.output != null
        ? (outputTokens / 1_000_000) * pricing.output
        : 0;

    return inDollars + outDollars;
}
