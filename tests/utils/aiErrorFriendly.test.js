import { describe, it, expect } from 'vitest'
import { friendlyAiError } from '@/utils/aiErrorFriendly'

describe('friendlyAiError', () => {
	it('quota by code → quota headline', () => {
		const out = friendlyAiError({ status: 429, body: { code: 'ai_quota_exceeded', error: 'long raw' } })
		expect(out.headline).toMatch(/quota exceeded/i)
		expect(out.detail).not.toContain('long raw')
	})

	it('quota by keyword fallback (legacy server response)', () => {
		const out = friendlyAiError({ status: 500, body: { error: 'You exceeded your current quota — long Google RPC dump goes here' } })
		expect(out.headline).toMatch(/quota exceeded/i)
		// Friendly detail does not echo the long raw text
		expect(out.detail).not.toContain('Google RPC dump')
	})

	it('rate-limited shows retryAfterSec when present', () => {
		const out = friendlyAiError({ status: 429, body: { code: 'ai_rate_limited', retryAfterSec: 14 } })
		expect(out.headline).toMatch(/rate-limited/i)
		expect(out.detail).toMatch(/Retry in 14s/)
	})

	it('overload → overload headline', () => {
		const out = friendlyAiError({ status: 503, body: { code: 'ai_overload' } })
		expect(out.headline).toMatch(/overloaded/i)
	})

	it('timeout → timed out headline', () => {
		const out = friendlyAiError({ status: 504, body: { code: 'ai_timeout' } })
		expect(out.headline).toMatch(/timed out/i)
	})

	it('auth → rejected the key', () => {
		const out = friendlyAiError({ status: 401, body: { code: 'ai_auth' } })
		expect(out.headline).toMatch(/rejected the key/i)
	})

	it('network → reach the AI provider', () => {
		const out = friendlyAiError({ status: 502, body: { code: 'ai_network' } })
		expect(out.headline).toMatch(/Could not reach/i)
	})

	it('fallback shows short raw text but truncates long ones', () => {
		const short = friendlyAiError({ status: 500, body: { error: 'boom' } })
		expect(short.detail).toContain('boom')

		const long = friendlyAiError({ status: 500, body: { error: 'x'.repeat(300) } })
		expect(long.detail).not.toContain('x'.repeat(300))
		expect(long.detail).toMatch(/status 500/)
	})
})
