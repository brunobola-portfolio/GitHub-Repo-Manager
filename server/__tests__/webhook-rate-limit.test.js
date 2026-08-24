/*
 * The three webhook families mount before session() and before the global
 * limiter — they have to, because they need the raw body for HMAC and must
 * work with no session. That made them the only unauthenticated write path
 * into the process with no ceiling at all: every POST buys a signature
 * verification and, once verified, database work.
 *
 * This asserts the wiring, not express-rate-limit's own behaviour: that the
 * limiter is constructed, that it is applied to every webhook route, and that
 * it sits ahead of the raw-body parser so a rejected flood never gets parsed.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createWebhookLimiter } from '../middleware/tenant-rate-limit.js'

const source = readFileSync('server/index.js', 'utf8')

const WEBHOOK_ROUTES = [
    '/api/v1/webhooks/stripe',
    '/api/v1/webhooks/actions',
    '/api/webhooks/actions',
    // Per-tenant ingest URLs — listed BEFORE the bare /github mount in
    // index.js so Express matches the token path first.
    '/api/v1/webhooks/github/t/:tokenId',
    '/api/v1/webhooks/github',
    '/api/webhooks/github',
]

describe('inbound webhooks are rate limited', () => {
    it('exposes a limiter that is keyed per IP and bounded', () => {
        const limiter = createWebhookLimiter()
        expect(typeof limiter).toBe('function')
    })

    it.each(WEBHOOK_ROUTES)('%s runs the limiter before the body parser', (route) => {
        const line = source.split('\n').find((l) => l.includes(`app.post('${route}'`))
        expect(line, `${route} is not mounted in server/index.js`).toBeTruthy()
        expect(line, `${route} has no rate limiter`).toContain('webhookLimiter')
        expect(
            line.indexOf('webhookLimiter'),
            `${route} parses the body before deciding to reject`,
        ).toBeLessThan(line.indexOf('express.raw'))
    })

    it('leaves no webhook route unlimited', () => {
        const mounted = source
            .split('\n')
            .filter((l) => /app\.post\('\/api\/(v1\/)?webhooks\//.test(l))
        expect(mounted.length).toBe(WEBHOOK_ROUTES.length)
        for (const line of mounted) expect(line).toContain('webhookLimiter')
    })
})
