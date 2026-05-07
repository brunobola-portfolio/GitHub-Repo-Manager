/**
 * Friendly AI error formatter for the /test endpoint.
 *
 * Goal: take whatever the provider threw at us — an AIError with structured
 * details, a generic Error, or a raw SDK rejection — and produce a stable,
 * UI-ready payload with:
 *   - a category title ("Authentication failed", "Upstream provider error", …)
 *   - the redacted raw message (so curious users still see the truth)
 *   - an actionable hint tailored to the provider + error code
 *   - structured fields (httpStatus, upstreamProvider, model, …) for badges
 *
 * The shape is deliberately additive over the historical { ok, error, code }
 * response so the existing TestButton keeps working unchanged while the new
 * card-style UI can opt into the richer fields.
 */

import { AI_ERROR_CODE } from './ai-provider.js';
import { redactSecrets } from './redact-secrets.js';

const PROVIDER_LABELS = Object.freeze({
    GeminiProvider: 'Gemini',
    OpenAIProvider: 'OpenAI',
    OpenRouterProvider: 'OpenRouter',
    AnthropicProvider: 'Anthropic',
    LocalProvider: 'Local',
});

const TITLES = Object.freeze({
    [AI_ERROR_CODE.AUTH]: 'Authentication failed',
    [AI_ERROR_CODE.QUOTA]: 'Quota exceeded',
    [AI_ERROR_CODE.RATE_LIMITED]: 'Rate limited',
    [AI_ERROR_CODE.NOT_FOUND]: 'Model or resource not found',
    [AI_ERROR_CODE.OVERLOAD]: 'Provider temporarily overloaded',
    [AI_ERROR_CODE.TIMEOUT]: 'Request timed out',
    [AI_ERROR_CODE.NETWORK]: 'Network error',
    [AI_ERROR_CODE.INVALID_RESPONSE]: 'Invalid response from provider',
    [AI_ERROR_CODE.CANCELED]: 'Request canceled',
    [AI_ERROR_CODE.UNKNOWN]: 'Provider call failed',
});

/**
 * Resolve a friendly provider label from a provider instance.
 * Falls back to constructor name then 'Provider' so logs always have something.
 */
export function getProviderLabel(provider) {
    if (!provider) return null;
    const ctor = provider.constructor?.name;
    return PROVIDER_LABELS[ctor] || ctor || 'Provider';
}

/**
 * Build a hint tailored to the error code, provider, and model.
 *
 * Hints are short (one sentence), actionable, and never redundant with the
 * raw message. Returns null when no specific hint applies — the UI hides
 * the hint row in that case rather than showing filler.
 */
function buildHint({ code, providerName, model, upstreamProvider, status }) {
    // OpenRouter `:free` models are a frequent footgun — the chained provider
    // hits its own quota and OpenRouter surfaces a vague "Provider returned
    // error". Detect this specifically so users stop chasing ghosts.
    if (providerName === 'OpenRouter' && typeof model === 'string' && model.endsWith(':free')) {
        return 'Free OpenRouter models route through third-party providers with strict, shared rate limits and frequent outages. For reliable testing, switch to a paid model (any non-`:free` variant).';
    }

    switch (code) {
        case AI_ERROR_CODE.AUTH:
            return 'Your API key was rejected. Verify it in the provider dashboard, regenerate if needed, and re-save it here.';
        case AI_ERROR_CODE.QUOTA:
            return 'You hit a billing or usage quota on the provider. Check your account limits or top up credits, then retry.';
        case AI_ERROR_CODE.RATE_LIMITED:
            return 'Too many requests in a short window. Wait a few seconds and try again — the cooldown timer below also helps.';
        case AI_ERROR_CODE.NOT_FOUND:
            return 'The model name was not recognised by the provider. Check the spelling and that the model is enabled on your account.';
        case AI_ERROR_CODE.OVERLOAD:
            if (upstreamProvider) {
                return `${upstreamProvider} (routed via ${providerName || 'the provider'}) is reporting overload. Retry in a moment, or switch to a different model.`;
            }
            return 'The provider is temporarily overloaded. Retry in a moment, or switch to a different model.';
        case AI_ERROR_CODE.TIMEOUT:
            return 'The provider took too long to respond. This is usually transient — retry, or switch to a faster model.';
        case AI_ERROR_CODE.NETWORK:
            return 'Could not reach the provider. Check your internet connection and any custom endpoint URL configured for this provider.';
        case AI_ERROR_CODE.INVALID_RESPONSE:
            return 'The provider responded but its output was malformed. This often means the model is too small to follow the protocol — try a larger model.';
        case AI_ERROR_CODE.UNKNOWN:
            if (upstreamProvider) {
                return `The error came from ${upstreamProvider} (routed via ${providerName || 'the provider'}). The upstream did not return a specific code — retry, or switch to a different model.`;
            }
            if (status === 500) {
                return 'The provider returned a generic 500. This is usually transient on their side — retry, or switch to a different model.';
            }
            return null;
        default:
            return null;
    }
}

/**
 * Format an AI provider error into a UI-friendly payload.
 *
 * @param {unknown} err — anything thrown by `provider.generate()` / `provider.embed()`
 * @param {object}  ctx
 * @param {string}  [ctx.providerName] — friendly provider label (e.g. "OpenRouter")
 * @param {string}  [ctx.model]        — model id (e.g. "qwen/qwen3-coder:free")
 * @param {string}  [ctx.kind]         — "completion" | "embedding"
 * @returns {{
 *   ok: false,
 *   code: string,
 *   error: string,
 *   title: string,
 *   message: string,
 *   hint: string|null,
 *   httpStatus: number|null,
 *   providerName: string|null,
 *   model: string|null,
 *   kind: string|null,
 *   upstreamProvider: string|null,
 *   upstreamRaw: string|null,
 *   errorType: string|null,
 * }}
 */
export function formatAIErrorForUser(err, { providerName = null, model = null, kind = null } = {}) {
    const code = err?.code || AI_ERROR_CODE.UNKNOWN;
    const status = err?.status ?? err?.cause?.status ?? null;
    const rawMessage = redactSecrets(err?.message || 'Test call failed').slice(0, 200) || 'Test call failed';

    const details = (err?.details && typeof err.details === 'object') ? err.details : {};
    const upstreamProvider = typeof details.upstreamProvider === 'string' ? details.upstreamProvider : null;
    const upstreamRaw = typeof details.upstreamRaw === 'string'
        ? redactSecrets(details.upstreamRaw).slice(0, 500)
        : null;
    const errorType = typeof details.errorType === 'string' ? details.errorType : null;

    const title = TITLES[code] || TITLES[AI_ERROR_CODE.UNKNOWN];
    const hint = buildHint({ code, providerName, model, upstreamProvider, status });

    return {
        ok: false,
        code,
        // `error` is preserved as the headline string for back-compat with the
        // legacy single-line TestButton render path.
        error: rawMessage,
        title,
        message: rawMessage,
        hint,
        httpStatus: typeof status === 'number' ? status : null,
        providerName,
        model,
        kind,
        upstreamProvider,
        upstreamRaw,
        errorType,
    };
}
