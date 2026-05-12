/**
 * Curated model catalogues per provider — used by the Model combobox in
 * Settings → AI Configuration so users can pick from a list instead of
 * typing an opaque model ID.
 *
 * These are suggestions; users can still type any custom ID (essential
 * for OpenRouter and Local providers where the catalogue is open-ended).
 *
 * Fields per entry:
 *   id          — canonical model identifier sent to the provider
 *   label       — short human name shown in the dropdown
 *   tier        — 'fast' | 'balanced' | 'smart' | 'reasoning' | 'open' (badge colour)
 *   description — one-line summary (used as secondary text)
 *   context     — optional context window, shown as "128K", "1M", etc.
 */

export const COMPLETION_MODELS = {
    gemini: [
        {
            id: 'gemini-2.5-flash',
            label: 'Gemini 2.5 Flash',
            tier: 'fast',
            description: 'Fast, low cost — best default for general use',
            context: '1M',
        },
        {
            id: 'gemini-2.5-pro',
            label: 'Gemini 2.5 Pro',
            tier: 'smart',
            description: 'Higher quality reasoning, larger budgets',
            context: '2M',
        },
    ],
    anthropic: [
        {
            id: 'claude-haiku-4-5-20251001',
            label: 'Claude Haiku 4.5',
            tier: 'fast',
            description: 'Fastest & cheapest Claude — good for chat',
            context: '200K',
        },
        {
            id: 'claude-sonnet-4-6',
            label: 'Claude Sonnet 4.6',
            tier: 'balanced',
            description: 'Balanced quality vs. cost — default',
            context: '200K',
        },
        {
            id: 'claude-opus-4-5',
            label: 'Claude Opus 4.5',
            tier: 'smart',
            description: 'Highest quality, higher cost',
            context: '200K',
        },
    ],
    openai: [
        {
            id: 'gpt-4o-mini',
            label: 'GPT-4o mini',
            tier: 'fast',
            description: 'Cheap, fast — default',
            context: '128K',
        },
        {
            id: 'gpt-4o',
            label: 'GPT-4o',
            tier: 'balanced',
            description: 'Multi-modal flagship',
            context: '128K',
        },
        {
            id: 'gpt-5-mini',
            label: 'GPT-5 mini',
            tier: 'fast',
            description: 'Newer small model',
            context: '128K',
        },
    ],
    openrouter: [
        {
            id: 'anthropic/claude-sonnet-4-6',
            label: 'Claude Sonnet 4.6 (via OR)',
            tier: 'balanced',
            description: 'OpenRouter route to Anthropic',
            context: '200K',
        },
        {
            id: 'openai/gpt-4o-mini',
            label: 'GPT-4o mini (via OR)',
            tier: 'fast',
            description: 'OpenRouter route to OpenAI',
            context: '128K',
        },
        {
            id: 'google/gemini-2.5-flash',
            label: 'Gemini 2.5 Flash (via OR)',
            tier: 'fast',
            description: 'OpenRouter route to Google',
            context: '1M',
        },
        {
            id: 'meta-llama/llama-3.3-70b-instruct',
            label: 'Llama 3.3 70B Instruct',
            tier: 'open',
            description: 'Open-weights via OpenRouter',
            context: '128K',
        },
    ],
    local: [], // open-ended — user types their own loaded model
}

export const EMBEDDING_MODELS = {
    gemini: [
        {
            id: 'gemini-embedding-001',
            label: 'gemini-embedding-001',
            tier: 'balanced',
            description: 'Google embeddings — 768 dims',
        },
    ],
    openai: [
        {
            id: 'text-embedding-3-small',
            label: 'text-embedding-3-small',
            tier: 'fast',
            description: '1536 dims — cheap, fast default',
        },
        {
            id: 'text-embedding-3-large',
            label: 'text-embedding-3-large',
            tier: 'smart',
            description: '3072 dims — best quality',
        },
    ],
    anthropic: [],
    openrouter: [],
    local: [],
}

export const TIER_LABELS = {
    fast: 'Fast',
    balanced: 'Balanced',
    smart: 'Smart',
    reasoning: 'Reasoning',
    open: 'Open weights',
    legacy: 'Legacy',
}

export const TIER_STYLES = {
    fast: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-800',
    balanced: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-900/40 dark:text-sky-200 dark:ring-sky-800',
    smart: 'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-900/40 dark:text-purple-200 dark:ring-purple-800',
    reasoning: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-800',
    open: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
}

export function getCompletionModels(provider) {
    return COMPLETION_MODELS[provider] || []
}

export function getEmbeddingModels(provider) {
    return EMBEDDING_MODELS[provider] || []
}

/**
 * Returns true if `releasedAt` (YYYY-MM-DD) is within the last 60 days.
 * Used to badge recently-released models as NEW in the picker.
 *
 * @param {string|null|undefined} releasedAt
 * @returns {boolean}
 */
export function isNewModel(releasedAt) {
    if (!releasedAt || typeof releasedAt !== 'string') return false
    const t = Date.parse(releasedAt)
    if (Number.isNaN(t)) return false
    const ageMs = Date.now() - t
    if (ageMs < 0) return false
    const dayMs = 24 * 60 * 60 * 1000
    return ageMs < 60 * dayMs
}

/**
 * Maps a capability key to its display metadata.
 * `iconName` is a lucide-react export name; the consumer resolves it.
 */
export const CAPABILITY_ICONS = {
    vision: { label: 'Vision (image input)', iconName: 'Image' },
    tools: { label: 'Tool / function calling', iconName: 'Wrench' },
    json: { label: 'Structured JSON output', iconName: 'Braces' },
    reasoning: { label: 'Reasoning / extended thinking', iconName: 'Brain' },
}

/**
 * Render order for tier sections in the dropdown. `legacy` always last
 * and is hidden behind a toggle.
 */
export const TIER_ORDER = ['fast', 'balanced', 'smart', 'reasoning', 'open', 'legacy']
