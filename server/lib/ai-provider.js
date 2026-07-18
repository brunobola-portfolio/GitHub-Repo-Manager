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
import { computeCostUSD } from './provider-pricing.js';
import { assertSafeAIEndpoint, resolveAndValidateHost } from './url-validator.js';

// ---------------------------------------------------------------------------
// Gemini model defaults — single source of truth
// ---------------------------------------------------------------------------
// The model IDs were duplicated across 4 sites (constructor signature, the
// default-provider factory, the per-user provider, and semantic-search's
// error-message remap). Bumping a default-model version meant editing all
// four. Centralised here; consumers must call getGeminiModelDefaults() for
// the resolved values (env override + fallback).

export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
export const GEMINI_DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';

/**
 * Resolves the Gemini model IDs from env with the canonical defaults.
 * @returns {{ baseModel: string, embeddingModel: string }}
 */
export function getGeminiModelDefaults() {
    return {
        baseModel: process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL,
        embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || GEMINI_DEFAULT_EMBEDDING_MODEL,
    };
}

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

/**
 * Public: ensure the lazily-imported (non-Gemini) providers are loaded. Await
 * this before calling `resolveServerProviderFromEnv()` for a non-Gemini
 * provider, since the registry's `create()` references those modules.
 */
export async function loadProviders() {
    await _loadProviders();
}

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

export const AI_ERROR_CODE = Object.freeze({
    QUOTA: 'QUOTA',                    // 403 "over quota" / billing — NOT retryable
    AUTH: 'AUTH',                      // 401 bad/expired key — NOT retryable
    OVERLOAD: 'OVERLOAD',              // 500/502/503/504/529 — retryable
    TIMEOUT: 'TIMEOUT',                // 408 / AbortError — retryable
    RATE_LIMITED: 'RATE_LIMITED',      // 429 with Retry-After — retryable (honour header)
    NETWORK: 'NETWORK',                // fetch threw / ECONNRESET / ETIMEDOUT / ENOTFOUND — retryable
    NOT_FOUND: 'NOT_FOUND',            // 404 model/resource — NOT retryable
    INVALID_RESPONSE: 'INVALID_RESPONSE', // unparseable JSON etc — NOT retryable
    CANCELED: 'CANCELED',              // client abort — NOT retryable
    UNKNOWN: 'UNKNOWN',                // everything else — NOT retryable
});

export class AIError extends Error {
    /**
     * @param {object} opts
     * @param {string} opts.code           — one of AI_ERROR_CODE
     * @param {string} [opts.message]      — human-readable message
     * @param {number} [opts.status]       — HTTP status hint (for middleware mapping)
     * @param {number} [opts.retryAfterMs] — backoff hint from Retry-After (capped by caller)
     * @param {unknown} [opts.cause]       — original error (preserved for logging)
     * @param {object} [opts.details]      — structured upstream context (provider name, raw body, etc.)
     *                                       Used by the /test endpoint to render rich, actionable errors.
     */
    constructor({ code, message, status, retryAfterMs, cause, details } = {}) {
        super(message || code, cause ? { cause } : undefined);
        this.name = 'AIError';
        this.code = code || AI_ERROR_CODE.UNKNOWN;
        this.status = status;
        if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
        if (details !== undefined) this.details = details;
    }
}

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------

/**
 * Network-layer errno codes that indicate transient connectivity problems
 * (as opposed to hostname typos, which also surface as ENOTFOUND but are
 * still arguably worth one retry in case of DNS flapping).
 */
const NETWORK_ERROR_CODES = new Set([
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'EPIPE',
]);

/**
 * Parse a Retry-After header (seconds delta OR HTTP-date) into milliseconds.
 * Returns null when the input is absent or unparseable.
 *
 * @param {string|number|undefined|null} headerValue
 * @returns {number|null}
 */
function parseRetryAfterToMs(headerValue) {
    if (headerValue === undefined || headerValue === null || headerValue === '') return null;
    const asNumber = Number(headerValue);
    if (Number.isFinite(asNumber) && asNumber >= 0) {
        return Math.floor(asNumber * 1000);
    }
    const asDate = Date.parse(String(headerValue));
    if (!Number.isNaN(asDate)) {
        const ms = asDate - Date.now();
        return ms > 0 ? ms : 0;
    }
    return null;
}

