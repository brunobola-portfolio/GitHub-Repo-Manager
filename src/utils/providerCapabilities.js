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

export const PROVIDER_CAPABILITIES = {
    gemini: {
        aiChat: true,
        semanticSearch: true,
        codeReview: true,
        migration: true,
    },
    anthropic: {
        aiChat: true,
        semanticSearch: false, // no native embeddings — needs embedding provider override
        codeReview: true,
        migration: true,
    },
    openai: {
        aiChat: true,
        semanticSearch: true,
        codeReview: true,
        migration: true,
    },
    openrouter: {
        aiChat: true,
        semanticSearch: false, // depends on routed model
        codeReview: true,
        migration: true,
    },
    local: {
        aiChat: true,
        semanticSearch: false, // depends on local model
        codeReview: true,
        migration: true,
    },
}

export const FEATURE_LABELS = {
    aiChat: 'AI Chat',
    semanticSearch: 'Semantic Search',
    codeReview: 'Code Review',
    migration: 'Migration AI',
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
