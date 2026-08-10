/*
 * The dev server serves /brand from the repository so the Settings → About
 * link is not a 404 for the people who work on the app. That middleware reads
 * a path out of a URL and streams the file it names, which is the exact shape
 * that goes wrong: '/brand/%2e%2e/.env' decodes to a path outside brand/, and
 * connect hands the middleware the still-encoded remainder.
 *
 * Driven through the real plugin from vite.config.js — a test that re-declared
 * the guard would pass while the shipped one was wrong.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { PassThrough } from 'node:stream'

let handler

beforeAll(async () => {
    const config = (await import('../../vite.config.js')).default
    const plugin = config.plugins.flat().find((p) => p && p.name === 'copy-brand-kit')
    expect(plugin, 'the copy-brand-kit plugin vanished — re-point this gate').toBeTruthy()

    // Connect's server.middlewares.use(path, fn): capture fn, then call it the
    // way connect does — with the mount prefix already stripped from req.url.
    plugin.configureServer({
        middlewares: {
            use: (mount, fn) => {
                expect(mount).toBe('/brand')
                handler = fn
            },
        },
    })
    expect(typeof handler).toBe('function')
})

/** Drive the middleware once. Resolves to 'next' or the served response. */
function request(url) {
    return new Promise((resolve) => {
        const res = new PassThrough()
        const chunks = []
        const headers = {}
        res.setHeader = (k, v) => { headers[k.toLowerCase()] = v }
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ served: true, headers, body: Buffer.concat(chunks) }))
        handler({ url }, res, () => resolve({ served: false }))
    })
}

describe('the dev /brand middleware', () => {
    it('serves the guide at the mount root', async () => {
        const r = await request('/')
        expect(r.served).toBe(true)
        expect(r.headers['content-type']).toBe('text/html; charset=utf-8')
        expect(r.body.toString('utf8')).toContain('<title>RepoManager')
    })

    it('serves nested assets with the right type', async () => {
        const font = await request('/fonts/archivo-latin-wght-normal.woff2')
        expect(font.served).toBe(true)
        expect(font.headers['content-type']).toBe('font/woff2')
        expect(font.body.length).toBeGreaterThan(1000)

        const zip = await request('/repomanager-media-kit.zip')
        expect(zip.headers['content-type']).toBe('application/zip')
        // PK\x03\x04 — a real archive, not an HTML error page with a zip name.
        expect(zip.body.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    })

    it('ignores the query string rather than treating it as filename', async () => {
        expect((await request('/?v=2')).served).toBe(true)
        expect((await request('/#top')).served).toBe(true)
    })

    it.each([
        ['/%2e%2e/package.json', 'percent-encoded dot-dot'],
        ['/../package.json', 'literal dot-dot'],
        ['/../../package.json', 'repeated dot-dot'],
        ['/..%2f.env', 'mixed encoding'],
        ['/%2e%2e%2f%2e%2e%2fpackage.json', 'fully encoded traversal'],
    ])('refuses to escape brand/ via %s (%s)', async (url) => {
        const r = await request(url)
        expect(r.served, `${url} was served from outside brand/`).toBe(false)
    })

    it('passes unknown paths on instead of inventing a response', async () => {
        expect((await request('/does-not-exist.svg')).served).toBe(false)
        // A directory is not a file; streaming one would throw EISDIR.
        expect((await request('/fonts')).served).toBe(false)
    })
})
