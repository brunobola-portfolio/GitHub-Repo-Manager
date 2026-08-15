// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Wave 6c — server/lib/ai-features/image-provider.js
 *
 * Covers:
 *  - capability matrix (§4.1): per-provider recognition, key-presence gate,
 *    text-model auto-substitution, OpenRouter's open-ended '*' catalogue,
 *    anthropic/local always unavailable
 *  - TRAP 2: Gemini image calls never touch GeminiProvider/@google/generative-ai,
 *    they're a standalone raw fetch to the v1beta REST endpoint
 *  - TRAP 5: explicit refusal detection (Gemini promptFeedback block + text-only
 *    candidate, OpenAI/OpenRouter missing image payload) -> ImageRefusalError,
 *    never a silent "success" with an empty image
 *  - TRAP 4: generateImage() only calls recordAISpend after a real success;
 *    refusals, pricing-validation failures, and spend-cap denials never bill
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Control spend-cap + pricing decisions without touching the DB or the real
// (intentionally throw-on-unknown) pricing table for the orchestrator tests.
const spendCap = vi.hoisted(() => ({ result: { allowed: true, capCents: 0, spentCents: 0 } }));
const pricing = vi.hoisted(() => ({ impl: null }));

vi.mock('../lib/ai-spend-cap.js', () => ({
    checkAISpendCap: vi.fn(() => spendCap.result),
    recordAISpend: vi.fn(),
}));

vi.mock('../lib/ai-features/image-pricing.js', () => ({
    getImageCostCents: vi.fn((...args) => {
        if (pricing.impl) return pricing.impl(...args);
        return { cents: 4, estimated: false };
    }),
}));

import { checkAISpendCap, recordAISpend } from '../lib/ai-spend-cap.js';
import { getImageCostCents } from '../lib/ai-features/image-pricing.js';
import { AIError, AI_ERROR_CODE } from '../lib/ai-provider.js';
import {
    IMAGE_CAPABLE_MODELS,
    detectImageCapability,
    ImageRefusalError,
    generateGeminiImage,
    generateOpenAIImage,
    generateOpenRouterImage,
    generateImage,
} from '../lib/ai-features/image-provider.js';

const originalFetch = global.fetch;

beforeEach(() => {
    spendCap.result = { allowed: true, capCents: 0, spentCents: 0 };
    pricing.impl = null;
    vi.clearAllMocks();
});

afterEach(() => {
    global.fetch = originalFetch;
});

function jsonResponse(body, { ok = true, status = 200 } = {}) {
    return { ok, status, json: async () => body };
}

// ---------------------------------------------------------------------------
// Capability matrix
// ---------------------------------------------------------------------------

describe('detectImageCapability — capability matrix', () => {
    it('gemini: an already image-capable configured model is used as-is', () => {
        const result = detectImageCapability({ provider: 'gemini', model: 'gemini-2.5-flash-image', apiKey: 'k' });
        expect(result).toMatchObject({ available: true, provider: 'gemini', model: 'gemini-2.5-flash-image' });
        expect(result.substitutedFrom).toBeUndefined();
    });

    it('gemini: a text-default model is auto-substituted for the image sibling', () => {
        const result = detectImageCapability({ provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'k' });
        expect(result).toMatchObject({ available: true, provider: 'gemini', model: 'gemini-2.5-flash-image', substitutedFrom: 'gemini-2.5-flash' });
    });

    it('openai: gpt-image-1 and its successor id are both recognized as capable', () => {
        expect(detectImageCapability({ provider: 'openai', model: 'gpt-image-1', apiKey: 'k' }))
            .toMatchObject({ available: true, model: 'gpt-image-1' });
        expect(detectImageCapability({ provider: 'openai', model: 'gpt-image-1.5', apiKey: 'k' }))
            .toMatchObject({ available: true, model: 'gpt-image-1.5' });
    });

    it('openai: a non-image text model is substituted to the priced fallback (gpt-image-1)', () => {
        const result = detectImageCapability({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'k' });
        expect(result).toMatchObject({ available: true, provider: 'openai', model: 'gpt-image-1', substitutedFrom: 'gpt-4o-mini' });
    });

    it('openrouter: any configured model id is provisionally accepted (open catalogue)', () => {
        const result = detectImageCapability({ provider: 'openrouter', model: 'black-forest-labs/flux-1', apiKey: 'k' });
        expect(result).toMatchObject({ available: true, provider: 'openrouter', model: 'black-forest-labs/flux-1' });
    });

    it('openrouter: no configured model falls back to a documented default', () => {
        const result = detectImageCapability({ provider: 'openrouter', model: null, apiKey: 'k' });
        expect(result).toMatchObject({ available: true, provider: 'openrouter' });
        expect(result.model).toBeTruthy();
    });

    it('anthropic is never image-capable, regardless of model/key', () => {
        expect(detectImageCapability({ provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'k' }))
            .toMatchObject({ available: false, provider: 'anthropic', reason: 'provider_not_image_capable' });
    });

    it('local is never image-capable, regardless of model/key', () => {
        expect(detectImageCapability({ provider: 'local', model: 'llava', apiKey: 'k' }))
            .toMatchObject({ available: false, provider: 'local', reason: 'provider_not_image_capable' });
    });

    it('a recognized+capable provider with no API key is unavailable', () => {
        expect(detectImageCapability({ provider: 'gemini', model: 'gemini-2.5-flash-image', apiKey: null }))
            .toMatchObject({ available: false, provider: 'gemini', reason: 'no_api_key' });
    });

    it('no provider configured at all is unavailable', () => {
        expect(detectImageCapability(null)).toMatchObject({ available: false, provider: null, reason: 'no_provider_configured' });
        expect(detectImageCapability({})).toMatchObject({ available: false, provider: null, reason: 'no_provider_configured' });
    });

    it('IMAGE_CAPABLE_MODELS is frozen and exposes the documented shape', () => {
        expect(Object.isFrozen(IMAGE_CAPABLE_MODELS)).toBe(true);
        expect(IMAGE_CAPABLE_MODELS.openrouter).toBe('*');
        expect(IMAGE_CAPABLE_MODELS.gemini).toContain('gemini-2.5-flash-image');
    });
});