/**
 * Extract a Retry-After hint (ms) from any of the shapes vendor SDKs may use:
 *   - err.retryAfterMs       — already normalised
 *   - err.retryAfter         — seconds (numeric) or HTTP-date
 *   - err.headers['retry-after']
 *   - err.response.headers.get('retry-after')
 */
export function extractRetryAfterMs(err) {
    if (!err || typeof err !== 'object') return null;

    if (typeof err.retryAfterMs === 'number' && Number.isFinite(err.retryAfterMs)) {
        return Math.max(0, Math.floor(err.retryAfterMs));
    }
    const direct = parseRetryAfterToMs(err.retryAfter);
    if (direct !== null) return direct;

    const h = err.headers;
    if (h) {
        const val = typeof h.get === 'function'
            ? (h.get('retry-after') || h.get('Retry-After'))
            : (h['retry-after'] || h['Retry-After']);
        const parsed = parseRetryAfterToMs(val);
        if (parsed !== null) return parsed;
    }

    const rh = err.response?.headers;
    if (rh) {
        const val = typeof rh.get === 'function'
            ? (rh.get('retry-after') || rh.get('Retry-After'))
            : (rh['retry-after'] || rh['Retry-After']);
        const parsed = parseRetryAfterToMs(val);
        if (parsed !== null) return parsed;
    }

    return null;
}

/**
 * Detect a network / transport-level error that did not reach the server
 * (or whose response could not be read). These are safe to retry.
 */
function isNetworkErrorShape(err) {
    if (!err || typeof err !== 'object') return false;
    // fetch() throws TypeError on DNS / connect / stream failures
    if (err.name === 'TypeError') return true;
    if (err.name === 'FetchError') return true;
    if (err.name === 'AbortError') return true;
    if (err.code && NETWORK_ERROR_CODES.has(err.code)) return true;
    // Node's fetch surfaces the real error via err.cause
    if (err.cause?.code && NETWORK_ERROR_CODES.has(err.cause.code)) return true;
    if (err.cause?.name === 'AbortError') return true;
    return false;
}

/**
 * Throw a CANCELED AIError when an error / signal indicates a client abort;
 * no-op otherwise (the caller re-throws the original). Dedups the identical
 * abort-detection that was copy-pasted across the streaming providers.
 *
 * @param {unknown} err
 * @param {{ aborted?: boolean }} [signal]
 * @param {string} [message]
 */
export function throwIfCanceled(err, signal, message = 'Generation was cancelled') {
    if (err?.name === 'AbortError' || signal?.aborted) {
        throw new AIError({ code: AI_ERROR_CODE.CANCELED, message, cause: err });
    }
}

/**
 * Convert an arbitrary vendor SDK error into an AIError.
 * Preserves the original error in `.cause` for logging.
 *
 * Mapping rules (first match wins):
 *   - AIError passthrough
 *   - Network / AbortError / ECONN*, ENOTFOUND          -> NETWORK
 *   - 408 or timeout / TimeoutError                     -> TIMEOUT
 *   - 429 or rate-limit (carries Retry-After)           -> RATE_LIMITED
 *   - 403 with quota/billing, or legacy "quota" message -> QUOTA
 *   - 401 or API key / unauthorised                     -> AUTH
 *   - 404 or "not found"                                -> NOT_FOUND
 *   - 500/502/503/504/529 or overload/unavailable       -> OVERLOAD
 *   - else                                              -> UNKNOWN
 *
 * @param {unknown} err
 * @returns {AIError}
 */
