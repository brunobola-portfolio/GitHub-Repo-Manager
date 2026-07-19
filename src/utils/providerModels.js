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
            // Verified 2026-07-19 against ai.google.dev/gemini-api/docs/models,
            // /docs/whats-new-gemini-3.5, and /docs/pricing (GA 2026-05-19).
            id: 'gemini-3.5-flash',
            label: 'Gemini 3.5 Flash',
            tier: 'fast',
            description: 'Recommended replacement for Gemini 2.5 Flash — sustained frontier performance on agentic and coding tasks',
            context: '1M',
            maxOutput: '65K',
            cutoff: 'Jan 2025',
            recommended: true,
            releasedAt: '2026-05-19',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 1.50, output: 9.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gemini-2.5-flash-lite',
            label: 'Gemini 2.5 Flash-Lite',
            tier: 'fast',
            description: 'Fastest and most budget-friendly multimodal model',
            context: '1M',
            maxOutput: '8K',
            cutoff: 'Jan 2025',
            recommended: false,
            releasedAt: '2025-09-25',
            legacy: false,
            capabilities: ['vision', 'tools', 'json'],
            pricing: { input: 0.10, output: 0.40, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gemini-2.5-pro',
            label: 'Gemini 2.5 Pro',
            tier: 'smart',
            description: 'Most advanced — deep reasoning and coding',
            context: '2M',
            maxOutput: '64K',
            cutoff: 'Jan 2025',
            recommended: false,
            releasedAt: '2025-06-17',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 1.25, output: 10.00, currency: 'USD', per: '1M tokens' },
        },
        // Deprecated — Google will retire this no earlier than 2026-10-16;
        // recommended replacement is gemini-3.5-flash above. Confirmed against
        // ai.google.dev/gemini-api/docs/deprecations (2026-07-19).
        {
            id: 'gemini-2.5-flash',
            label: 'Gemini 2.5 Flash',
            tier: 'legacy',
            description: 'Deprecated — Google will retire this no earlier than Oct 16, 2026. Migrate to Gemini 3.5 Flash.',
            context: '1M',
            maxOutput: '8K',
            cutoff: 'Jan 2025',
            recommended: false,
            releasedAt: '2025-06-17',
            legacy: true,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 0.30, output: 2.50, currency: 'USD', per: '1M tokens' },
        },
    ],
    anthropic: [
        {
            // Verified 2026-07-19 against platform.claude.com/docs/en/about-claude/models/overview
            // and /docs/en/about-claude/pricing (launched 2026-06-30).
            id: 'claude-sonnet-5',
            label: 'Claude Sonnet 5',
            tier: 'balanced',
            description: 'Best combination of speed and intelligence — default. Introductory pricing ($2/$10 per 1M tokens) through Aug 31, 2026, then $3/$15 standard.',
            context: '1M',
            maxOutput: '128K',
            cutoff: 'Jan 2026',
            recommended: true,
            releasedAt: '2026-06-30',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 2.00, output: 10.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'claude-haiku-4-5',
            label: 'Claude Haiku 4.5',
            tier: 'fast',
            description: 'Fastest Claude with near-frontier intelligence',
            context: '200K',
            maxOutput: '64K',
            cutoff: 'Feb 2025',
            recommended: false,
            releasedAt: '2025-10-01',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 1.00, output: 5.00, currency: 'USD', per: '1M tokens' },
        },
        {
            // Verified 2026-07-19 against platform.claude.com/docs/en/about-claude/models/overview
            // and anthropic.com/news/claude-opus-4-8 (released 2026-05-28); supersedes Opus 4.7.
            id: 'claude-opus-4-8',
            label: 'Claude Opus 4.8',
            tier: 'smart',
            description: 'Most capable for complex agentic coding and enterprise work',
            context: '1M',
            maxOutput: '128K',
            cutoff: 'Jan 2026',
            recommended: false,
            releasedAt: '2026-05-28',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 5.00, output: 25.00, currency: 'USD', per: '1M tokens' },
        },
        // Legacy — hidden behind "Show legacy" toggle
        {
            id: 'claude-opus-4-7',
            label: 'Claude Opus 4.7',
            tier: 'legacy',
            description: 'Previous Opus generation — superseded by Opus 4.8',
            context: '1M',
            maxOutput: '128K',
            cutoff: 'Jan 2026',
            recommended: false,
            releasedAt: '2026-04-15',
            legacy: true,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 5.00, output: 25.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'claude-sonnet-4-6',
            label: 'Claude Sonnet 4.6',
            tier: 'legacy',
            description: 'Previous Sonnet generation — superseded by Sonnet 5',
            context: '1M',
            maxOutput: '64K',
            cutoff: 'Aug 2025',
            recommended: false,
            releasedAt: '2026-02-20',
            legacy: true,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 3.00, output: 15.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'claude-opus-4-6',
            label: 'Claude Opus 4.6',
            tier: 'legacy',
            description: 'Previous Opus generation',
            context: '1M',
            maxOutput: '128K',
            cutoff: 'May 2025',
            recommended: false,
            legacy: true,
            capabilities: ['vision', 'tools', 'reasoning'],
            pricing: { input: 5.00, output: 25.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'claude-sonnet-4-5',
            label: 'Claude Sonnet 4.5',
            tier: 'legacy',
            description: 'Previous Sonnet generation',
            context: '200K',
            maxOutput: '64K',
            cutoff: 'Jan 2025',
            recommended: false,
            legacy: true,
            capabilities: ['vision', 'tools', 'reasoning'],
            pricing: { input: 3.00, output: 15.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'claude-opus-4-5',
            label: 'Claude Opus 4.5',
            tier: 'legacy',
            description: 'Older Opus — kept for migration callers',
            context: '200K',
            maxOutput: '64K',
            cutoff: 'May 2025',
            recommended: false,
            legacy: true,
            capabilities: ['vision', 'tools', 'reasoning'],
            pricing: { input: 5.00, output: 25.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'claude-opus-4-1',
            label: 'Claude Opus 4.1',
            tier: 'legacy',
            description: 'Older Opus — pre-4.5 generation',
            context: '200K',
            maxOutput: '32K',
            cutoff: 'Mar 2025',
            recommended: false,
            legacy: true,
            capabilities: ['vision', 'tools', 'reasoning'],
            pricing: { input: 15.00, output: 75.00, currency: 'USD', per: '1M tokens' },
        },
    ],
    openai: [
        {
            // Verified 2026-07-19 against developers.openai.com/api/docs/models/gpt-5.6-luna
            // and /api/docs/pricing (GA 2026-07-09; supersedes GPT-5.5/5.4 per
            // /api/docs/guides/latest-model).
            id: 'gpt-5.6-luna',
            label: 'GPT-5.6 Luna',
            tier: 'fast',
            description: 'Efficient GPT-5.6-class model for cost-sensitive, high-volume workloads',
            context: '1M',
            maxOutput: '128K',
            cutoff: 'Feb 2026',
            recommended: true,
            releasedAt: '2026-07-09',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 1.00, output: 6.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gpt-5.6-terra',
            label: 'GPT-5.6 Terra',
            tier: 'balanced',
            description: 'Balances intelligence and cost for general-purpose coding and pro work',
            context: '1M',
            maxOutput: '128K',
            cutoff: 'Feb 2026',
            recommended: false,
            releasedAt: '2026-07-09',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 2.50, output: 15.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gpt-5.6-sol',
            label: 'GPT-5.6 Sol',
            tier: 'smart',
            description: 'Frontier GPT-5.6 model for complex professional work and agentic workflows',
            context: '1M',
            maxOutput: '128K',
            cutoff: 'Feb 2026',
            recommended: false,
            releasedAt: '2026-07-09',
            legacy: false,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 5.00, output: 30.00, currency: 'USD', per: '1M tokens' },
        },
        // Legacy — superseded by the GPT-5.6 family above, still callable.
        {
            id: 'gpt-5.4-mini',
            label: 'GPT-5.4 mini',
            tier: 'legacy',
            description: 'Strongest mini model for coding, computer use, subagents',
            context: '400K',
            maxOutput: '16K',
            cutoff: 'Oct 2025',
            recommended: false,
            releasedAt: '2026-03-10',
            legacy: true,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 0.75, output: 4.50, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gpt-5.4-nano',
            label: 'GPT-5.4 nano',
            tier: 'legacy',
            description: 'Cheapest GPT-5.4-class for high-volume simple tasks',
            context: '400K',
            maxOutput: '16K',
            cutoff: 'Oct 2025',
            recommended: false,
            releasedAt: '2026-03-10',
            legacy: true,
            capabilities: ['vision', 'tools', 'json'],
            pricing: { input: 0.20, output: 1.25, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gpt-5.4',
            label: 'GPT-5.4',
            tier: 'legacy',
            description: 'More affordable flagship for coding and pro work',
            context: '400K',
            maxOutput: '16K',
            cutoff: 'Oct 2025',
            recommended: false,
            releasedAt: '2026-02-01',
            legacy: true,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 2.50, output: 15.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gpt-5.5',
            label: 'GPT-5.5',
            tier: 'legacy',
            description: 'New class of intelligence for coding and pro work',
            context: '400K',
            maxOutput: '32K',
            cutoff: 'Oct 2025',
            recommended: false,
            releasedAt: '2026-04-22',
            legacy: true,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 5.00, output: 30.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gpt-5.4-pro',
            label: 'GPT-5.4 Pro',
            tier: 'legacy',
            description: 'Higher precision GPT-5.4 with deeper reasoning',
            context: '400K',
            maxOutput: '32K',
            cutoff: 'Oct 2025',
            recommended: false,
            releasedAt: '2026-02-01',
            legacy: true,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 30.00, output: 180.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gpt-5.5-pro',
            label: 'GPT-5.5 Pro',
            tier: 'legacy',
            description: 'Smartest, most precise GPT-5.5',
            context: '400K',
            maxOutput: '32K',
            cutoff: 'Oct 2025',
            recommended: false,
            releasedAt: '2026-04-22',
            legacy: true,
            capabilities: ['vision', 'tools', 'json', 'reasoning'],
            pricing: { input: 30.00, output: 180.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'gpt-4.1',
            label: 'GPT-4.1',
            tier: 'legacy',
            description: 'Smartest non-reasoning model',
            context: '1M',
            maxOutput: '32K',
            cutoff: 'Jun 2024',
            recommended: false,
            releasedAt: '2025-04-14',
            legacy: true,
            capabilities: ['vision', 'tools', 'json'],
            pricing: { input: 2.00, output: 8.00, currency: 'USD', per: '1M tokens' },
        },
    ],
    openrouter: [
        // Live-fetched by useProviderModels; fallback list when offline.
        {
            id: 'anthropic/claude-sonnet-4-6',
            label: 'Claude Sonnet 4.6 (via OR)',
            tier: 'balanced',
            description: 'OpenRouter route to Anthropic',
            context: '1M',
            recommended: true,
            legacy: false,
            capabilities: ['vision', 'tools', 'reasoning'],
            pricing: { input: 3.00, output: 15.00, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'openai/gpt-5.4-mini',
            label: 'GPT-5.4 mini (via OR)',
            tier: 'fast',
            description: 'OpenRouter route to OpenAI',
            context: '400K',
            recommended: false,
            legacy: false,
            capabilities: ['vision', 'tools'],
            pricing: { input: 0.75, output: 4.50, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'google/gemini-2.5-flash',
            label: 'Gemini 2.5 Flash (via OR)',
            tier: 'fast',
            description: 'OpenRouter route to Google',
            context: '1M',
            recommended: false,
            legacy: false,
            capabilities: ['vision', 'tools'],
            pricing: { input: 0.30, output: 2.50, currency: 'USD', per: '1M tokens' },
        },
        {
            id: 'meta-llama/llama-3.3-70b-instruct',
            label: 'Llama 3.3 70B Instruct',
            tier: 'open',
            description: 'Open-weights via OpenRouter',
            context: '128K',
            recommended: false,
            legacy: false,
            capabilities: ['tools'],
            pricing: { input: 0.30, output: 0.40, currency: 'USD', per: '1M tokens' },
        },
    ],
    local: [],
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
    legacy: 'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-900 dark:text-slate-500 dark:ring-slate-800',
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
