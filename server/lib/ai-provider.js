/**
 * AI Provider abstraction layer.
 *
 * Exports:
 *  - AIError          — normalised error class with typed codes
 *  - AI_ERROR_CODE    — frozen enum of error codes
 *  - GeminiProvider   — Gemini implementation of the provider interface
 *  - createProvider   — factory; reads env to build the right provider
 *  - toAIError        — maps raw SDK errors → AIError
 *
 * Provider interface (documented via JSDoc, enforced by convention):
 *  generate({ prompt?, parts?, schema?, generationConfig?, systemPrompt? })
 *    → Promise<{ text: string, parsed?: any }>
 *  embed(text)
 *    → Promise<number[]>
 *  generateStream({ prompt, generationConfig?, signal? })
 *    → AsyncIterable<string>   (yields text chunks only, no accumulation)
 *
 * Adding a future provider (e.g. Anthropic):
 *  1. Create AnthropicProvider implementing the same interface.
 *  2. Add 'anthropic' branch in createProvider().
 *  3. Set AI_PROVIDER=anthropic in env.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from './logger.js';

// Lazy imports for providers to avoid circular deps at module load.
// Resolved in the PROVIDERS registry below.
let _AnthropicProvider, _OpenAIProvider, _OpenRouterProvider, _LocalProvider;
async function _loadProviders() {
    if (!_AnthropicProvider) {
        ({ AnthropicProvider: _AnthropicProvider } = await import('./providers/anthropic.js'));
        ({ OpenAIProvider: _OpenAIProvider } = await import('./providers/openai.js'));
        ({ OpenRouterProvider: _OpenRouterProvider } = await import('./providers/openrouter.js'));
        ({ LocalProvider: _LocalProvider } = await import('./providers/local.js'));
    }
}

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

export const AI_ERROR_CODE = Object.freeze({
    QUOTA: 'QUOTA',
    AUTH: 'AUTH',
    OVERLOAD: 'OVERLOAD',
    NOT_FOUND: 'NOT_FOUND',
    INVALID_RESPONSE: 'INVALID_RESPONSE',
    CANCELED: 'CANCELED',
    UNKNOWN: 'UNKNOWN',
});

export class AIError extends Error {
    /**
     * @param {object} opts
     * @param {string} opts.code       — one of AI_ERROR_CODE
     * @param {string} [opts.message]  — human-readable message
     * @param {number} [opts.status]   — HTTP status hint (for middleware mapping)
     * @param {unknown} [opts.cause]   — original error (preserved for logging)
     */
    constructor({ code, message, status, cause } = {}) {
        super(message || code, cause ? { cause } : undefined);
        this.name = 'AIError';
        this.code = code || AI_ERROR_CODE.UNKNOWN;
        this.status = status;
    }
}

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------

/**
 * Convert an arbitrary vendor SDK error into an AIError.
 * Preserves the original error in `.cause` for logging.
 *
 * @param {unknown} err
 * @returns {AIError}
 */
