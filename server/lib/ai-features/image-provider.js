// SPDX-License-Identifier: Apache-2.0
/**
 * Provider image generation layer (Wave 6c / R5 — AI raster image generation).
 *
 * This is deliberately NOT an extension of the existing `generate()` contract
 * in `server/lib/ai-provider.js` / `server/lib/providers/*.js` — none of the
 * three integration shapes below (Gemini REST, OpenAI Images, OpenRouter
 * Image API) reuse that method signature, and two of the five confirmed
 * traps in the design doc live specifically in the gap between "the text
 * generate() contract" and "what image generation actually needs":
 *
 *  TRAP 2 (Gemini SDK gap) — `GeminiProvider` wraps the deprecated, legacy
 *  `@google/generative-ai@0.24.1` SDK, which predates `responseModalities`
 *  and cannot do image output. This module NEVER touches `GeminiProvider`;
 *  `generateGeminiImage()` below is a standalone raw `fetch()` against the
 *  `v1beta` REST endpoint, mirroring the "bare fetch, no SDK" pattern
 *  `OpenAIProvider` already uses (see `server/lib/providers/openai.js`).
 *
 *  TRAP 5 (silent refusals) — every provider here can return HTTP 200 with a
 *  text-only refusal / safety block instead of an image part. Each raw-fetch
 *  function detects that explicitly and throws `ImageRefusalError` — a
 *  refusal must never be mistaken for a successful (but empty) generation,
 *  and `generateImage()` never charges quota/spend for one (TRAP 4/5).
 *
 * Resolution of "which provider + credentials is this user's active
 * configuration" is intentionally left to the caller (the AI route layer).
 * `createProviderForUser()` (`../ai-provider.js`) already implements that
 * resolution order (BYOK user config -> server env fallback), but it returns
 * an opaque provider *instance* built for the SDK-shaped `generate()`
 * contract — not the raw `{ apiKey, baseURL }` this module's REST calls need.
 * Callers build a `providerConfig` object (`{ provider, model, apiKey,
 * baseURL? }`) using that same resolution order and pass it in here.
 */

import { AIError, AI_ERROR_CODE, toAIError, throwIfCanceled, isServerKeyProvider } from '../ai-provider.js';
import { getImageCostCents } from './image-pricing.js';
import { checkAISpendCap, recordAISpend } from '../ai-spend-cap.js';

// ---------------------------------------------------------------------------
// Capability matrix (static — never a live probe call; see r5 §3a/§4.1)
// ---------------------------------------------------------------------------

/**
 * Provider -> recognized image-capable model ids, or `'*'` for providers
 * (OpenRouter) that front an open-ended catalogue of third-party models via
 * a dedicated capability/discovery API rather than a fixed short list.
 *
 * `gpt-image-1.5` is listed as *recognized* even though `image-pricing.js`
 * does not yet have an exact price for it (only `gpt-image-1` does) — that
 * is deliberate: capability and pricing are separate concerns. A user who
 * explicitly configures `gpt-image-1.5` is capability-eligible; whether a
 * call for it can be *billed* honestly is `getImageCostCents()`'s call,
 * enforced in `generateImage()` below before any provider request is made.
 */
export const IMAGE_CAPABLE_MODELS = Object.freeze({
    gemini: Object.freeze(['gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview']),
    openai: Object.freeze(['gpt-image-1', 'gpt-image-1.5']),
    openrouter: '*',
});

// Providers with no known image-output API as of r5's research — never
// capability-eligible in v1, regardless of what model id is configured.
const PROVIDERS_NEVER_CAPABLE = new Set(['anthropic', 'local']);

// When the provider is image-capable but the user's *configured* completion
// model isn't itself an image model (e.g. `gemini-2.5-flash`, a text
// default), auto-substitute this sibling for the image call only — mirrors
// `GeminiProvider.generate()`'s existing per-call `modelOverride` pattern.
// Chosen to be the model `image-pricing.js` can actually price today (not
// necessarily OpenAI's newest successor id — see the JSDoc above).
const IMAGE_MODEL_FALLBACK = Object.freeze({
    gemini: 'gemini-2.5-flash-image',
    openai: 'gpt-image-1',
});

