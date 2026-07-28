// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AIError → HTTP response mapper.
 *
 * Originally inline in `server/routes/work-board-actions.js` (commit b9e093a
 * after the Google Gemini quota dump was leaking into the UI). Extracted here
 * so every route that calls an AI provider can reuse the same friendly
 * mapping without copy-pasting the switch.
 *
 * Returns the Express response object so callers can `return mapAIErrorToResponse(res, e)`
 * inside their catch blocks.
 *
 * Returns `null` if the error is NOT an AIError — caller falls through to its
 * own generic 500 handler.
 */
import { AI_ERROR_CODE } from '../lib/ai-provider.js'

export function mapAIErrorToResponse(res, e) {
	if (e?.name !== 'AIError') return null

	const retryAfterSec = typeof e.retryAfterMs === 'number'
		? Math.ceil(e.retryAfterMs / 1000)
		: null

	if (e.code === AI_ERROR_CODE.RATE_LIMITED) {
		const msg = retryAfterSec
			? `AI provider is rate-limited. Try again in ${retryAfterSec}s.`
			: 'AI provider is rate-limited. Try again shortly.'
		return res.status(429).json({
			error: msg,
			code: 'ai_rate_limited',
			...(retryAfterSec !== null && { retryAfterSec }),
		})
	}

	if (e.code === AI_ERROR_CODE.QUOTA) {
		return res.status(429).json({
			error: 'AI provider quota exceeded for the current plan. Check your provider billing or switch keys.',
			code: 'ai_quota_exceeded',
		})
	}

	if (e.code === AI_ERROR_CODE.OVERLOAD) {
		return res.status(503).json({
			error: 'AI provider is overloaded. Try again shortly.',
			code: 'ai_overload',
		})
	}

	if (e.code === AI_ERROR_CODE.TIMEOUT) {
		return res.status(504).json({
			error: 'AI provider timed out.',
			code: 'ai_timeout',
		})
	}

	if (e.code === AI_ERROR_CODE.AUTH) {
		// 422, NOT 401. The client maps 401 to notifySessionExpired(), which
		// hard-redirects to /?error=session_expired and latches a flag that
		// short-circuits every later request — so answering 401 here tells the
		// user their session died when in fact their provider key is wrong, and
		// signs them out of the app to say it. routes/ai/shared.js has always
		// used 422 for this exact reason; this mapper was the copy that didn't,
		// which is what dev-toolkit's routes (review-summary included) hit.
		return res.status(422).json({
			error: 'AI provider rejected the configured key. Update it in Settings.',
			code: 'ai_auth',
		})
	}

	if (e.code === AI_ERROR_CODE.NETWORK) {
		return res.status(502).json({
			error: 'Could not reach the AI provider.',
			code: 'ai_network',
		})
	}

	if (e.code === AI_ERROR_CODE.NOT_FOUND) {
		return res.status(404).json({
			error: 'AI model or resource not found. Check the model name in Settings → AI.',
			code: 'ai_model_not_found',
		})
	}

	if (e.code === AI_ERROR_CODE.INVALID_RESPONSE) {
		return res.status(502).json({
			error: 'AI provider returned an invalid response.',
			code: 'ai_invalid_response',
		})
	}

	if (e.code === AI_ERROR_CODE.CANCELED) {
		// Client aborted (page navigated away, cancel button). 499 is the
		// nginx-style "client closed request" status — pick 499 so caches
		// and proxies don't treat it as a real server failure.
		return res.status(499).json({
			error: 'Request was cancelled before the AI provider responded.',
			code: 'ai_canceled',
		})
	}

	// UNKNOWN — still an AIError, but the provider gave us no usable code.
	// Emit a coded 502 so the client can map it to a friendly retry CTA
	// instead of falling into the generic "Something went wrong" bucket.
	if (e.code === AI_ERROR_CODE.UNKNOWN) {
		return res.status(502).json({
			error: 'AI provider returned an unexpected error.',
			code: 'ai_provider_error',
		})
	}

	// Truly unknown shape (no AI_ERROR_CODE match) — let the caller's
	// generic 500 path handle it with its own `code: 'ai_summary_failed'`
	// or equivalent, so the client can still categorise the error.
	return null
}
