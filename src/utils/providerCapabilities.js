/**
 * Provider capability matrix — hardcoded, used by AIConfigSection.
 *
 * Each entry describes which features a given provider supports.
 * Features:
 *  - aiChat:       AI Chat (POST /api/ai/chat, start-chat, streaming)
 *  - semanticSearch: Semantic / embedding-based repo search
 *  - codeReview:   AI code review on PRs
 *  - migration:    AI-assisted migration planning
 */

export const PROVIDER_IDS = ['gemini', 'anthropic', 'openai', 'openrouter', 'local']

export const PROVIDER_LABELS = {
    gemini: 'Gemini',
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
    local: 'Local (LMStudio / Ollama)',
}

/**
 * Tri-state feature values:
 *  'yes'     — supported natively
 *  'no'      — not supported
 *  'depends' — support depends on configuration (e.g. routed model or local model loaded)
 */
export const PROVIDER_CAPABILITIES = {
    gemini: {
        aiChat: 'yes',
        semanticSearch: 'yes',
        codeReview: 'yes',
        migration: 'yes',
    },
    anthropic: {
        aiChat: 'yes',
        semanticSearch: 'no', // no native embeddings — needs embedding provider override
        codeReview: 'yes',
        migration: 'yes',
    },
    openai: {
        aiChat: 'yes',
        semanticSearch: 'yes',
        codeReview: 'yes',
        migration: 'yes',
    },
    openrouter: {
        aiChat: 'yes',
        semanticSearch: 'depends', // OpenRouter routes to backends; some models support embeddings
        codeReview: 'yes',
        migration: 'yes',
    },
    local: {
        aiChat: 'yes',
        semanticSearch: 'depends', // depends on the local model loaded
        codeReview: 'yes',
        migration: 'yes',
    },
}

export const FEATURE_LABELS = {
    aiChat: 'AI Chat',
    semanticSearch: 'Semantic Search',
    codeReview: 'Code Review',
    migration: 'Migration AI',
}

/**
 * Feature keys for per-feature model overrides (stored as UPPER_SNAKE in DB).
 * Must match the keys used server-side when calling createProviderForUser({ featureKey }).
 */
export const FEATURE_KEYS = [
    'CHAT',
    'PR_REVIEW',
    'MIGRATION_DESCRIPTION',
    'MIGRATION_SIZE',
    'README_ANALYSIS',
    'EMBED',
]

/**
 * Human-readable labels for feature keys shown in the Settings UI.
 */
export const FEATURE_KEY_LABELS = {
    CHAT: 'AI Chat',
    PR_REVIEW: 'PR Review',
    MIGRATION_DESCRIPTION: 'Migration Description',
    MIGRATION_SIZE: 'Migration Size Strategy',
    README_ANALYSIS: 'README Analysis',
    EMBED: 'Embeddings',
}

/**
 * Provider defaults for form fields.
 */
export const PROVIDER_DEFAULTS = {
    gemini: {
        model: 'gemini-2.5-flash',
        modelPlaceholder: 'gemini-2.5-flash',
        showEndpointUrl: false,
        apiKeyRequired: true,
        apiKeyLabel: 'Gemini API Key',
        apiKeyPlaceholder: 'AIza...',
        helpText: null,
        modelHelp: null,
    },
    anthropic: {
        model: 'claude-sonnet-4-6',
        modelPlaceholder: 'claude-sonnet-4-6',
        showEndpointUrl: false,
        apiKeyRequired: true,
        apiKeyLabel: 'Anthropic API Key',
        apiKeyPlaceholder: 'sk-ant-...',
        helpText: "Anthropic doesn't offer embeddings — configure an Embedding Provider below if you use semantic search features.",
        modelHelp: null,
    },
    openai: {
        model: 'gpt-4o-mini',
        modelPlaceholder: 'gpt-4o-mini',
        embeddingModel: 'text-embedding-3-small',
        showEndpointUrl: false,
        apiKeyRequired: true,
        apiKeyLabel: 'OpenAI API Key',
        apiKeyPlaceholder: 'sk-...',
        helpText: null,
        modelHelp: null,
    },
    openrouter: {
        model: '',
        modelPlaceholder: 'anthropic/claude-sonnet-4-6',
        showEndpointUrl: false,
        apiKeyRequired: true,
        apiKeyLabel: 'OpenRouter API Key',
        apiKeyPlaceholder: 'sk-or-...',
        helpText: null,
        modelHelp: 'Browse models at openrouter.ai/models',
        modelHelpUrl: 'https://openrouter.ai/models',
    },
    local: {
        model: '',
        modelPlaceholder: 'local-model',
        showEndpointUrl: true,
        endpointPlaceholder: 'http://localhost:1234/v1',
        apiKeyRequired: false,
        apiKeyLabel: 'API Key (optional)',
        apiKeyPlaceholder: 'Leave empty for no auth',
        helpText: 'Point at your LMStudio or Ollama server.',
        modelHelp: null,
    },
}