export function toAIError(err) {
    if (err instanceof AIError) return err;

    const msg = err?.message || '';
    const status = err?.status;

    // -- Network / transport-level failures come first: status may be absent. --
    if (isNetworkErrorShape(err)) {
        // Don't misclassify AbortError fired by our own timeout wrapper — callers
        // that want a distinct CANCELED can inspect .cause.
        return new AIError({ code: AI_ERROR_CODE.NETWORK, message: msg || 'network error', cause: err });
    }

    // -- Request timeout --
    if (status === 408 || err?.name === 'TimeoutError' || /request timeout|timed out/i.test(msg)) {
        return new AIError({ code: AI_ERROR_CODE.TIMEOUT, message: msg || 'request timeout', status: 408, cause: err });
    }

    // -- Rate limit (429) — distinct from QUOTA. Carries Retry-After when available. --
    if (status === 429) {
        const retryAfterMs = extractRetryAfterMs(err);
        return new AIError({
            code: AI_ERROR_CODE.RATE_LIMITED,
            message: msg || 'rate limited',
            status: 429,
            ...(retryAfterMs !== null ? { retryAfterMs } : {}),
            cause: err,
        });
    }
    if (/rate[\s-]?limit/i.test(msg)) {
        return new AIError({
            code: AI_ERROR_CODE.RATE_LIMITED,
            message: msg,
            status: status || 429,
            cause: err,
        });
    }

    // -- Quota (billing) — 403 with quota/billing wording, OR the legacy
    //    "quota" string match. Retained as non-retryable. --
    if ((status === 403 && /quota|billing/i.test(msg)) || /over quota|quota exceeded|billing/i.test(msg)) {
        return new AIError({ code: AI_ERROR_CODE.QUOTA, message: msg, status: status || 403, cause: err });
    }
    // Back-compat: bare /quota/i without status was previously QUOTA. Keep it so.
    if (/quota/i.test(msg) && status !== 429) {
        return new AIError({ code: AI_ERROR_CODE.QUOTA, message: msg, status: status || 403, cause: err });
    }

    // -- Auth --
    if (status === 401 || /API key|unauthori[sz]ed/i.test(msg)) {
        return new AIError({ code: AI_ERROR_CODE.AUTH, message: msg, status: 401, cause: err });
    }

    // -- Not found --
    if (status === 404 || /not found/i.test(msg)) {
        return new AIError({ code: AI_ERROR_CODE.NOT_FOUND, message: msg, status: 404, cause: err });
    }

    // -- Overload (includes Anthropic 529 "Overloaded") --
    if (status === 500 || status === 502 || status === 503 || status === 504 || status === 529
        || /overload|unavailable|high demand/i.test(msg)) {
        return new AIError({
            code: AI_ERROR_CODE.OVERLOAD,
            message: msg,
            status: status || 503,
            cause: err,
        });
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
// Gemini generationConfig normalizer
// ---------------------------------------------------------------------------

// Allow-list of fields Gemini's v1beta generateContent API accepts inside
// `generationConfig`. Anything outside this list causes a 400 "Unknown name"
// (e.g. OpenAI's `max_tokens`). Keep this conservative — adding newer fields
// is safer than letting arbitrary caller-supplied keys hit the REST API.
const GEMINI_GEN_CONFIG_FIELDS = new Set([
    'temperature',
    'topP',
    'topK',
    'candidateCount',
    'maxOutputTokens',
    'stopSequences',
    'presencePenalty',
    'frequencyPenalty',
    'responseMimeType',
    'responseSchema',
    'responseLogprobs',
    'logprobs',
    'seed',
    'thinkingConfig',
]);

/**
 * Normalise a provider-neutral `generationConfig` into a Gemini-valid one.
 *
 * - Aliases `max_tokens` → `maxOutputTokens` (OpenAI/Anthropic-style callers).
 * - Drops unknown keys so a 400 "Unknown name" can't slip through.
 * - Returns `null` when the resulting object is empty, so callers can
 *   omit `generationConfig` from the request body entirely.
 *
 * @param {object|null|undefined} cfg
 * @returns {object|null}
 */
function normalizeGeminiGenerationConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return null;
    const out = {};
    for (const [key, value] of Object.entries(cfg)) {
        if (value === undefined || value === null) continue;
        if (key === 'max_tokens' || key === 'maxTokens') {
            if (out.maxOutputTokens == null) out.maxOutputTokens = value;
            continue;
        }
        if (GEMINI_GEN_CONFIG_FIELDS.has(key)) {
            out[key] = value;
        }
    }
    return Object.keys(out).length > 0 ? out : null;
}

/**
 * Map a Gemini `usageMetadata` object to our provider-neutral usage + cost
 * shape. Returns `{ usage: null, costUSD: null }` when token counts are
 * absent (e.g. a stream that reported no usage). Shared by `generate()` and
 * `generateStream()` so both surface spend identically.
 */
function geminiUsageFromMeta(meta, modelName) {
    const usage = meta && (meta.promptTokenCount != null || meta.candidatesTokenCount != null)
        ? {
            inputTokens: meta.promptTokenCount ?? null,
            outputTokens: meta.candidatesTokenCount ?? null,
            ...(meta.cachedContentTokenCount != null
                ? { cachedInputTokens: meta.cachedContentTokenCount }
                : {}),
        }
        : null;
    const costUSD = usage
        ? computeCostUSD({ modelName, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
        : null;
    return { usage, costUSD };
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
    constructor({ apiKey, model = GEMINI_DEFAULT_MODEL, embeddingModel = GEMINI_DEFAULT_EMBEDDING_MODEL }) {
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
     * @returns {Promise<{ text: string, parsed?: any, usage: ({inputTokens: number|null, outputTokens: number|null, cachedInputTokens?: number}|null), costUSD: number|null }>}
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

        const normalizedConfig = normalizeGeminiGenerationConfig(generationConfig);

        let request;

        if (parts) {
            // Multi-part / structured contents path (preserves anti-injection partitioning)
            request = {
                contents: [{ role: 'user', parts }],
                ...(normalizedConfig ? { generationConfig: normalizedConfig } : {}),
            };
        } else if (schema) {
            // Structured response with schema
            const fullPrompt = systemPrompt ? systemPrompt + '\n\n' + (prompt || '') : (prompt || '');
            request = {
                contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: schema,
                    ...(normalizedConfig || {}),
                },
            };
        } else {
            // Simple prompt path
            const fullPrompt = systemPrompt ? systemPrompt + '\n\n' + (prompt || '') : (prompt || '');
            request = normalizedConfig
                ? { contents: [{ role: 'user', parts: [{ text: fullPrompt }] }], generationConfig: normalizedConfig }
                : fullPrompt;
        }

        try {
            const result = await sdkModel.generateContent(request);
            const raw = result.response.text();
            const text = stripMarkdownFences(raw);

            // Surface usage + cost so callers can persist accurate spend.
            // Gemini's usageMetadata is available since @google/generative-ai 0.12+.
            // Defensive: missing/partial metadata returns null without crashing.
            const { usage, costUSD } = geminiUsageFromMeta(result?.response?.usageMetadata, modelName);

            if (schema) {
                try {
                    const parsed = JSON.parse(text);
                    return { text, parsed, usage, costUSD };
                } catch (parseErr) {
                    throw new AIError({
                        code: AI_ERROR_CODE.INVALID_RESPONSE,
                        message: `AI returned text that could not be parsed as JSON: ${text.slice(0, 200)}`,
                        cause: parseErr,
                    });
                }
            }

            return { text, usage, costUSD };
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

        const normalizedConfig = normalizeGeminiGenerationConfig(generationConfig);
        const request = {
            contents,
            ...(normalizedConfig ? { generationConfig: normalizedConfig } : {}),
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

        // Usage only becomes available once the stream drains: the SDK exposes
        // it via `streamResult.response`. Surface it as the generator's return
        // value so callers can record spend + audit (OWASP LLM10). Never throw
        // from here — a usage-extraction failure must not fail the response the
        // client already received.
        if (signal?.aborted) return { usage: null, costUSD: null };
        try {
            const response = await streamResult?.response;
            return geminiUsageFromMeta(response?.usageMetadata, modelName);
        } catch {
            return { usage: null, costUSD: null };
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

        const { baseModel, embeddingModel } = getGeminiModelDefaults();

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

/**
 * Resolve the server-wide fallback provider from env (AI_PROVIDER +
 * <PROVIDER>_API_KEY / <PROVIDER>_MODEL), honoring all registered providers —
 * not just Gemini. Assumes `_loadProviders()` has already run (callers in the
 * async path await it first).
 *
 * Returns null when the configured provider has no key, so a missing key
 * degrades to "AI unavailable" gracefully rather than crashing a request — the
 * same non-throwing contract the previous Gemini-only fallback had.
 *
 * @param {string} [featureKey] — UPPER_SNAKE key (e.g. 'CHAT') for AI_MODEL_<FEATURE> override
 * @returns {object|null} a provider instance, or null when unconfigured
 */
export function resolveServerProviderFromEnv(featureKey) {
    const providerName = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
    const entry = PROVIDER_REGISTRY[providerName];
    if (!entry) {
        logger.warn(
            { providerName },
            `[AI] Unknown AI_PROVIDER. Supported providers: ${Object.keys(PROVIDER_REGISTRY).join(', ')}.`,
        );
        return null;
    }
    const ENV = providerName.toUpperCase();
    const apiKey = process.env[`${ENV}_API_KEY`];
    if (!apiKey) return null;

    const featureModel = featureKey ? process.env[`AI_MODEL_${featureKey.toUpperCase()}`] : undefined;
    if (providerName === 'gemini') {
        const { baseModel, embeddingModel } = getGeminiModelDefaults();
        return entry.create({ apiKey, model: featureModel || baseModel, embeddingModel });
    }
    const model = featureModel || process.env[`${ENV}_MODEL`];
    return entry.create({ apiKey, ...(model ? { model } : {}) });
}

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
 * @param {boolean} [opts.noServerFallback=false] — when true, skip the
 *   GEMINI_API_KEY env fallback and return null if the user has no valid
 *   BYOK config. Used by /api/user/ai-config/test so the user tests THEIR
 *   credentials, not the server's shared key.
 * @returns {Promise<import('./providers/openai.js').OpenAIProvider|GeminiProvider|null>}
 */
/**
 * DNS-rebinding recheck: resolve a stored BYOK endpoint's hostname and throw if
 * it points at a private/internal address. Skipped for endpoints the operator
 * explicitly allowed to be local (ALLOW_LOCAL_AI_ENDPOINTS + `local` provider),
 * which are loopback/private by design.
 */
async function assertEndpointHostIsPublic(endpointUrl, provider) {
    const allowLocal = provider === 'local' && process.env.ALLOW_LOCAL_AI_ENDPOINTS === 'true';
    if (allowLocal) return;
    const safe = await resolveAndValidateHost(endpointUrl);
    if (!safe) {
        throw new Error('ssrf_guard: AI endpoint host resolves to a private or unreachable address');
    }
}

export async function createProviderForUser(userId, kind = 'completion', opts = {}) {
    await _loadProviders();

    const { featureKey, noServerFallback = false } = opts;

    // Lazy import to avoid circular dependency at module load time.
    const { getDecryptedConfig } = await import('./user-ai-config.js');

    const userConfig = getDecryptedConfig(userId);

    if (userConfig) {
        // Defense-in-depth SSRF guard: re-validate any stored BYOK endpoint
        // before we ever fetch it (covers configs persisted before the
        // save-time guard in routes/user-ai-config.js existed). Throws on an
        // unsafe endpoint — callers (e.g. the /test handler) surface it as a
        // provider error rather than letting the request reach an internal host.
        //
        // The sync guard validates the URL shape + literal-IP ranges; the async
        // recheck resolves the hostname and rejects if it points at a private
        // address — closing the DNS-rebinding window between save and use. We
        // skip the DNS recheck for endpoints the operator explicitly allowed via
        // ALLOW_LOCAL_AI_ENDPOINTS (those are loopback/private on purpose).
        const compEndpoint = userConfig.completionCredentials?.endpointUrl;
        if (compEndpoint) {
            assertSafeAIEndpoint(compEndpoint, { provider: userConfig.completionProvider });
            await assertEndpointHostIsPublic(compEndpoint, userConfig.completionProvider);
        }
        const embEndpoint = userConfig.embeddingCredentials?.endpointUrl;
        if (embEndpoint) {
            assertSafeAIEndpoint(embEndpoint, { provider: userConfig.embeddingProvider });
            await assertEndpointHostIsPublic(embEndpoint, userConfig.embeddingProvider);
        }

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
    // Caller opted out of server fallback (e.g. /test endpoint — the user
    // must test their OWN credentials, not the server's shared key).
    if (noServerFallback) {
        return null;
    }

    // When AI_REQUIRE_USER_CONFIG=true, skip the fallback entirely so every
    // user must bring their own key (multi-tenant mode).
    if (process.env.AI_REQUIRE_USER_CONFIG === 'true') {
        if (!userConfig) {
            logger.warn({ userId }, '[AI] AI_REQUIRE_USER_CONFIG=true — no user config, server fallback disabled.');
            return null;
        }
    }

    // Server-wide fallback now honors AI_PROVIDER (Gemini/Anthropic/OpenAI/
    // OpenRouter/local), not just Gemini. Providers were loaded at the top of
    // this function, so the registry create() is safe to call synchronously.
    const provider = resolveServerProviderFromEnv(featureKey);

    // Production: warn loudly but don't crash here (caller decides how to handle null)
    if (!provider && process.env.NODE_ENV === 'production') {
        logger.warn({ userId }, '[AI] No provider configured for user and no server fallback (set <PROVIDER>_API_KEY).');
    }

    return provider;
}

// ---------------------------------------------------------------------------
// resolveImageProviderConfig — raw credential resolution for image generation
// ---------------------------------------------------------------------------

/**
 * Resolve the same "which provider + credentials is this user's active
 * configuration" question `createProviderForUser` answers, but return the
 * RAW `{ provider, model, apiKey, baseURL }` shape instead of an instantiated
 * SDK provider instance.
 *
 * Why not reuse `createProviderForUser`? Its return value is an opaque
 * provider object built for the `generate()` SDK contract — for Gemini in
 * particular, `.model` is a wrapped `GenerativeModel` instance, not a model
 * id string, and there is no public accessor for the raw API key at all.
 * `server/lib/ai-features/image-provider.js`'s raw-fetch image calls
 * (Gemini REST, OpenAI Images, OpenRouter Image API — none of which reuse
 * `generate()`) need the literal credentials, not a wrapped client — see that
 * module's header comment for why image generation is a separate call shape.
 *
 * Mirrors `createProviderForUser`'s exact resolution order (user BYOK config
 * -> server env fallback -> null) and the same SSRF hardening (the sync
 * `assertSafeAIEndpoint` check plus the async DNS-rebinding recheck) for any
 * stored completion `endpointUrl`, so a BYOK proxy endpoint gets identical
 * protection whether it's used for text or image generation.
 *
 * @param {number} userId
 * @returns {Promise<{ provider: string|null, model: string|null, apiKey: string|null, baseURL?: string }>}
 */
export async function resolveImageProviderConfig(userId) {
    // Lazy import to avoid circular dependency at module load time (same
    // reason createProviderForUser does this).
    const { getDecryptedConfig } = await import('./user-ai-config.js');

    const userConfig = getDecryptedConfig(userId);

    if (userConfig?.completionProvider && userConfig?.completionCredentials?.apiKey) {
        const endpointUrl = userConfig.completionCredentials.endpointUrl;
        if (endpointUrl) {
            assertSafeAIEndpoint(endpointUrl, { provider: userConfig.completionProvider });
            await assertEndpointHostIsPublic(endpointUrl, userConfig.completionProvider);
        }
        return {
            provider: userConfig.completionProvider,
            model: userConfig.completionModel || null,
            apiKey: userConfig.completionCredentials.apiKey,
            ...(endpointUrl ? { baseURL: endpointUrl } : {}),
        };
    }

    // AI_REQUIRE_USER_CONFIG=true means every user must bring their own key —
    // no server-wide fallback, mirroring createProviderForUser.
    if (process.env.AI_REQUIRE_USER_CONFIG === 'true') {
        return { provider: null, model: null, apiKey: null };
    }

    const providerName = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
    const ENV = providerName.toUpperCase();
    const apiKey = process.env[`${ENV}_API_KEY`];
    if (!apiKey) {
        return { provider: null, model: null, apiKey: null };
    }

    return {
        provider: providerName,
        model: process.env[`${ENV}_MODEL`] || null,
        apiKey,
    };
}