// OpenRouter has no single "the" default image model; this is only used
// when a user's OpenRouter completion model isn't itself image-capable and
// no override was supplied — a reasonable, currently-priced starting point
// (see `image-pricing.js`'s `OPENROUTER_KNOWN_MODEL_CENTS`).
const OPENROUTER_DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image';

/**
 * Resolve whether `providerConfig` — the caller's already-resolved active
 * provider config for a user — can generate images, and which model id to
 * actually call.
 *
 * Pure and synchronous: no network probe, no DB access. Requires both a
 * recognized provider AND a present API key ("ACTIVE provider+key", per the
 * design doc) — a provider that's capable in the abstract but has no key
 * configured is not available for this user.
 *
 * @param {object|null|undefined} providerConfig
 * @param {string|null} [providerConfig.provider] — 'gemini' | 'openai' | 'openrouter' | 'anthropic' | 'local'
 * @param {string|null} [providerConfig.model]    — the user's configured completion model, if any
 * @param {string|null} [providerConfig.apiKey]
 * @returns {{ available: boolean, provider: string|null, model: string|null, reason?: string, substitutedFrom?: string }}
 */
export function detectImageCapability(providerConfig) {
    const provider = providerConfig?.provider ? String(providerConfig.provider).toLowerCase() : null;
    const apiKey = providerConfig?.apiKey || null;

    if (!provider) {
        return { available: false, provider: null, model: null, reason: 'no_provider_configured' };
    }
    if (PROVIDERS_NEVER_CAPABLE.has(provider)) {
        return { available: false, provider, model: null, reason: 'provider_not_image_capable' };
    }
    const capableModels = IMAGE_CAPABLE_MODELS[provider];
    if (!capableModels) {
        return { available: false, provider, model: null, reason: 'provider_not_image_capable' };
    }
    if (!apiKey) {
        return { available: false, provider, model: null, reason: 'no_api_key' };
    }

    const requestedModel = providerConfig.model || null;

    if (capableModels === '*') {
        // OpenRouter: any configured model id is provisionally accepted —
        // the dedicated Image API request itself is the source of truth for
        // whether that particular routed model actually supports images.
        return { available: true, provider, model: requestedModel || OPENROUTER_DEFAULT_IMAGE_MODEL };
    }

    if (requestedModel && capableModels.includes(requestedModel)) {
        return { available: true, provider, model: requestedModel };
    }

    const fallback = IMAGE_MODEL_FALLBACK[provider];
    if (fallback) {
        return {
            available: true,
            provider,
            model: fallback,
            ...(requestedModel ? { substitutedFrom: requestedModel } : {}),
        };
    }

    return { available: false, provider, model: null, reason: 'model_not_image_capable' };
}

// ---------------------------------------------------------------------------
// ImageRefusalError — TRAP 5 typed error
// ---------------------------------------------------------------------------

/**
 * A provider responded successfully (HTTP 200) but declined to produce an
 * image — a content-policy refusal, a safety block, or a text-only
 * candidate with no image part. Distinct from every other `AIError` code so
 * callers can special-case it (route handlers MUST check
 * `error.code === 'IMAGE_REFUSAL'` before falling through to the generic
 * `handleAIError()` mapping — same established pattern as
 * `AI_SPEND_CAP_REACHED`, which also isn't in the frozen `AI_ERROR_CODE`
 * enum). `generateImage()` never charges quota or spend when this is thrown.
 */
export class ImageRefusalError extends AIError {
    constructor({ provider, model, message, cause } = {}) {
        super({
            code: 'IMAGE_REFUSAL',
            message: message || 'The AI provider declined to generate this image. Try rephrasing the prompt.',
            status: 422,
            cause,
            details: { provider, model, refusal: true },
        });
        this.name = 'ImageRefusalError';
        this.provider = provider;
        this.model = model;
    }
}

