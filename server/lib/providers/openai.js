/**
 * OpenAIProvider — OpenAI GPT + embeddings via bare fetch.
 *
 * Also serves as the base class for OpenRouterProvider and LocalProvider
 * since all three share the same OpenAI-compatible API surface.
 *
 * Implements the AIProvider contract:
 *  generate({ prompt, parts?, schema?, generationConfig?, systemPrompt?, modelOverride? })
 *    → Promise<{ text: string, parsed?: any }>
 *  embed(text)
 *    → Promise<number[]>
 *  generateStream({ prompt, generationConfig?, signal? })
 *    → AsyncGenerator<string>
 */

import { AIError, AI_ERROR_CODE, toAIError } from '../ai-provider.js';

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

/**
 * Map an HTTP status from the OpenAI / OpenAI-compatible API to an AIError.
 *
 * @param {number} status
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {AIError}
 */
function mapHttpError(status, message, cause) {
    if (status === 401 || status === 403) {
        return new AIError({ code: AI_ERROR_CODE.AUTH, message, status, cause });
    }
    if (status === 429) {
        return new AIError({ code: AI_ERROR_CODE.QUOTA, message, status, cause });
    }
    if (status === 404) {
        return new AIError({ code: AI_ERROR_CODE.NOT_FOUND, message, status, cause });
    }
    if (status === 503 || status === 529) {
        return new AIError({ code: AI_ERROR_CODE.OVERLOAD, message, status, cause });
    }
    if (status === 500) {
        return new AIError({ code: AI_ERROR_CODE.UNKNOWN, message, status, cause });
    }
    return new AIError({ code: AI_ERROR_CODE.UNKNOWN, message, status, cause });
}

// ---------------------------------------------------------------------------
// OpenAIProvider
// ---------------------------------------------------------------------------