export function toAIError(err) {
    if (err instanceof AIError) return err;

    const msg = err?.message || '';
    const status = err?.status;

    if (status === 404 || /not found/i.test(msg)) {
        return new AIError({ code: AI_ERROR_CODE.NOT_FOUND, message: msg, status: 404, cause: err });
    }
    if (status === 401 || /API key/i.test(msg)) {
        return new AIError({ code: AI_ERROR_CODE.AUTH, message: msg, status: 401, cause: err });
    }
    if (status === 429 || /quota/i.test(msg)) {
        return new AIError({ code: AI_ERROR_CODE.QUOTA, message: msg, status: 429, cause: err });
    }
    if (status === 503 || /overload|unavailable|high demand/i.test(msg)) {
        return new AIError({ code: AI_ERROR_CODE.OVERLOAD, message: msg, status: 503, cause: err });
    }

    return new AIError({ code: AI_ERROR_CODE.UNKNOWN, message: msg, status, cause: err });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip markdown code fences from AI text output.
 * Handles ```json ... ``` and ``` ... ``` variants.
 *
 * @param {string} text
 * @returns {string}
 */
function stripMarkdownFences(text) {
    return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

// ---------------------------------------------------------------------------
// GeminiProvider
// ---------------------------------------------------------------------------

export class GeminiProvider {
    /**
     * @param {object} opts
     * @param {string} opts.apiKey
     * @param {string} [opts.model]          — default model name
     * @param {string} [opts.embeddingModel] — embedding model name
     */
    constructor({ apiKey, model = 'gemini-2.5-flash', embeddingModel = 'gemini-embedding-001' }) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this._modelName = model;
        this._embeddingModelName = embeddingModel;

        // Eagerly construct model handles so initialization errors surface early.
        try {
            this.model = this.genAI.getGenerativeModel({ model });
        } catch (err) {
            logger.error({ err, model }, 'GeminiProvider: failed to initialise model');
            this.model = null;
        }

        try {
            this.embeddingModel = this.genAI.getGenerativeModel({ model: embeddingModel });
        } catch (err) {
            logger.error({ err, model: embeddingModel }, 'GeminiProvider: failed to initialise embedding model');
            this.embeddingModel = null;
        }
    }

    /**
     * Escape hatch — returns the raw GoogleGenerativeAI SDK instance.
     * Used by legacy `req.genAI` path and tests that mock the SDK directly.
     */
    get rawSDK() {
        return this.genAI;
    }

    // -------------------------------------------------------------------------
    // generate
    // -------------------------------------------------------------------------

    /**
     * Generate text (or structured JSON) from the model.
     *
     * @param {object} opts
     * @param {string} [opts.prompt]           — simple text prompt
     * @param {Array}  [opts.parts]            — multi-part contents array (anti-injection)
     * @param {object} [opts.schema]           — JSON schema; if set, response is parsed
     * @param {object} [opts.generationConfig] — passed through to SDK
     * @param {string} [opts.systemPrompt]     — prepended to prompt (ignored when parts provided)
     * @param {string} [opts.modelOverride]    — use a different model for this call only
     * @returns {Promise<{ text: string, parsed?: any }>}
     */
    async generate({ prompt, parts, schema, generationConfig, systemPrompt, modelOverride } = {}) {
        const modelName = modelOverride || this._modelName;
        const sdkModel = modelOverride
            ? this.genAI.getGenerativeModel({ model: modelName })
            : this.model;

        if (!sdkModel) {
            throw new AIError({
                code: AI_ERROR_CODE.NOT_FOUND,
                message: 'AI model not initialized. Please check GEMINI_API_KEY and GEMINI_MODEL configuration.',
                status: 503,
            });
        }

        let request;

        if (parts) {
            // Multi-part / structured contents path (preserves anti-injection partitioning)
            request = {
                contents: [{ role: 'user', parts }],
                ...(generationConfig ? { generationConfig } : {}),
            };
        } else if (schema) {
            // Structured response with schema
            const fullPrompt = systemPrompt ? systemPrompt + '\n\n' + (prompt || '') : (prompt || '');
            request = {
                contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: schema,
                    ...(generationConfig || {}),
                },
            };
        } else {
            // Simple prompt path
            const fullPrompt = systemPrompt ? systemPrompt + '\n\n' + (prompt || '') : (prompt || '');
            request = generationConfig
                ? { contents: [{ role: 'user', parts: [{ text: fullPrompt }] }], generationConfig }
                : fullPrompt;
        }

        try {
            const result = await sdkModel.generateContent(request);
            const raw = result.response.text();
            const text = stripMarkdownFences(raw);

            if (schema) {
                try {
                    const parsed = JSON.parse(text);
                    return { text, parsed };
                } catch (parseErr) {
                    throw new AIError({
                        code: AI_ERROR_CODE.INVALID_RESPONSE,
                        message: `AI returned text that could not be parsed as JSON: ${text.slice(0, 200)}`,
                        cause: parseErr,
                    });
                }
            }

            return { text };
        } catch (err) {
            if (err instanceof AIError) throw err;
            throw toAIError(err);
        }
    }

    // -------------------------------------------------------------------------
    // embed
    // -------------------------------------------------------------------------

    /**
     * Generate an embedding vector for the given text.
     *
     * @param {string} text
     * @returns {Promise<number[]>}
     */
    async embed(text) {
        if (!this.embeddingModel) {
            throw new AIError({
                code: AI_ERROR_CODE.NOT_FOUND,
                message: 'AI embedding model not initialized. Please check GEMINI_API_KEY configuration.',
                status: 503,
            });
        }

        try {
            const result = await this.embeddingModel.embedContent(text);
            return result.embedding.values;
        } catch (err) {
            throw toAIError(err);
        }
    }

    // -------------------------------------------------------------------------
    // generateStream
    // -------------------------------------------------------------------------

    /**
     * Generate a text stream. Yields string chunks as they arrive.
     * Does NOT accumulate — callers are responsible for accumulation.
     *
     * @param {object} opts
     * @param {string} [opts.prompt]           — text prompt
     * @param {Array}  [opts.parts]            — multi-part contents (overrides prompt)
     * @param {object} [opts.generationConfig]
     * @param {AbortSignal} [opts.signal]      — abort on client disconnect
     * @param {string} [opts.modelOverride]
     * @returns {AsyncGenerator<string>}
     */
    async *generateStream({ prompt, parts, generationConfig, signal, modelOverride } = {}) {
        const modelName = modelOverride || this._modelName;
        const sdkModel = modelOverride
            ? this.genAI.getGenerativeModel({ model: modelName })
            : this.model;

        if (!sdkModel) {
            throw new AIError({
                code: AI_ERROR_CODE.NOT_FOUND,
                message: 'AI model not initialized. Please check GEMINI_API_KEY and GEMINI_MODEL configuration.',
                status: 503,
            });
        }

        const contents = parts
            ? [{ role: 'user', parts }]
            : [{ role: 'user', parts: [{ text: prompt || '' }] }];

        const request = {
            contents,
            ...(generationConfig ? { generationConfig } : {}),
        };

        let streamResult;
        try {
            streamResult = await sdkModel.generateContentStream(request);
        } catch (err) {
            throw toAIError(err);
        }

        for await (const chunk of streamResult.stream) {
            if (signal?.aborted) break;
            const text = chunk.text();
            if (text) yield text;
        }
    }
}

