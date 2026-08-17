// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/*
 * The Contents routes build a GitHub API path out of a user-supplied string and
 * call it with the caller's OAuth token — a token whose scopes include
 * `delete_repo` and `admin:org`, and which the user can never read.
 *
 * The original guard compared each segment to the literal `..`. Express decodes
 * the query string ONCE, so `%252e%252e` arrived as the text `%2e%2e`, which is
 * not `..` and passed. The URL parser inside fetch then decoded it a second time
 * and collapsed the result:
 *
 *   /repos/o/r/contents/%2e%2e/%2e%2e/%2e%2e/user/repos  ->  /repos/user/repos
 *
 * PUT and DELETE reached the same builder, so the shape was an arbitrary
 * authenticated write against api.github.com.
 *
 * This drives the real functions out of the route module rather than restating
 * them, so a future edit to the guard is what the test sees.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const SRC = readFileSync('server/routes/repos/crud.js', 'utf8')

function extract(name) {
    const start = SRC.indexOf(`function ${name}`)
    expect(start, `${name} vanished from crud.js`).toBeGreaterThan(-1)
    // Balance braces from the first one after the signature.
    let depth = 0
    let i = SRC.indexOf('{', start)
    const open = i
    for (; i < SRC.length; i += 1) {
        if (SRC[i] === '{') depth += 1
        else if (SRC[i] === '}') {
            depth -= 1
            if (depth === 0) break
        }
    }
     
    return eval(`(${SRC.slice(start, open)}${SRC.slice(open, i + 1)})`)
}

const validatePath = extract('validatePath')
const encodePath = extract('encodePath')

describe('Contents path validation', () => {
    it('accepts the paths a real repository has', () => {
        for (const ok of ['', 'README.md', 'docs/guide.md', 'a/b/c/d.txt', 'src/.eslintrc.json', 'my file.md']) {
            expect(validatePath(ok), ok).toBe(true)
        }
    })

    it.each([
        ['..', 'bare traversal'],
        ['a/../b', 'traversal mid-path'],
        ['/etc/passwd', 'absolute'],
        ['.', 'current directory'],
    ])('rejects %s (%s)', (bad) => {
        expect(validatePath(bad)).toBe(false)
    })

    it.each([
        ['%2e%2e/x', 'single-encoded — what Express hands us for %252e%252e'],
        ['%252e%252e/x', 'double-encoded'],
        ['%2e%2e/%2e%2e/%2e%2e/user/repos', 'the full exploit path'],
        ['%2f..%2f', 'encoded separator'],
        ['%25252e%25252e', 'triple-encoded'],
    ])('rejects %s (%s)', (bad) => {
        expect(validatePath(bad)).toBe(false)
    })

    it('rejects malformed encoding rather than guessing at it', () => {
        expect(validatePath('%zz')).toBe(false)
        expect(validatePath('%')).toBe(false)
    })

    it('the encoder cannot produce a path that escapes the endpoint', () => {
        // The second half of the defence: even a segment that slipped through
        // reaches GitHub as a literal name, not a path instruction.
        const escaped = encodePath('%2e%2e/%2e%2e/user/repos')
        const url = new URL(`https://api.github.com/repos/o/r/contents/${escaped}`)
        expect(url.pathname.startsWith('/repos/o/r/contents/')).toBe(true)
    })

    it('the encoder leaves a legitimate path usable', () => {
        const url = new URL(`https://api.github.com/repos/o/r/contents/${encodePath('docs/my file.md')}`)
        expect(url.pathname).toBe('/repos/o/r/contents/docs/my%20file.md')
    })

    it('every Contents sink runs the path through the encoder', () => {
        // GET, PUT and DELETE all build the same URL shape. One left raw is the
        // whole bug back again.
        const raw = SRC.match(/contents\/\$\{path\}/g) || []
        expect(raw, 'a Contents URL still interpolates the raw path').toEqual([])
        expect((SRC.match(/contents\/\$\{encodePath\(path\)\}/g) || []).length).toBe(3)
    })
})
