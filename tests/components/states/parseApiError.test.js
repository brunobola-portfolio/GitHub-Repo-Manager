/*
 * parseApiError turns a failed fetch Response into the FeatureState
 * vocabulary. Two regressions it guards: a 429 whose response object has no
 * Headers instance threw "Cannot read properties of undefined (reading
 * 'get')" as an unhandled rejection; and a machine slug in `error` was
 * rendered to the user as the hint.
 */
import { describe, it, expect } from 'vitest'
import { parseApiError } from '@/components/states/parseApiError'

function response(status, body, headers) {
    return {
        status,
        ok: false,
        headers,
        clone() { return this },
        async json() { if (body === undefined) throw new Error('no body'); return body },
    }
}

describe('parseFromResponse', () => {
    it('survives a 429 whose response carries no Headers instance', async () => {
        const out = await parseApiError(response(429, { error: 'Too many requests, slow down' }, undefined))
        expect(out).toMatchObject({ kind: 'rate-limited', retryAfterSec: null })
        expect(out.message).toBe('Too many requests, slow down')
    })

    it('reads Retry-After when the headers are real', async () => {
        const headers = new Headers({ 'Retry-After': '42' })
        const out = await parseApiError(response(429, {}, headers))
        expect(out.retryAfterSec).toBe(42)
    })

    it('never shows a machine slug as the message', async () => {
        const out = await parseApiError(response(403, { error: 'lid_required' }, new Headers()))
        expect(out.kind).toBe('forbidden')
        expect(out.message).toBe('Access denied')
        const generic = await parseApiError(response(500, { error: 'AI_NOT_CONFIGURED', code: 'AI_NOT_CONFIGURED' }, new Headers()))
        expect(generic.message).toBe('Request failed (500)')
    })

    it('recognises the upgrade envelope by code as well as by the legacy error slug', async () => {
        const byCode = await parseApiError(response(403, { error: 'Scheduling needs the Pro plan.', code: 'upgrade_required', requiredTier: 'pro' }, new Headers()))
        expect(byCode).toMatchObject({ kind: 'upgrade-required', tier: 'pro', message: 'Scheduling needs the Pro plan.' })
        const legacy = await parseApiError(response(403, { error: 'upgrade_required', requiredTier: 'enterprise' }, new Headers()))
        expect(legacy).toMatchObject({ kind: 'upgrade-required', tier: 'enterprise' })
    })
})
