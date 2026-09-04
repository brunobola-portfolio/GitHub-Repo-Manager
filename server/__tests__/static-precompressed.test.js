// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import express from 'express'
import request from 'supertest'

import { servePrecompressedAssets } from '../lib/static-precompressed.js'

let assetsDir
const JS_BODY = 'globalThis.__fixture = "hello world, this needs to be long enough to matter for a real test fixture"'
const CSS_BODY = 'body{color:red}/* padding so the fixture is non-trivially sized for a real test */'

beforeAll(() => {
    const root = mkdtempSync(path.join(tmpdir(), 'precompressed-assets-'))
    assetsDir = path.join(root, 'assets')
    mkdirSync(assetsDir, { recursive: true })
    mkdirSync(path.join(assetsDir, 'nested'), { recursive: true })

    writeFileSync(path.join(assetsDir, 'app.js'), JS_BODY)
    writeFileSync(path.join(assetsDir, 'app.js.br'), brotliCompressSync(Buffer.from(JS_BODY)))
    writeFileSync(path.join(assetsDir, 'app.js.gz'), gzipSync(Buffer.from(JS_BODY)))

    // .css has only a .gz sibling — exercises the gzip-only fallback path.
    writeFileSync(path.join(assetsDir, 'style.css'), CSS_BODY)
    writeFileSync(path.join(assetsDir, 'style.css.gz'), gzipSync(Buffer.from(CSS_BODY)))

    // No siblings at all — exercises the "falls through" path.
    writeFileSync(path.join(assetsDir, 'lonely.svg'), '<svg></svg>')

    writeFileSync(path.join(assetsDir, 'nested', 'chunk.js'), JS_BODY)
    writeFileSync(path.join(assetsDir, 'nested', 'chunk.js.br'), brotliCompressSync(Buffer.from(JS_BODY)))
})

afterAll(() => {
    rmSync(path.dirname(assetsDir), { recursive: true, force: true })
})

function buildApp() {
    const app = express()
    app.use('/assets', servePrecompressedAssets(assetsDir))
    // Fallback that stands in for express.static: proves the middleware calls
    // next() correctly on every kind of miss instead of hanging or 404ing.
    app.use('/assets', (req, res) => {
        res.status(200).json({ fallthrough: true, path: req.path })
    })
    return app
}

describe('servePrecompressedAssets', () => {
    it('prefers brotli over gzip when the client accepts both', async () => {
        const res = await request(buildApp())
            .get('/assets/app.js')
            .set('Accept-Encoding', 'gzip, deflate, br')

        expect(res.headers['content-encoding']).toBe('br')
        expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8')
        expect(res.headers['vary']).toBe('Accept-Encoding')
        expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
        // superagent transparently decompresses based on Content-Encoding, so
        // a correctly-served .br response reads back as the original source —
        // proof the bytes on the wire really were the brotli fixture, not the
        // raw file re-served with a lying header.
        expect(res.text).toBe(JS_BODY)
    })

    it('falls back to gzip when the client sends no br', async () => {
        const res = await request(buildApp())
            .get('/assets/app.js')
            .set('Accept-Encoding', 'gzip')

        expect(res.headers['content-encoding']).toBe('gzip')
        expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8')
    })

    it('serves gzip for a file with no .br sibling', async () => {
        const res = await request(buildApp())
            .get('/assets/style.css')
            .set('Accept-Encoding', 'gzip, br')

        expect(res.headers['content-encoding']).toBe('gzip')
        expect(res.headers['content-type']).toBe('text/css; charset=utf-8')
    })

    it('falls through to the next handler when neither sibling exists', async () => {
        const res = await request(buildApp())
            .get('/assets/lonely.svg')
            .set('Accept-Encoding', 'gzip, br')

        expect(res.status).toBe(200)
        expect(res.body).toEqual({ fallthrough: true, path: '/lonely.svg' })
        expect(res.headers['content-encoding']).toBeUndefined()
    })

    it('falls through when the client accepts neither br nor gzip', async () => {
        // superagent sets 'Accept-Encoding: gzip, deflate' by default, so an
        // explicit 'identity' is the real way to exercise "no usable
        // encoding" rather than "header absent".
        const res = await request(buildApp())
            .get('/assets/app.js')
            .set('Accept-Encoding', 'identity')

        expect(res.status).toBe(200)
        expect(res.body).toEqual({ fallthrough: true, path: '/app.js' })
        expect(res.headers['content-encoding']).toBeUndefined()
    })

    it('serves a nested asset under a subdirectory', async () => {
        const res = await request(buildApp())
            .get('/assets/nested/chunk.js')
            .set('Accept-Encoding', 'br')

        expect(res.headers['content-encoding']).toBe('br')
    })

    it('never escapes assetsDir on a path-traversal attempt', async () => {
        // path-to-regexp/Express normalizes plain '../' segments before this
        // middleware ever sees req.path, so the traversal has to be encoded to
        // reach our decodeURIComponent + resolve() check at all.
        const res = await request(buildApp())
            .get('/assets/..%2f..%2f..%2fpackage.json')
            .set('Accept-Encoding', 'br')

        // Either Express's own normalization already rejected it (404) or our
        // resolve()-outside-root check fell through to the stub handler — both
        // mean package.json contents were never returned as an asset response.
        expect(res.headers['content-encoding']).toBeUndefined()
        expect(res.text).not.toMatch(/"name":\s*"github-repo-manager"/)
    })

    it('handles HEAD requests without a body', async () => {
        const res = await request(buildApp())
            .head('/assets/app.js')
            .set('Accept-Encoding', 'br')

        expect(res.headers['content-encoding']).toBe('br')
        expect(res.headers['content-length']).toBe(
            String(brotliCompressSync(Buffer.from(JS_BODY)).length),
        )
    })

    it('ignores unrecognized extensions and falls through', async () => {
        const res = await request(buildApp())
            .get('/assets/app.unknown')
            .set('Accept-Encoding', 'br')

        expect(res.status).toBe(200)
        expect(res.body).toEqual({ fallthrough: true, path: '/app.unknown' })
    })
})