// ---------------------------------------------------------------------------
// Gemini — raw REST (TRAP 2 + TRAP 5)
// ---------------------------------------------------------------------------

describe('generateGeminiImage', () => {
    it('hits the v1beta REST endpoint directly with responseModalities, never the SDK', async () => {
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({
            candidates: [{ content: { parts: [{ inlineData: { data: 'BASE64DATA', mimeType: 'image/png' } }] } }],
        }));

        const result = await generateGeminiImage({ apiKey: 'gk', model: 'gemini-2.5-flash-image', prompt: 'a banner' });

        expect(result).toEqual({ base64: 'BASE64DATA', mimeType: 'image/png' });
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, init] = global.fetch.mock.calls[0];
        expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent');
        expect(init.headers['x-goog-api-key']).toBe('gk');
        const body = JSON.parse(init.body);
        expect(body.generationConfig.responseModalities).toEqual(['TEXT', 'IMAGE']);
    });

    it('defaults the mime type to image/png when the provider omits it', async () => {
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({
            candidates: [{ content: { parts: [{ inlineData: { data: 'BASE64DATA' } }] } }],
        }));
        const result = await generateGeminiImage({ apiKey: 'gk', model: 'gemini-2.5-flash-image', prompt: 'x' });
        expect(result.mimeType).toBe('image/png');
    });

    it('TRAP 5: promptFeedback.blockReason on a 200 is a refusal, not a success', async () => {
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({ promptFeedback: { blockReason: 'SAFETY' } }));
        await expect(generateGeminiImage({ apiKey: 'gk', model: 'gemini-2.5-flash-image', prompt: 'x' }))
            .rejects.toThrow(ImageRefusalError);
    });

    it('TRAP 5: a text-only candidate (no inlineData part) on a 200 is a refusal', async () => {
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({
            candidates: [{ content: { parts: [{ text: 'I cannot create this image.' }] } }],
        }));
        await expect(generateGeminiImage({ apiKey: 'gk', model: 'gemini-2.5-flash-image', prompt: 'x' }))
            .rejects.toMatchObject({ name: 'ImageRefusalError', code: 'IMAGE_REFUSAL' });
    });

    it('TRAP 5: an empty candidates array on a 200 is also a refusal, not a crash', async () => {
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({ candidates: [] }));
        await expect(generateGeminiImage({ apiKey: 'gk', model: 'gemini-2.5-flash-image', prompt: 'x' }))
            .rejects.toThrow(ImageRefusalError);
    });

    it('maps a non-2xx HTTP error to a typed AIError (401 -> AUTH)', async () => {
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'API key not valid' } }, { ok: false, status: 401 }));
        const err = await generateGeminiImage({ apiKey: 'bad', model: 'gemini-2.5-flash-image', prompt: 'x' }).catch((e) => e);
        expect(err).toBeInstanceOf(AIError);
        expect(err.code).toBe(AI_ERROR_CODE.AUTH);
    });

    it('throws AUTH without making a request when apiKey is missing', async () => {
        global.fetch = vi.fn();
        const err = await generateGeminiImage({ apiKey: '', model: 'gemini-2.5-flash-image', prompt: 'x' }).catch((e) => e);
        expect(err).toBeInstanceOf(AIError);
        expect(err.code).toBe(AI_ERROR_CODE.AUTH);
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// OpenAI Images API (TRAP 5)
// ---------------------------------------------------------------------------

describe('generateOpenAIImage', () => {
    it('POSTs to /images/generations with bearer auth and returns the b64_json payload', async () => {
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: [{ b64_json: 'OPENAIDATA' }] }));

        const result = await generateOpenAIImage({ apiKey: 'sk-test', model: 'gpt-image-1', prompt: 'a logo', size: '1024x1024', quality: 'medium' });

        expect(result).toEqual({ base64: 'OPENAIDATA', mimeType: 'image/png' });
        const [url, init] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.openai.com/v1/images/generations');
        expect(init.headers.Authorization).toBe('Bearer sk-test');
        const body = JSON.parse(init.body);
        expect(body).toMatchObject({ model: 'gpt-image-1', prompt: 'a logo', size: '1024x1024', quality: 'medium', n: 1 });
    });

    it('respects a custom baseURL (e.g. an OpenAI-compatible relay)', async () => {
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: [{ b64_json: 'D' }] }));
        await generateOpenAIImage({ apiKey: 'k', model: 'gpt-image-1', prompt: 'x', baseURL: 'https://relay.example.com/v1/' });
        expect(global.fetch.mock.calls[0][0]).toBe('https://relay.example.com/v1/images/generations');
    });

    it('TRAP 5: a 200 with no data/b64_json is a refusal, not a crash', async () => {
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
        await expect(generateOpenAIImage({ apiKey: 'k', model: 'gpt-image-1', prompt: 'x' }))
            .rejects.toThrow(ImageRefusalError);
    });

    it('maps a 429 to RATE_LIMITED', async () => {
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'rate limited' } }, { ok: false, status: 429 }));
        const err = await generateOpenAIImage({ apiKey: 'k', model: 'gpt-image-1', prompt: 'x' }).catch((e) => e);
        expect(err).toBeInstanceOf(AIError);
        expect(err.code).toBe(AI_ERROR_CODE.RATE_LIMITED);
    });
});

