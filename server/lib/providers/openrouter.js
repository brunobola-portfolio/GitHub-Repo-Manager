/**
 * OpenRouterProvider — thin subclass of OpenAIProvider.
 *
 * OpenRouter exposes an OpenAI-compatible API at https://openrouter.ai/api/v1.
 * It supports model routing across hundreds of providers (Claude, GPT, etc.)
 * but does NOT provide native embedding endpoints.
 *
 * Embeddings: not supported — throws with a user-friendly message pointing
 * users to configure a separate embedding provider.
 */

import { AIError, AI_ERROR_CODE } from '../ai-provider.js';
import { OpenAIProvider } from './openai.js';

export class OpenRouterProvider extends OpenAIProvider {
    /**
     * @param {object} opts
     * @param {string} opts.apiKey                    — OpenRouter API key
     * @param {string} [opts.model]                   — default: 'anthropic/claude-sonnet-4-6'
     * @param {string} [opts.baseURL]                 — default: 'https://openrouter.ai/api/v1'
     */
    constructor({
        apiKey,
        model = 'anthropic/claude-sonnet-4-6',
        baseURL = 'https://openrouter.ai/api/v1',
    } = {}) {
        // OpenRouter has no embedding model
        super({ apiKey, model, embeddingModel: '', baseURL });
    }

    /**
     * Embeddings are typically unsupported via OpenRouter.
     * Users should configure a dedicated embedding provider (Gemini, OpenAI, Local).
     *
     * @returns {never}
     */
    async embed(_text) {
        throw new AIError({
            code: AI_ERROR_CODE.NOT_FOUND,
            message:
                'OpenRouter does not support embeddings. Configure a separate embedding provider in Settings.',
            status: 404,
        });
    }
}