// ---------------------------------------------------------------------------
// createProvider factory
// ---------------------------------------------------------------------------

/**
 * Create a provider instance for a specific feature.
 *
 * Reads:
 *   AI_PROVIDER              — 'gemini' (default) | future providers
 *   GEMINI_API_KEY           — required for Gemini
 *   GEMINI_MODEL             — base model override
 *   GEMINI_EMBEDDING_MODEL   — embedding model override
 *   AI_MODEL_<FEATURE>       — per-feature model override (e.g. AI_MODEL_REVIEW)
 *
 * @param {string} [featureKey]  — UPPER_SNAKE key e.g. 'CHAT', 'REVIEW', 'EMBED'
 * @returns {GeminiProvider}     — or future provider type
 */
export function createProvider(featureKey) {
    const providerName = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

    if (providerName === 'gemini') {
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey && process.env.NODE_ENV === 'production') {
            throw new Error(
                '[AI] GEMINI_API_KEY is required in production but is not set. ' +
                'Set GEMINI_API_KEY in your environment or disable AI features.'
            );
        }

        if (!apiKey) {
            // Non-production: warn but don't crash startup
            logger.warn('AI_PROVIDER=gemini but GEMINI_API_KEY is not set. AI features will be unavailable.');
            return null;
        }

        const baseModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        const embeddingModel = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';

        // Per-feature model override: AI_MODEL_REVIEW, AI_MODEL_CHAT, etc.
        const featureModel = featureKey
            ? (process.env[`AI_MODEL_${featureKey.toUpperCase()}`] || baseModel)
            : baseModel;

        return new GeminiProvider({ apiKey, model: featureModel, embeddingModel });
    }

    throw new Error(
        `[AI] Unknown AI_PROVIDER "${providerName}". Supported providers: gemini. ` +
        'To add a new provider, implement the provider interface in server/lib/ai-provider.js.'
    );
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

/**
 * Registry of all known providers.
 * `create(opts)` — factory for this provider
 * `supportsEmbeddings` — whether this provider natively supports embed()
 */
const PROVIDER_REGISTRY = {
    gemini: {
        create: (opts) => new GeminiProvider(opts),
        supportsEmbeddings: true,
    },
    anthropic: {
        create: (opts) => new _AnthropicProvider(opts),
        supportsEmbeddings: false,
    },
    openai: {
        create: (opts) => new _OpenAIProvider(opts),
        supportsEmbeddings: true,
    },
    openrouter: {
        create: (opts) => new _OpenRouterProvider(opts),
        supportsEmbeddings: false,
    },
    local: {
        create: (opts) => new _LocalProvider(opts),
        supportsEmbeddings: true,
    },
};

