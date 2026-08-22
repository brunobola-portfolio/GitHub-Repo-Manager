/**
 * Indicative pricing data for known AI models.
 *
 * Prices are informational only — not billed by this application.
 * Users pay their AI provider directly.
 *
 * Structure per entry:
 *  input   — USD per 1 million input tokens
 *  output  — USD per 1 million output tokens (undefined for embedding-only models)
 *  currency — always 'USD'
 *  per     — always '1M tokens'
 */

export const PROVIDER_PRICING = {
    // Gemini current — verified 2026-07-19 against ai.google.dev/gemini-api/docs/pricing
    'gemini-3.5-flash':       { input: 1.50, output: 9.00, currency: 'USD', per: '1M tokens' },
    'gemini-2.5-flash-lite':  { input: 0.10, output: 0.40, currency: 'USD', per: '1M tokens' },
    'gemini-2.5-pro':         { input: 1.25, output: 10.00, currency: 'USD', per: '1M tokens' },
    // Gemini legacy — deprecated, retires no earlier than 2026-10-16
    'gemini-2.5-flash':       { input: 0.30, output: 2.50, currency: 'USD', per: '1M tokens' },
    // Anthropic current — verified 2026-07-19 against platform.claude.com/docs/en/about-claude/pricing.
    // claude-sonnet-5 is introductory pricing through 2026-08-31; standard $3.00/$15.00 from 2026-09-01.
    'claude-sonnet-5':        { input: 2.00, output: 10.00, currency: 'USD', per: '1M tokens' },
    'claude-haiku-4-5':       { input: 1.00, output: 5.00, currency: 'USD', per: '1M tokens' },
    'claude-opus-4-8':        { input: 5.00, output: 25.00, currency: 'USD', per: '1M tokens' },
    // Anthropic legacy
    'claude-opus-4-7':        { input: 5.00, output: 25.00, currency: 'USD', per: '1M tokens' },
    'claude-sonnet-4-6':      { input: 3.00, output: 15.00, currency: 'USD', per: '1M tokens' },
    'claude-opus-4-6':        { input: 5.00, output: 25.00, currency: 'USD', per: '1M tokens' },
    'claude-sonnet-4-5':      { input: 3.00, output: 15.00, currency: 'USD', per: '1M tokens' },
    'claude-opus-4-5':        { input: 5.00, output: 25.00, currency: 'USD', per: '1M tokens' },
    'claude-opus-4-1':        { input: 15.00, output: 75.00, currency: 'USD', per: '1M tokens' },
    // OpenAI current — verified 2026-07-19 against developers.openai.com/api/docs/pricing (GA 2026-07-09)
    'gpt-5.6-sol':            { input: 5.00, output: 30.00, currency: 'USD', per: '1M tokens' },
    'gpt-5.6-terra':          { input: 2.50, output: 15.00, currency: 'USD', per: '1M tokens' },
    'gpt-5.6-luna':           { input: 1.00, output: 6.00, currency: 'USD', per: '1M tokens' },
    // OpenAI legacy — superseded by GPT-5.6, still callable
    'gpt-5.4-mini':           { input: 0.75, output: 4.50, currency: 'USD', per: '1M tokens' },
    'gpt-5.4-nano':           { input: 0.20, output: 1.25, currency: 'USD', per: '1M tokens' },
    'gpt-5.4':                { input: 2.50, output: 15.00, currency: 'USD', per: '1M tokens' },
    'gpt-5.5':                { input: 5.00, output: 30.00, currency: 'USD', per: '1M tokens' },
    'gpt-5.4-pro':            { input: 30.00, output: 180.00, currency: 'USD', per: '1M tokens' },
    'gpt-5.5-pro':            { input: 30.00, output: 180.00, currency: 'USD', per: '1M tokens' },
    'gpt-4.1':                { input: 2.00, output: 8.00, currency: 'USD', per: '1M tokens' },
    // OpenAI superseded but still callable
    'gpt-5-mini':             { input: 0.15, output: 0.60, currency: 'USD', per: '1M tokens' },
    'gpt-4o':                 { input: 2.50, output: 10.00, currency: 'USD', per: '1M tokens' },
    'gpt-4o-mini':            { input: 0.15, output: 0.60, currency: 'USD', per: '1M tokens' },
    // OpenRouter open-weights fallback option, keyed by the bare id (matches
    // the server-side mirror). Note this frontend getPricingForModel does
    // prefix matching only, not vendor-prefix stripping, so a literal lookup
    // of 'meta-llama/llama-3.3-70b-instruct' still won't resolve here — the
    // ModelCombobox displays this entry's own embedded `pricing` instead.
    'llama-3.3-70b-instruct': { input: 0.30, output: 0.40, currency: 'USD', per: '1M tokens' },
    // Embeddings
    'text-embedding-3-small': { input: 0.02, currency: 'USD', per: '1M tokens' },
    'text-embedding-3-large': { input: 0.13, currency: 'USD', per: '1M tokens' },
    'gemini-embedding-001':   { input: 0.15, currency: 'USD', per: '1M tokens' },
}

export const PRICING_LAST_UPDATED = '2026-07-19'

/**
 * Look up pricing for a model name using prefix matching.
 * E.g. 'gemini-2.5-flash-latest' → matches 'gemini-2.5-flash'.
 *
 * @param {string|null|undefined} modelName
 * @returns {{ input: number, output?: number, currency: string, per: string }|null}
 */
export function getPricingForModel(modelName) {
    if (!modelName) return null

    // Exact match first
    if (PROVIDER_PRICING[modelName]) return PROVIDER_PRICING[modelName]

    // Prefix match — find longest key that the model name starts with
    let best = null
    let bestLen = 0
    for (const key of Object.keys(PROVIDER_PRICING)) {
        if (modelName.startsWith(key) && key.length > bestLen) {
            best = PROVIDER_PRICING[key]
            bestLen = key.length
        }
    }
    return best
}

/**
 * Format a pricing entry into a short display string.
 * E.g. "$0.30 in / $2.50 out per 1M tokens" or "$0.02 per 1M tokens" for embedding.
 *
 * @param {{ input: number, output?: number, currency: string, per: string }|null} pricing
 * @returns {string}
 */
export function formatPricing(pricing) {
    if (!pricing) return 'Pricing unknown — check provider docs'

    const fmt = (n) => `$${n % 1 === 0 ? n.toFixed(0) : n % 0.1 === 0 ? n.toFixed(1) : n.toFixed(2)}`

    if (pricing.output !== undefined) {
        return `${fmt(pricing.input)} in / ${fmt(pricing.output)} out per ${pricing.per}`
    }
    return `${fmt(pricing.input)} per ${pricing.per}`
}

/**
 * Classify a pricing entry by output price per million tokens.
 * Used to colour-code the pricing block in the model picker.
 *
 * @param {{ output?: number }|null|undefined} pricing
 * @returns {'cheap'|'mid'|'premium'|null}
 */
export function pricingTier(pricing) {
    if (!pricing || typeof pricing.output !== 'number') return null
    if (pricing.output <= 5) return 'cheap'
    if (pricing.output <= 30) return 'mid'
    return 'premium'
}

export const PRICING_TIER_CLS = {
    cheap: 'text-emerald-700 dark:text-emerald-300',
    mid: 'text-slate-600 dark:text-slate-300',
    premium: 'text-rose-500 dark:text-rose-300',
}