// ---------------------------------------------------------------------------
// Shared raw-fetch helper
// ---------------------------------------------------------------------------

/**
 * POST JSON, normalise transport/HTTP failures to `AIError` via the shared
 * `toAIError()` mapper (network errors, 401/404/429/5xx all get consistent
 * codes), and return the parsed JSON body. Does NOT interpret the body —
 * refusal detection is provider-specific and happens in each caller.
 *
 * @param {string} url
 * @param {{ headers: Record<string,string>, body: object, signal?: AbortSignal }} opts
 * @returns {Promise<object|null>}
 */
async function fetchImageJson(url, { headers, body, signal }) {
    let res;
    try {
        res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (networkErr) {
        throwIfCanceled(networkErr, signal);
        throw toAIError(networkErr);
    }

    let json = null;
    try {
        json = await res.json();
    } catch {
        // non-JSON body — fall through with json === null
    }

    if (!res.ok) {
        const message = json?.error?.message || json?.error?.status || `HTTP ${res.status}`;
        throw toAIError({ message, status: res.status });
    }

    return json;
}

// ---------------------------------------------------------------------------
// Gemini — raw REST, bypassing the legacy SDK entirely (TRAP 2)
// ---------------------------------------------------------------------------

const GEMINI_IMAGE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Call Gemini's `generateContent` REST endpoint directly with
 * `responseModalities: ['TEXT', 'IMAGE']`. Deliberately bypasses
 * `GeminiProvider` / `@google/generative-ai` — see the module header.
 *
 * @param {{ apiKey: string, model: string, prompt: string, signal?: AbortSignal }} opts
 * @returns {Promise<{ base64: string, mimeType: string }>}
 */
export async function generateGeminiImage({ apiKey, model, prompt, signal }) {
    if (!apiKey) {
        throw new AIError({ code: AI_ERROR_CODE.AUTH, message: 'Missing Gemini API key.', status: 401 });
    }

    const url = `${GEMINI_IMAGE_API_BASE}/${encodeURIComponent(model)}:generateContent`;
    const json = await fetchImageJson(url, {
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        },
        signal,
    });

    // TRAP 5: a prompt-level safety block surfaces via `promptFeedback`, not
    // an HTTP error status.
    const blockReason = json?.promptFeedback?.blockReason;
    if (blockReason) {
        throw new ImageRefusalError({
            provider: 'gemini',
            model,
            message: `Gemini declined to generate this image (${blockReason}). Try rephrasing the prompt.`,
        });
    }

    const candidate = json?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const imagePart = parts.find((p) => p?.inlineData?.data);

    if (!imagePart) {
        // TRAP 5: HTTP 200, but the candidate is text-only — a refusal
        // dressed up as a normal response, not a transport/HTTP error.
        const textPart = parts.find((p) => typeof p?.text === 'string' && p.text.trim());
        throw new ImageRefusalError({
            provider: 'gemini',
            model,
            message: textPart?.text
                ? `Gemini declined to generate an image and returned text instead: "${textPart.text.slice(0, 200)}"`
                : 'Gemini did not return an image for this prompt. Try rephrasing.',
        });
    }

    return { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType || 'image/png' };
}

// ---------------------------------------------------------------------------
// OpenAI — Images API (b64_json), sibling to OpenAIProvider's chat/embeddings calls
// ---------------------------------------------------------------------------

/**
 * Call OpenAI's Images API (`/images/generations`). Returns base64 JSON by
 * default for `gpt-image-1`/successors — matches the app's existing
 * base64-native write path (see `commitOrOpenPR`'s `encoding: 'base64'`).
 *
 * @param {{ apiKey: string, model: string, prompt: string, size?: string, quality?: string, baseURL?: string, signal?: AbortSignal }} opts
 * @returns {Promise<{ base64: string, mimeType: string }>}
 */