// ---------------------------------------------------------------------------
// createProviderForUser — per-user provider resolution
// ---------------------------------------------------------------------------

/**
 * Resolves an AI provider for a given user + feature kind.
 *
 * Lookup order:
 *  1. user_ai_config row for userId — use their stored BYOK config.
 *     When featureKey is provided, applies any per-feature model override.
 *  2. Server-wide env fallback (GEMINI_API_KEY) — demo / self-host mode.
 *     Skipped when AI_REQUIRE_USER_CONFIG=true.
 *  3. null — AI not configured for this user.
 *
 * For embedding requests on a provider that doesn't natively support embeddings
 * (anthropic, openrouter), the function falls back to the user's configured
 * embedding_provider. If that's also absent, returns null.
 *
 * @param {number} userId
 * @param {'completion'|'embedding'} [kind='completion']
 * @param {object} [opts]
 * @param {string} [opts.featureKey]  — UPPER_SNAKE key e.g. 'CHAT', 'PR_REVIEW'
 * @returns {Promise<import('./providers/openai.js').OpenAIProvider|GeminiProvider|null>}
 */
export async function createProviderForUser(userId, kind = 'completion', opts = {}) {
    await _loadProviders();

    const { featureKey } = opts;

    // Lazy import to avoid circular dependency at module load time.
    const { getDecryptedConfig } = await import('./user-ai-config.js');

    const userConfig = getDecryptedConfig(userId);

    if (userConfig) {
        // --- Completion path ---
        if (kind === 'completion') {
            const provider = userConfig.completionProvider;
            const creds = userConfig.completionCredentials;
            const baseModel = userConfig.completionModel;
            const entry = provider && PROVIDER_REGISTRY[provider];

            if (entry && creds) {
                // Apply per-feature model override if present
                const model = (featureKey && userConfig.featureOverrides?.[featureKey]) || baseModel;
                return entry.create({
                    ...creds,
                    ...(model ? { model } : {}),
                });
            }
        }

        // --- Embedding path ---
        if (kind === 'embedding') {
            const completionProvider = userConfig.completionProvider;
            const completionEntry = completionProvider && PROVIDER_REGISTRY[completionProvider];

            // If the completion provider supports embeddings, use it
            if (completionEntry?.supportsEmbeddings && userConfig.completionCredentials) {
                // Apply EMBED feature override if present
                const baseModel = userConfig.completionModel;
                const model = (featureKey && userConfig.featureOverrides?.[featureKey]) || baseModel;
                return completionEntry.create({
                    ...userConfig.completionCredentials,
                    ...(model ? { model } : {}),
                });
            }

            // Otherwise fall back to the dedicated embedding provider
            const embProvider = userConfig.embeddingProvider;
            const embCreds = userConfig.embeddingCredentials;
            const embModel = userConfig.embeddingModel;
            const embEntry = embProvider && PROVIDER_REGISTRY[embProvider];

            if (embEntry && embCreds) {
                const model = (featureKey && userConfig.featureOverrides?.[featureKey]) || embModel;
                return embEntry.create({
                    ...embCreds,
                    ...(model ? { model, embeddingModel: model } : {}),
                });
            }

            return null;
        }
    }

    // --- Server-wide env fallback ---
    // When AI_REQUIRE_USER_CONFIG=true, skip the fallback entirely so every
    // user must bring their own key (multi-tenant mode).
    if (process.env.AI_REQUIRE_USER_CONFIG === 'true') {
        if (!userConfig) {
            logger.warn({ userId }, '[AI] AI_REQUIRE_USER_CONFIG=true — no user config, server fallback disabled.');
            return null;
        }
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
        const baseModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        const embeddingModel = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
        return new GeminiProvider({ apiKey, model: baseModel, embeddingModel });
    }

    // Production: warn loudly but don't crash here (caller decides how to handle null)
    if (process.env.NODE_ENV === 'production') {
        logger.warn({ userId }, '[AI] No provider configured for user and no server fallback (GEMINI_API_KEY).');
    }

    return null;
}
