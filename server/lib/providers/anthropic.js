/**
 * AnthropicProvider — Claude (Sonnet / Opus / Haiku) via bare fetch.
 *
 * Uses the Anthropic Messages API directly — no SDK dependency.
 * API reference: https://docs.anthropic.com/en/api/messages
 *
 * Implements the AIProvider contract:
 *  generate({ prompt, parts?, schema?, generationConfig?, systemPrompt?, modelOverride? })
 *    → Promise<{ text: string, parsed?: any }>
 *  embed(text)
 *    → Promise<number[]>  — THROWS: Anthropic has no embedding API
 *  generateStream({ prompt, generationConfig?, signal? })
 *    → AsyncGenerator<string>
 */

import { AIError, AI_ERROR_CODE, toAIError } from '../ai-provider.js';

const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip markdown code fences from AI text output.
 * @param {string} text
 * @returns {string}
 */
function stripMarkdownFences(text) {
    return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

/**
 * Map Anthropic HTTP error status / error type to AIError.
 *
 * Anthropic error codes: https://docs.anthropic.com/en/api/errors
 *  - 401           → AUTH
 *  - 429           → QUOTA (rate limit)
 *  - 529           → OVERLOAD (API temporarily overloaded)
 *  - overloaded_error type → OVERLOAD
 *
 * @param {number} status
 * @param {string} message
 * @param {string} [errorType]  — Anthropic error.type field
 * @param {unknown} [cause]
 * @returns {AIError}
 */
function mapAnthropicError(status, message, errorType, cause) {
    if (status === 401 || errorType === 'authentication_error') {
        return new AIError({ code: AI_ERROR_CODE.AUTH, message, status: 401, cause });
    }
    if (status === 429 || errorType === 'rate_limit_error') {
        return new AIError({ code: AI_ERROR_CODE.QUOTA, message, status: 429, cause });
    }
    if (status === 529 || errorType === 'overloaded_error') {
        return new AIError({ code: AI_ERROR_CODE.OVERLOAD, message, status: 529, cause });
    }
    if (status === 404 || errorType === 'not_found_error') {
        return new AIError({ code: AI_ERROR_CODE.NOT_FOUND, message, status: 404, cause });
    }
    if (status === 400 || errorType === 'invalid_request_error') {
        return new AIError({ code: AI_ERROR_CODE.INVALID_RESPONSE, message, status: 400, cause });
    }
    return new AIError({ code: AI_ERROR_CODE.UNKNOWN, message, status, cause });
}

// ---------------------------------------------------------------------------
// AnthropicProvider
// ---------------------------------------------------------------------------

export class AnthropicProvider {
    /**
     * @param {object} opts
     * @param {string} opts.apiKey
     * @param {string} [opts.model] — default: 'claude-sonnet-4-6'
     */
    constructor({ apiKey, model = 'claude-sonnet-4-6' } = {}) {
        this._apiKey = apiKey;
        this._modelName = model;
    }

    // -------------------------------------------------------------------------
    // Public accessor
    // -------------------------------------------------------------------------

    /**
     * Return the configured model name without exposing the private field directly.
     * @returns {string}
     */
    getModelName() {
        return this._modelName;
    }

    // -------------------------------------------------------------------------
    // Internal HTTP helpers
    // -------------------------------------------------------------------------

    /**
     * Build request headers for the Anthropic Messages API.
     * @returns {Record<string, string>}
     */
    _headers() {
        return {
            'Content-Type': 'application/json',
            'x-api-key': this._apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
        };
    }

    /**
     * POST JSON to the Anthropic API, handle error mapping, return parsed JSON.
     *
     * @param {string} path   — e.g. '/v1/messages'
     * @param {object} body
     * @returns {Promise<object>}
     */
    async _post(path, body) {
        let res;
        try {
            res = await fetch(`${ANTHROPIC_API_BASE}${path}`, {
                method: 'POST',
                headers: this._headers(),
                body: JSON.stringify(body),
            });
        } catch (networkErr) {
            throw toAIError(networkErr);
        }

        if (!res.ok) {
            let errMessage = `HTTP ${res.status}`;
            let errType;
            try {
                const errBody = await res.json();
                errMessage = errBody?.error?.message || errMessage;
                errType = errBody?.error?.type;
            } catch {
                // non-JSON body; keep status message
            }
            throw mapAnthropicError(res.status, errMessage, errType, undefined);
        }

        return res.json();
    }

    /**
     * POST with stream:true and return the Response (for SSE parsing).
     *
     * @param {string} path
     * @param {object} body
     * @param {AbortSignal} [signal]
     * @returns {Promise<Response>}
     */
    async _postStream(path, body, signal) {
        let res;
        try {
            res = await fetch(`${ANTHROPIC_API_BASE}${path}`, {
                method: 'POST',
                headers: this._headers(),
                body: JSON.stringify({ ...body, stream: true }),
                signal,
            });
        } catch (networkErr) {
            if (networkErr?.name === 'AbortError') {
                throw new AIError({ code: AI_ERROR_CODE.CANCELED, message: 'Request aborted', cause: networkErr });
            }
            throw toAIError(networkErr);
        }

        if (!res.ok) {
            let errMessage = `HTTP ${res.status}`;
            let errType;
            try {
                const errBody = await res.json();
                errMessage = errBody?.error?.message || errMessage;
                errType = errBody?.error?.type;
            } catch {
                // non-JSON body
            }
            throw mapAnthropicError(res.status, errMessage, errType, undefined);
        }

        return res;
    }

    // -------------------------------------------------------------------------
    // generate
    // -------------------------------------------------------------------------

    /**
     * Generate text (or structured JSON) from the model.
     *
     * Anthropic messages shape:
     *  POST /v1/messages
     *  { model, max_tokens, messages: [{role, content}], system? }
     *
     * For schema-required output: we add a JSON instruction to the system prompt
     * and parse the response. Anthropic does not have a structured output mode.
     *
     * @param {object} opts
     * @param {string} [opts.prompt]           — simple text prompt
     * @param {Array}  [opts.parts]            — falls back to joining text parts
     * @param {object} [opts.schema]           — JSON schema; if set, parses response as JSON
     * @param {object} [opts.generationConfig] — max_tokens, temperature
     * @param {string} [opts.systemPrompt]     — system message
     * @param {string} [opts.modelOverride]    — override model for this call
     * @returns {Promise<{ text: string, parsed?: any }>}
     */
    async generate({ prompt, parts, schema, generationConfig, systemPrompt, modelOverride } = {}) {
        const model = modelOverride || this._modelName;

        // Build the system prompt
        let effectiveSystem = systemPrompt || '';
        if (schema) {
            const jsonInstruction =
                'Respond with valid JSON only matching the requested schema. ' +
                'Do not include any explanation or markdown code fences.';
            effectiveSystem = effectiveSystem
                ? `${effectiveSystem}\n\n${jsonInstruction}`
                : jsonInstruction;
        }

        // Build user message content — preserve parts as distinct blocks (anti-injection)
        let userMessageContent;
        if (Array.isArray(parts) && parts.length) {
            userMessageContent = parts.map((p) => ({ type: 'text', text: String(p.text ?? '') }));
        } else {
            userMessageContent = prompt || '';
        }

        // Build request body
        const body = {
            model,
            max_tokens: DEFAULT_MAX_TOKENS,
            messages: [{ role: 'user', content: userMessageContent }],
        };

        if (effectiveSystem) {
            body.system = effectiveSystem;
        }

        // Map generationConfig
        if (generationConfig) {
            if (generationConfig.maxOutputTokens != null) body.max_tokens = generationConfig.maxOutputTokens;
            if (generationConfig.max_tokens != null) body.max_tokens = generationConfig.max_tokens;
            if (generationConfig.temperature != null) body.temperature = generationConfig.temperature;
        }

        try {
            const data = await this._post('/v1/messages', body);
            const raw = data?.content?.[0]?.text || '';
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
     * Anthropic does not support embeddings.
     * Throws AIError(NOT_FOUND) with a user-friendly message.
     *
     * @returns {never}
     */
    async embed(_text) {
        throw new AIError({
            code: AI_ERROR_CODE.NOT_FOUND,
            message:
                'Anthropic does not support embeddings. Configure a separate embedding provider in Settings.',
            status: 404,
        });
    }

    // -------------------------------------------------------------------------
    // generateStream
    // -------------------------------------------------------------------------

    /**
     * Generate a text stream. Yields string chunks as they arrive.
     * Parses the Anthropic SSE stream format.
     *
     * Relevant SSE event types from Anthropic:
     *  content_block_delta → delta.type === 'text_delta' → delta.text
     *
     * @param {object} opts
     * @param {string} [opts.prompt]
     * @param {object} [opts.generationConfig]
     * @param {AbortSignal} [opts.signal]
     * @param {string} [opts.modelOverride]
     * @returns {AsyncGenerator<string>}
     */
    async *generateStream({ prompt, generationConfig, signal, modelOverride } = {}) {
        const model = modelOverride || this._modelName;

        const body = {
            model,
            max_tokens: DEFAULT_MAX_TOKENS,
            messages: [{ role: 'user', content: prompt || '' }],
        };

        if (generationConfig) {
            if (generationConfig.maxOutputTokens != null) body.max_tokens = generationConfig.maxOutputTokens;
            if (generationConfig.max_tokens != null) body.max_tokens = generationConfig.max_tokens;
            if (generationConfig.temperature != null) body.temperature = generationConfig.temperature;
        }

        const res = await this._postStream('/v1/messages', body, signal);

        // Parse Anthropic SSE stream
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                if (signal?.aborted) break;

                let done, value;
                try {
                    ({ done, value } = await reader.read());
                } catch (readErr) {
                    if (readErr?.name === 'AbortError' || signal?.aborted) {
                        throw new AIError({ code: AI_ERROR_CODE.CANCELED, message: 'Generation was cancelled', cause: readErr });
                    }
                    throw readErr;
                }

                if (done) break;
                if (signal?.aborted) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;

                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        // Anthropic: type === 'content_block_delta', delta.type === 'text_delta'
                        if (json?.type === 'content_block_delta' && json?.delta?.type === 'text_delta') {
                            const text = json.delta.text;
                            if (text) yield text;
                        }
                    } catch {
                        // skip malformed SSE lines
                    }
                }
            }
        } catch (err) {
            if (err instanceof AIError) throw err;
            if (err?.name === 'AbortError' || signal?.aborted) {
                throw new AIError({ code: AI_ERROR_CODE.CANCELED, message: 'Generation was cancelled', cause: err });
            }
            throw err;
        } finally {
            reader.releaseLock();
        }
    }
}
