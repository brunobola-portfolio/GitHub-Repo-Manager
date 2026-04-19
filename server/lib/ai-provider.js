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