export async function generateOpenAIImage({ apiKey, model, prompt, size, quality, baseURL = 'https://api.openai.com/v1', signal }) {
    if (!apiKey) {
        throw new AIError({ code: AI_ERROR_CODE.AUTH, message: 'Missing OpenAI API key.', status: 401 });
    }

    const url = `${String(baseURL).replace(/\/$/, '')}/images/generations`;
    const json = await fetchImageJson(url, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: { model, prompt, ...(size ? { size } : {}), ...(quality ? { quality } : {}), n: 1 },
        signal,
    });

    const entry = json?.data?.[0];
    if (!entry?.b64_json) {
        // TRAP 5: a 200 with an empty/missing data array (rare, but the API
        // shape allows it) is a refusal, not a crash-worthy malformed response.
        throw new ImageRefusalError({
            provider: 'openai',
            model,
            message: 'OpenAI did not return an image for this prompt. Try rephrasing.',
        });
    }

    return { base64: entry.b64_json, mimeType: 'image/png' };
}

// ---------------------------------------------------------------------------
// OpenRouter — dedicated Image API (NOT the chat-completions endpoint)
// ---------------------------------------------------------------------------

/**
 * Call OpenRouter's dedicated Image API. `OpenRouterProvider` (the class
 * used for text) POSTs to `/chat/completions`; this is a genuinely separate
 * endpoint/shape, built as its own request/response handling rather than an
 * extension of `OpenRouterProvider.generate()` — see the module header.
 *
 * @param {{ apiKey: string, model?: string, prompt: string, size?: string, baseURL?: string, signal?: AbortSignal }} opts
 * @returns {Promise<{ base64: string, mimeType: string, model: string }>}
 */
export async function generateOpenRouterImage({ apiKey, model, prompt, size, baseURL = 'https://openrouter.ai/api/v1', signal }) {
    if (!apiKey) {
        throw new AIError({ code: AI_ERROR_CODE.AUTH, message: 'Missing OpenRouter API key.', status: 401 });
    }

    const effectiveModel = model || OPENROUTER_DEFAULT_IMAGE_MODEL;
    const url = `${String(baseURL).replace(/\/$/, '')}/images/generations`;
    const json = await fetchImageJson(url, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: { model: effectiveModel, prompt, ...(size ? { size } : {}) },
        signal,
    });

    const image = json?.images?.[0];
    if (!image?.b64_json) {
        throw new ImageRefusalError({
            provider: 'openrouter',
            model: effectiveModel,
            message: 'The routed model did not return an image for this prompt. Try rephrasing, or pick a different image model in Settings.',
        });
    }

    return {
        base64: image.b64_json,
        mimeType: image.content_type || image.mime_type || 'image/png',
        model: effectiveModel,
    };
}

// ---------------------------------------------------------------------------
// generateImage — top-level orchestrator (capability -> pricing -> spend -> call -> spend record)
// ---------------------------------------------------------------------------

const PROVIDER_IMAGE_GENERATORS = Object.freeze({
    gemini: generateGeminiImage,
    openai: generateOpenAIImage,
    openrouter: generateOpenRouterImage,
});

/** OpenAI has no 'standard' quality tier; every other provider in this table does. */
function resolveEffectiveQuality(provider, quality) {
    if (quality) return quality;
    return provider === 'openai' ? 'medium' : 'standard';
}

/**
 * Generate one image end to end: capability check, pricing validation,
 * monthly spend-cap check, the provider-specific call, then — and only on a
 * genuine success — record the real spend.
 *
 * Never increments the `ai_image` count quota itself (that stays a route
 * concern, checked/incremented alongside the existing `imageGenPerMonth`
 * pattern in `usage-meter.js`) — this function owns the *dollar* guardrail
 * (TRAP 4), not the count guardrail.
 *
 * @param {object} opts
 * @param {number} opts.userId
 * @param {{ provider: string|null, model: string|null, apiKey: string|null, baseURL?: string }} opts.providerConfig
 * @param {string} opts.prompt
 * @param {string} [opts.size='1024x1024']
 * @param {string} [opts.quality] — provider-specific tier; defaults per-provider (see `resolveEffectiveQuality`)
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ base64: string, mimeType: string, provider: string, model: string, costCents: number, estimatedCost: boolean }>}
 * @throws {AIError}            — not available, prompt missing, provider/transport failure, unpriced combo
 * @throws {ImageRefusalError}  — provider declined the prompt (TRAP 5) — not billed
 * @throws {Error}              — `.code === 'AI_SPEND_CAP_REACHED'` when the monthly spend cap is already hit
 */
