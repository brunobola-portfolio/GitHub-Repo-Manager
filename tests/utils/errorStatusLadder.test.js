/**
 * The generic "Something went wrong / Please try again / contact
 * bruno@bolalabs.pt" card with a Retry button was the default answer for over
 * half the server's error vocabulary: `formatUserError` only had status
 * heuristics for 401, 429 and 413, so 400, 403, 404, 409 and 5xx all fell
 * through to FALLBACK.
 *
 * That is how a deterministic HTTP 400 came to be presented as a transient
 * problem with a Retry that could never succeed. These tests pin the two
 * properties that matter: a non-retryable status must not offer Retry, and a
 * mapped code must beat the status heuristic.
 */
import { describe, it, expect } from 'vitest'
import { formatUserError } from '../../src/utils/errors.js'

const withStatus = (status, extra = {}) => Object.assign(new Error('x'), { status, ...extra })

describe('formatUserError — status ladder', () => {
    it.each([400, 422])('does not offer Retry for a %s that can never succeed', (status) => {
        const out = formatUserError(withStatus(status))
        expect(out.action?.type).not.toBe('retry')
        expect(out.action?.kind).not.toBe('retry')
        expect(out.title).not.toBe('Something went wrong')
    })

    it.each([403, 404, 409])('does not offer Retry for a %s', (status) => {
        const out = formatUserError(withStatus(status))
        expect(out.action?.type).not.toBe('retry')
        expect(out.title).not.toBe('Something went wrong')
    })

    it.each([500, 502, 503, 504])('still offers Retry for a %s, which genuinely may succeed', (status) => {
        const out = formatUserError(withStatus(status))
        expect(out.action?.type).toBe('retry')
    })

    it('never leaves the support email as the only guidance for a mapped status', () => {
        for (const status of [400, 403, 404, 409, 422]) {
            const out = formatUserError(withStatus(status))
            expect(out.body, `status ${status}`).not.toMatch(/bolalabs\.pt/)
        }
    })
})

describe('formatUserError — codes that used to fall through', () => {
    const cases = [
        ['validation_failed', 400],
        ['INVALID_PARAM', 400],
        ['tier_limit_exceeded', 403],
        ['INSUFFICIENT_PERMISSIONS', 403],
        ['MIGRATION_QUOTA_EXCEEDED', 403],
        ['ALREADY_PUBLISHED', 409],
        ['NOT_EDITABLE', 409],
    ]

    it.each(cases)('%s resolves to a specific message, not the generic card', (code, status) => {
        const out = formatUserError(withStatus(status, { code }))
        expect(out.title).not.toBe('Something went wrong')
        expect(out.action?.type).not.toBe('retry')
    })

    it('csrf_invalid tells the user to reload, which is the one thing that works', () => {
        // The exception to the no-retry-on-4xx rule: the CSRF middleware
        // already retried once with a fresh token before surfacing this, so a
        // page reload genuinely recovers. The action stays retry-typed; what
        // matters is that the label and copy say reload rather than "try
        // again", and that it is not the generic card.
        const out = formatUserError(withStatus(403, { code: 'csrf_invalid' }))
        expect(out.code).toBe('SESSION_REFRESHED')
        expect(out.action?.label).toBe('Reload')
        expect(out.body).toMatch(/reload/i)
    })

    it('AI_COST_CAP_REACHED reads as a budget cap, not as a rate limit', () => {
        // It is emitted as a 429, so the rate-limit heuristic claimed it and
        // told the user to "try again shortly" for a monthly spend cap.
        const out = formatUserError(withStatus(429, { code: 'AI_COST_CAP_REACHED' }))
        expect(out.body).not.toMatch(/short window|try again shortly/i)
        expect(out.action?.type).toBe('upgrade')
    })
})

describe('formatUserError — regressions guarded', () => {
    it('keeps 401 mapping to the re-auth path', () => {
        expect(formatUserError(withStatus(401)).code).toBe('UNAUTHORIZED')
    })

    it('keeps 429 mapping to the rate limit with its Retry-After', () => {
        const out = formatUserError(withStatus(429, { retryAfterSec: 12 }))
        expect(out.code).toBe('RATE_LIMITED')
        expect(out.body).toMatch(/12s/)
    })

    it('keeps 413 mapping to the payload-too-large copy', () => {
        expect(formatUserError(withStatus(413)).code).toBe('PAYLOAD_TOO_LARGE')
    })

    it('still falls back when there is no status and no code', () => {
        expect(formatUserError(new Error('boom')).title).toBe('Something went wrong')
    })

    it('lets a mapped code win over the status heuristic', () => {
        // A 403 carrying an explicit upgrade code must render the upgrade CTA,
        // not the generic permission copy the ladder would supply.
        const out = formatUserError(withStatus(403, { code: 'upgrade_required' }))
        expect(out.code).toBe('UPGRADE_REQUIRED')
    })
})
