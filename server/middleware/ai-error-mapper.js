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
		return res.status(401).json({
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

	// INVALID_RESPONSE / NOT_FOUND / UNKNOWN fall through to caller's generic
	// handler. Returning null preserves the previous behaviour where
	// work-board-actions used `safeError(e, fallback)` for those codes.
	return null
}