// ---------------------------------------------------------------------------
// OpenRouter dedicated Image API — distinct endpoint/shape from chat-completions
// ---------------------------------------------------------------------------

describe('generateOpenRouterImage', () => {
    it('POSTs to /images/generations (NOT /chat/completions) with the images[] response shape', async () => {
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({ images: [{ b64_json: 'ORDATA', content_type: 'image/webp' }] }));

        const result = await generateOpenRouterImage({ apiKey: 'or-key', model: 'google/gemini-2.5-flash-image', prompt: 'a hero image' });

        expect(result).toEqual({ base64: 'ORDATA', mimeType: 'image/webp', model: 'google/gemini-2.5-flash-image' });
        const [url] = global.fetch.mock.calls[0];
        expect(url).toBe('https://openrouter.ai/api/v1/images/generations');
        expect(url).not.toContain('/chat/completions');
    });

    it('substitutes the documented default model when none is provided', async () => {
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({ images: [{ b64_json: 'D' }] }));
        const result = await generateOpenRouterImage({ apiKey: 'k', model: null, prompt: 'x' });
        expect(result.model).toBeTruthy();
        const body = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(body.model).toBe(result.model);
    });

    it('defaults mimeType to image/png when the provider omits content_type/mime_type', async () => {
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({ images: [{ b64_json: 'D' }] }));
        const result = await generateOpenRouterImage({ apiKey: 'k', model: 'm', prompt: 'x' });
        expect(result.mimeType).toBe('image/png');
    });

    it('TRAP 5: an empty images[] array is a refusal, not a crash', async () => {
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({ images: [] }));
        await expect(generateOpenRouterImage({ apiKey: 'k', model: 'm', prompt: 'x' }))
            .rejects.toThrow(ImageRefusalError);
    });
});

// ---------------------------------------------------------------------------
// generateImage — orchestrator: capability -> pricing -> spend cap -> call -> record
// ---------------------------------------------------------------------------