export class OpenAIProvider {
    /**
     * @param {object} opts
     * @param {string} opts.apiKey
     * @param {string} [opts.model]           — default: 'gpt-4o-mini'
     * @param {string} [opts.embeddingModel]  — default: 'text-embedding-3-small'
     * @param {string} [opts.baseURL]         — default: 'https://api.openai.com/v1'
     */
    constructor({
        apiKey,
        model = 'gpt-4o-mini',
        embeddingModel = 'text-embedding-3-small',
        baseURL = 'https://api.openai.com/v1',
    } = {}) {
        this._apiKey = apiKey;
        this._modelName = model;
        this._embeddingModelName = embeddingModel;
        this._baseURL = baseURL.replace(/\/$/, ''); // normalise trailing slash
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
     * Build the Authorization header value. Subclasses may override if needed.
     * @returns {string}
     */
    _authHeader() {
        return `Bearer ${this._apiKey}`;
    }

    /**
     * Build base request headers.
     * @returns {Record<string, string>}
     */
    _headers() {
        return {
            'Content-Type': 'application/json',
            Authorization: this._authHeader(),
        };
    }

    /**
     * POST JSON to the provider, handle error mapping, return parsed JSON.
     *
     * @param {string} path   — e.g. '/chat/completions'
     * @param {object} body
     * @returns {Promise<object>}
     */
    async _post(path, body) {
        let res;
        try {
            res = await fetch(`${this._baseURL}${path}`, {
                method: 'POST',
                headers: this._headers(),
                body: JSON.stringify(body),
            });
        } catch (networkErr) {
            throw toAIError(networkErr);
        }

        if (!res.ok) {
            let errMessage = `HTTP ${res.status}`;
            try {
                const errBody = await res.json();
                errMessage = errBody?.error?.message || errBody?.message || errMessage;
            } catch {
                // non-JSON body; keep status message
            }
            throw mapHttpError(res.status, errMessage, undefined);
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
            res = await fetch(`${this._baseURL}${path}`, {
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
            try {
                const errBody = await res.json();
                errMessage = errBody?.error?.message || errBody?.message || errMessage;
            } catch {
                // non-JSON body
            }
            throw mapHttpError(res.status, errMessage, undefined);
        }

        return res;
    }

    // -------------------------------------------------------------------------
    // generate
    // -------------------------------------------------------------------------

    /**
     * Generate text (or structured JSON) from the model.
     *
     * @param {object} opts
     * @param {string} [opts.prompt]           — simple text prompt
     * @param {Array}  [opts.parts]            — IGNORED (Gemini-specific multi-part; falls back to joining text parts)
     * @param {object} [opts.schema]           — JSON schema; if set, response_format requests JSON
     * @param {object} [opts.generationConfig] — mapped to OpenAI params (max_tokens, temperature)
     * @param {string} [opts.systemPrompt]     — sent as a system message
     * @param {string} [opts.modelOverride]    — use a different model for this call only
     * @returns {Promise<{ text: string, parsed?: any }>}
     */
    async generate({ prompt, parts, schema, generationConfig, systemPrompt, modelOverride } = {}) {
        const model = modelOverride || this._modelName;

        // Build messages array
        const messages = [];

        // Determine the effective system prompt
        let effectiveSystem = systemPrompt || '';
        if (schema) {
            const jsonInstruction = 'Respond with valid JSON only. Do not include any explanation or markdown code fences.';
            effectiveSystem = effectiveSystem ? `${effectiveSystem}\n\n${jsonInstruction}` : jsonInstruction;
        }

        if (effectiveSystem) {
            messages.push({ role: 'system', content: effectiveSystem });
        }

        // Build user content from parts or prompt
        if (Array.isArray(parts) && parts.length) {
            // Send as native multi-part content array to preserve anti-injection partition
            messages.push({
                role: 'user',
                content: parts.map((p) => ({ type: 'text', text: String(p.text ?? '') })),
            });
        } else {
            messages.push({ role: 'user', content: prompt || '' });
        }

        // Build request body
        const body = { model, messages };

        // response_format for structured JSON output
        if (schema) {
            body.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: 'response',
                    strict: false,
                    schema: schema,
                },
            };
        }

        // Map generationConfig fields to OpenAI equivalents
        if (generationConfig) {
            if (generationConfig.maxOutputTokens != null) body.max_tokens = generationConfig.maxOutputTokens;
            if (generationConfig.max_tokens != null) body.max_tokens = generationConfig.max_tokens;
            if (generationConfig.temperature != null) body.temperature = generationConfig.temperature;
        }

        try {
            const data = await this._post('/chat/completions', body);
            const raw = data?.choices?.[0]?.message?.content || '';
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
        try {
            const data = await this._post('/embeddings', {
                model: this._embeddingModelName,
                input: text,
            });
            const embedding = data?.data?.[0]?.embedding;
            if (!Array.isArray(embedding)) {
                throw new AIError({
                    code: AI_ERROR_CODE.INVALID_RESPONSE,
                    message: 'Embedding response did not contain a valid embedding array.',
                });
            }
            return embedding;
        } catch (err) {
            if (err instanceof AIError) throw err;
            throw toAIError(err);
        }
    }

    // -------------------------------------------------------------------------
    // generateStream
    // -------------------------------------------------------------------------

    /**
     * Generate a text stream. Yields string chunks as they arrive.
     * Parses the OpenAI SSE stream format.
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
            messages: [{ role: 'user', content: prompt || '' }],
        };

        if (generationConfig) {
            if (generationConfig.maxOutputTokens != null) body.max_tokens = generationConfig.maxOutputTokens;
            if (generationConfig.max_tokens != null) body.max_tokens = generationConfig.max_tokens;
            if (generationConfig.temperature != null) body.temperature = generationConfig.temperature;
        }

        const res = await this._postStream('/chat/completions', body, signal);

        // Parse SSE stream
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
                buffer = lines.pop() ?? ''; // last element may be incomplete

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') continue;
                    if (!trimmed.startsWith('data: ')) continue;

                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const delta = json?.choices?.[0]?.delta?.content;
                        if (delta) yield delta;
                    } catch {
                        // skip malformed SSE line
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
