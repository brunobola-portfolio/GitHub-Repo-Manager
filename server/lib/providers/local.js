/**
 * LocalProvider — OpenAI-compatible local endpoint.
 *
 * Works with LMStudio, Ollama (with /v1 compat layer), llama.cpp server, etc.
 * No real API key is required; most local servers ignore Authorization headers.
 *
 * Embeddings: supported if the loaded model supports them; otherwise the server
 * will return an error which is propagated via toAIError.
 */

import { OpenAIProvider } from './openai.js';

export class LocalProvider extends OpenAIProvider {
    /**
     * @param {object} opts
     * @param {string} [opts.endpointUrl] — default: 'http://localhost:1234/v1'
     * @param {string} [opts.apiKey]      — default: 'local' (accepted by LMStudio; Ollama ignores it)
     * @param {string} [opts.model]       — user-chosen local model name
     * @param {string} [opts.embeddingModel]
     */
    constructor({
        endpointUrl = 'http://localhost:1234/v1',
        apiKey = 'local',
        model = 'local-model',
        embeddingModel = 'local-model',
    } = {}) {
        super({ apiKey, model, embeddingModel, baseURL: endpointUrl });
    }

    /**
     * Override auth header: send 'Bearer <apiKey>' which most local servers accept.
     * If apiKey is 'local' or empty the local server will simply ignore the header.
     * @returns {string}
     */
    _authHeader() {
        return `Bearer ${this._apiKey}`;
    }
}