describe('generateImage — orchestration', () => {
    it('rejects an empty prompt before touching capability/spend/network', async () => {
        global.fetch = vi.fn();
        await expect(generateImage({ userId: 1, providerConfig: { provider: 'gemini', model: 'gemini-2.5-flash-image', apiKey: 'k' }, prompt: '   ' }))
            .rejects.toMatchObject({ code: AI_ERROR_CODE.INVALID_RESPONSE });
        expect(global.fetch).not.toHaveBeenCalled();
        expect(checkAISpendCap).not.toHaveBeenCalled();
    });

    it('honest empty-state: an incapable provider throws a clear AIError, never a spinner-then-fail', async () => {
        global.fetch = vi.fn();
        const err = await generateImage({
            userId: 1,
            providerConfig: { provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'k' },
            prompt: 'a banner',
        }).catch((e) => e);

        expect(err).toBeInstanceOf(AIError);
        expect(err.code).toBe(AI_ERROR_CODE.NOT_FOUND);
        expect(err.message).toMatch(/isn't available with your current AI provider \(anthropic\)/);
        expect(global.fetch).not.toHaveBeenCalled();
        expect(checkAISpendCap).not.toHaveBeenCalled();
    });

    it('TRAP 3: an unpriced (provider, model, quality, size) combo fails BEFORE the spend-cap check or any network call', async () => {
        pricing.impl = () => { throw new Error('getImageCostCents: unknown model'); };
        global.fetch = vi.fn();

        const err = await generateImage({
            userId: 1,
            providerConfig: { provider: 'gemini', model: 'gemini-2.5-flash-image', apiKey: 'k' },
            prompt: 'a banner',
        }).catch((e) => e);

        expect(err).toBeInstanceOf(AIError);
        expect(checkAISpendCap).not.toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(recordAISpend).not.toHaveBeenCalled();
    });

    it('denies the call when the monthly spend cap is already reached, before any provider request', async () => {
        spendCap.result = { allowed: false, capCents: 500, spentCents: 500 };
        global.fetch = vi.fn();

        await expect(generateImage({
            userId: 1,
            providerConfig: { provider: 'gemini', model: 'gemini-2.5-flash-image', apiKey: 'k' },
            prompt: 'a banner',
        })).rejects.toMatchObject({ code: 'AI_SPEND_CAP_REACHED', spendInfo: { capCents: 500, spentCents: 500 } });

        expect(global.fetch).not.toHaveBeenCalled();
        expect(recordAISpend).not.toHaveBeenCalled();
    });

    it('TRAP 4: records spend exactly once, in dollars, only after a real success', async () => {
        pricing.impl = () => ({ cents: 4, estimated: false });
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({
            candidates: [{ content: { parts: [{ inlineData: { data: 'BASE64DATA', mimeType: 'image/png' } }] } }],
        }));

        const result = await generateImage({
            userId: 42,
            providerConfig: { provider: 'gemini', model: 'gemini-2.5-flash-image', apiKey: 'k' },
            prompt: 'a banner',
        });

        expect(result).toMatchObject({ base64: 'BASE64DATA', mimeType: 'image/png', provider: 'gemini', model: 'gemini-2.5-flash-image', costCents: 4, estimatedCost: false });
        expect(recordAISpend).toHaveBeenCalledTimes(1);
        expect(recordAISpend).toHaveBeenCalledWith(42, 4 / 100);
    });

    it('TRAP 4/5: a refusal never calls recordAISpend', async () => {
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({ promptFeedback: { blockReason: 'SAFETY' } }));

        await expect(generateImage({
            userId: 1,
            providerConfig: { provider: 'gemini', model: 'gemini-2.5-flash-image', apiKey: 'k' },
            prompt: 'a banner',
        })).rejects.toBeInstanceOf(ImageRefusalError);

        expect(recordAISpend).not.toHaveBeenCalled();
    });

    it('routes to the OpenAI generator and records the tiered cost it resolved', async () => {
        pricing.impl = (provider, model, { quality, size }) => {
            expect(provider).toBe('openai');
            expect(model).toBe('gpt-image-1');
            expect(quality).toBe('medium');
            expect(size).toBe('1024x1024');
            return { cents: 4.2, estimated: false };
        };
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: [{ b64_json: 'D' }] }));

        const result = await generateImage({
            userId: 7,
            providerConfig: { provider: 'openai', model: 'gpt-image-1', apiKey: 'sk' },
            prompt: 'a logo',
        });

        expect(result.costCents).toBe(4.2);
        expect(getImageCostCents).toHaveBeenCalled();
        expect(recordAISpend).toHaveBeenCalledWith(7, 4.2 / 100);
    });

    it('flags OpenRouter cost as an estimate in the returned result', async () => {
        pricing.impl = () => ({ cents: 4, estimated: true });
        global.fetch = vi.fn().mockResolvedValue(jsonResponse({ images: [{ b64_json: 'D' }] }));

        const result = await generateImage({
            userId: 3,
            providerConfig: { provider: 'openrouter', model: 'some/routed-model', apiKey: 'or' },
            prompt: 'a hero image',
        });

        expect(result.estimatedCost).toBe(true);
    });
});
