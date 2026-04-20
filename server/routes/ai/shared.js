/*
 * Shared AI route helpers — common imports, the requireAI middleware, the
 * unified AI error responder, and the provider-neutral retry wrapper.
 *
 * Each sub-router under server/routes/ai/ imports from here so we don't
 * duplicate the AIError → HTTP mapping or re-instantiate requireAI in
 * every file. The barrel at ../ai.js is still the public entry point for
 * the application; this module is considered internal.
 */

import { createRequireAI } from '../../middleware/auth.js';
import { aiService } from '../../ai-service.js';
import { AIError, AI_ERROR_CODE } from '../../lib/ai-provider.js';

// ---------------------------------------------------------------------------
// requireAI — factory-built middleware, instantiated once per process.
// ---------------------------------------------------------------------------
export const requireAI = createRequireAI(aiService);

// ---------------------------------------------------------------------------
// handleAIError — normalises provider / SDK errors into the Express response.
// ---------------------------------------------------------------------------
/**
 * Shared AI error handler — maps common AI errors to user-friendly responses.
 * Prefers typed AIError codes; falls back to string/status matching for
 * errors that haven't been converted yet (e.g. raw SDK errors on legacy paths).
 */
export function handleAIError(res, error, fallbackMessage = 'Failed to generate AI response. Please try again later.') {
    const code = error instanceof AIError ? error.code : null;

    if (code === AI_ERROR_CODE.NOT_FOUND || (!code && (error.message?.includes('not found') || error.status === 404))) {
        return res.status(404).json({
            error: 'The configured AI model is not available. Please verify the GEMINI_MODEL setting.',
            code: 'MODEL_NOT_FOUND',
        });
    }
    if (code === AI_ERROR_CODE.AUTH || (!code && (error.message?.includes('API key') || error.status === 401))) {
        return res.status(401).json({
            error: 'Invalid or expired Gemini API key. Please check your GEMINI_API_KEY in .env file.',
            code: 'INVALID_API_KEY',
        });
    }
    if (code === AI_ERROR_CODE.QUOTA || (!code && (error.message?.includes('quota') || error.status === 429))) {
        return res.status(429).json({
            error: 'API quota exceeded. Please try again later or check your Gemini API usage limits.',
            code: 'QUOTA_EXCEEDED',
        });
    }
    if (code === AI_ERROR_CODE.OVERLOAD || (!code && (error.status === 503 || /overload|unavailable|high demand/i.test(error.message || '')))) {
        return res.status(503).json({
            error: 'Gemini is under heavy load right now. Give it a moment and try again.',
            code: 'AI_OVERLOADED',
        });
    }
    return res.status(500).json({ error: fallbackMessage, code: 'AI_REQUEST_FAILED' });
}

// ---------------------------------------------------------------------------
// providerGenerateWithRetry — retry wrapper that works with any provider.
// ---------------------------------------------------------------------------
/**
 * Retries a provider.generate() call when the error maps to
 * AI_ERROR_CODE.OVERLOAD (503-equivalent in any vendor). Works with any
 * AIProvider implementation (Gemini, Anthropic, OpenAI, OpenRouter, Local).
 */
export async function providerGenerateWithRetry(provider, opts, { retries = 1, delayMs = 400 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await provider.generate(opts);
        } catch (err) {
            lastError = err;
            const isOverload = (err instanceof AIError && err.code === AI_ERROR_CODE.OVERLOAD)
                || err?.status === 503
                || /overload|unavailable|high demand/i.test(err?.message || '');
            if (!isOverload || attempt === retries) break;
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
    throw lastError;
}
