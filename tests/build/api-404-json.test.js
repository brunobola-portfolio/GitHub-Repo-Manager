/*
 * Unmatched /api/* must answer JSON, in every environment.
 *
 * Express's default handler answers an HTML error page. Every client in
 * src/api/ calls res.json() on the error path, so a typo'd or removed endpoint
 * surfaced to the user as a JSON parse exception rather than a message. The
 * only JSON 404 for this prefix used to live inside the production SPA
 * fallback, which is registered ONLY when nodeEnv === 'production' AND dist/
 * exists — so dev, test, and every API-only container fell through to HTML.
 *
 * This is a source-placement gate rather than a supertest run because
 * server/index.js does not export its app: it boots a listener at import time,
 * so there is nothing to hand supertest. What can regress here is the
 * handler's ORDER (behind the SPA fallback, or after the error handlers, both
 * of which make it dead code) and its existence, and both are visible in the
 * source.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const SRC = readFileSync('server/index.js', 'utf8')

// The registration itself: `app.use('/api', <handler>)` answering 404 JSON.
const NOT_FOUND_HANDLER = /app\.use\(\s*'\/api'\s*,\s*\([^)]*\)\s*=>\s*\{[^}]*res\s*\.status\(404\)\s*\.json\(\s*\{[^}]*code:\s*'NOT_FOUND'/

describe('unmatched /api/* answers JSON', () => {
    it('registers an unconditional JSON 404 for the /api prefix', () => {
        expect(NOT_FOUND_HANDLER.test(SRC)).toBe(true)
    })

    it('registers it after the route mounts and before the error handlers', () => {
        const at = SRC.search(NOT_FOUND_HANDLER)
        const lastMount = SRC.lastIndexOf("app.use('/api', v1Routes)")
        const sentry = SRC.indexOf('getSentryErrorHandler()')

        expect(lastMount, 'the v1 back-compat mount moved or was renamed').toBeGreaterThan(-1)
        expect(sentry, 'the Sentry error handler moved or was renamed').toBeGreaterThan(-1)
        // Before the mounts it would swallow every API request; after the error
        // handlers it would never run.
        expect(at).toBeGreaterThan(lastMount)
        expect(at).toBeLessThan(sentry)
    })

    it('is not nested inside the production-only static block', () => {
        const at = SRC.search(NOT_FOUND_HANDLER)
        const prodBlock = SRC.indexOf("if (config.nodeEnv === 'production') {\n    const distPath")
        expect(prodBlock, 'the production static block moved or was renamed').toBeGreaterThan(-1)
        expect(at).toBeLessThan(prodBlock)
    })
})

describe('the global error handler is machine-readable', () => {
    it('emits a code and the request id alongside the message', () => {
        const handler = SRC.slice(SRC.indexOf('Global Error Handler'))
        expect(handler).toMatch(/code:\s*err\.code\s*\|\|\s*ERROR_CODE\.SERVER_ERROR/)
        expect(handler).toMatch(/requestId:\s*req\.id/)
    })
})
