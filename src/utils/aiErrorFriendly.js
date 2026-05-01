// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Translate a server error response into a UI-friendly { headline, detail }.
 *
 * The server (post commit b9e093a) classifies AIError codes via
 * `mapAIErrorToResponse` so the response carries machine codes
 * (`ai_quota_exceeded`, `ai_rate_limited`, …). Legacy responses that pre-date
 * the mapper may still leak raw provider strings — we fall back to keyword
 * detection so we never paste the full Google RPC dump into the UI.
 *
 * @param {{ status: number, body: { error?: string, code?: string, retryAfterSec?: number } }} input
 * @returns {{ headline: string, detail: string }}
 */
export function friendlyAiError({ status, body }) {
	const code = body?.code
	const raw = typeof body?.error === 'string' ? body.error : ''

	if (code === 'ai_quota_exceeded' || /quota/i.test(raw)) {
		return {
			headline: 'AI provider quota exceeded',
			detail: 'Your free tier or plan has hit its limit. Check provider billing or switch to a key with remaining quota.',
		}
	}

	if (code === 'ai_rate_limited' || status === 429 || /rate.?limit/i.test(raw)) {
		const retry = Number(body?.retryAfterSec) > 0
			? ` Retry in ${Math.ceil(body.retryAfterSec)}s.`
			: ' Try again shortly.'
		return {
			headline: 'AI provider is rate-limited',
			detail: `Too many requests in a short window.${retry}`,
		}
	}

	if (code === 'ai_overload' || status === 503) {
		return {
			headline: 'AI provider is overloaded',
			detail: 'The model is briefly unavailable. Try again shortly.',
		}
	}

	if (code === 'ai_timeout' || status === 504) {
		return {
			headline: 'AI provider timed out',
			detail: 'The request did not complete in time.',
		}
	}

	if (code === 'ai_auth' || status === 401) {
		return {
			headline: 'AI provider rejected the key',
			detail: 'Update or replace the provider key in Settings.',
		}
	}

	if (code === 'ai_network' || status === 502) {
		return {
			headline: 'Could not reach the AI provider',
			detail: 'A network or upstream issue blocked the request.',
		}
	}

	// Fallback: short headline, hide raw provider noise (only show short raw text).
	return {
		headline: 'AI summary failed',
		detail: raw && raw.length < 200 ? raw : `The AI provider returned an error (status ${status}).`,
	}
}