export async function generateImage({ userId, providerConfig, prompt, size = '1024x1024', quality, signal } = {}) {
    if (!prompt || !String(prompt).trim()) {
        throw new AIError({ code: AI_ERROR_CODE.INVALID_RESPONSE, message: 'A prompt is required to generate an image.', status: 400 });
    }

    const capability = detectImageCapability(providerConfig);
    if (!capability.available) {
        throw new AIError({
            code: AI_ERROR_CODE.NOT_FOUND,
            message: `Image generation isn't available with your current AI provider${capability.provider ? ` (${capability.provider})` : ''}. Switch provider in Settings to use this feature.`,
            status: 404,
            details: { reason: capability.reason || 'not_available', provider: capability.provider },
        });
    }

    const effectiveQuality = resolveEffectiveQuality(capability.provider, quality);

    // TRAP 3: resolve + validate pricing BEFORE spending money on a provider
    // call. An unpriced (provider, model, quality, size) combo fails closed
    // here — we must never bill a real generation we then can't account for.
    let cost;
    try {
        cost = getImageCostCents(capability.provider, capability.model, { quality: effectiveQuality, size });
    } catch (pricingErr) {
        throw new AIError({
            code: AI_ERROR_CODE.NOT_FOUND,
            message: `Image pricing isn't configured yet for ${capability.provider}/${capability.model} (quality: ${effectiveQuality}, size: ${size}).`,
            status: 501,
            cause: pricingErr,
        });
    }

    // BYOK is exempt from the operator's cap: resolveImageProviderConfig tags
    // the config with where its key came from, and a user paying their own
    // image bill must not be throttled by the operator's ceiling.
    const billsOperator = isServerKeyProvider(providerConfig);
    const spend = checkAISpendCap(userId, { billsOperator });
    if (!spend.allowed) {
        const err = new Error('Monthly AI spend limit reached. Try again next month or raise the cap.');
        err.code = 'AI_SPEND_CAP_REACHED';
        err.spendInfo = spend;
        throw err;
    }

    const generator = PROVIDER_IMAGE_GENERATORS[capability.provider];
    if (!generator) {
        // Defensive: detectImageCapability() should never return
        // available:true for a provider without a generator entry.
        throw new AIError({ code: AI_ERROR_CODE.NOT_FOUND, message: 'Image generation is not implemented for this provider.', status: 404 });
    }

    // TRAP 5: the generator throws ImageRefusalError (or any AIError) on a
    // refusal/failure, which propagates out of this function BEFORE the
    // recordAISpend call below ever runs — a declined or failed generation
    // never charges spend.
    const result = await generator({
        apiKey: providerConfig?.apiKey,
        baseURL: providerConfig?.baseURL,
        model: capability.model,
        prompt,
        size,
        quality: effectiveQuality,
        signal,
    });

    const finalModel = result.model || capability.model;

    // TRAP 4: only a SUCCESSFUL image reaches this line — spend is recorded
    // exactly once, using the cost resolved (and validated) up front.
    // recordAISpend takes USD; cost.cents is authoritative flat/tiered cents.
    if (billsOperator) recordAISpend(userId, cost.cents / 100);

    return {
        base64: result.base64,
        mimeType: result.mimeType,
        provider: capability.provider,
        model: finalModel,
        costCents: cost.cents,
        estimatedCost: cost.estimated,
    };
}
