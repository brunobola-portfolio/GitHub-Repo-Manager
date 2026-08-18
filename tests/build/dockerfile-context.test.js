// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/*
 * Every path the Dockerfile COPYs must actually survive .dockerignore.
 *
 * The two files disagreed for one release and nothing noticed. `.dockerignore`
 * has excluded `*.md` since PR #10; `COPY LICENSE NOTICE TRADEMARKS.md ./`
 * arrived much later. LICENSE and NOTICE have no extension so they passed,
 * and TRADEMARKS.md did not — the build failed with "/TRADEMARKS.md: not
 * found".
 *
 * It stayed invisible because the Docker workflow only runs on a release tag.
 * By the time it failed, the version was already tagged and published, so the
 * cheapest place to catch it is here, in the suite every PR runs.
 *
 * Deliberately a context check, not a docker build: this has to be fast and
 * has to work on a machine with no daemon.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

const DOCKERFILE = readFileSync('Dockerfile', 'utf8')
const IGNORE = readFileSync('.dockerignore', 'utf8')

/** The literal source paths a COPY brings in from the build context. */
function contextCopySources() {
    const sources = []
    for (const line of DOCKERFILE.split(/\r?\n/)) {
        const m = line.match(/^COPY\s+(.*)$/)
        if (!m) continue
        // `--from=` copies from an earlier STAGE, not from the context, so
        // .dockerignore has no say over it.
        if (m[1].includes('--from=')) continue
        const parts = m[1].trim().split(/\s+/)
        // The last argument is the destination.
        for (const src of parts.slice(0, -1)) {
            if (src.startsWith('--')) continue
            if (src === '.') continue // the whole context; per-file rules apply below
            sources.push(src)
        }
    }
    return sources
}

/**
 * Whether `path` reaches the build context. Implements the subset of
 * .dockerignore semantics this repository uses: literal names, a leading
 * directory, `*.ext` globs, `**` prefixes, and `!` negations. Last match wins,
 * which is Docker's own rule.
 */
function reachesContext(path) {
    let ignored = false
    for (const raw of IGNORE.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        const negated = line.startsWith('!')
        const pattern = negated ? line.slice(1) : line
        if (matches(pattern, path)) ignored = !negated
    }
    return !ignored
}

function matches(pattern, path) {
    const p = pattern.replace(/^\.\//, '').replace(/^\*\*\//, '')
    if (p === path) return true
    // A bare directory name excludes everything under it.
    if (!p.includes('*') && path.startsWith(`${p}/`)) return true
    if (p.includes('*')) {
        const re = new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`)
        // A glob without a slash applies to the basename at any depth.
        return re.test(path) || (!p.includes('/') && re.test(path.split('/').pop()))
    }
    return false
}

describe('the Docker build context', () => {
    const sources = contextCopySources()

    it('has COPY instructions to check', () => {
        // If the parse silently returns nothing, every assertion below passes
        // while testing nothing.
        expect(sources.length).toBeGreaterThan(0)
    })

    it.each(contextCopySources())('%s is not excluded by .dockerignore', (src) => {
        // `package*.json` and friends: check what the glob actually resolves to.
        if (src.includes('*')) {
            expect(reachesContext(src.replace('*', ''))).toBe(true)
            return
        }
        expect(reachesContext(src), `.dockerignore excludes ${src}, so the COPY fails`).toBe(true)
    })

    it.each(contextCopySources().filter((s) => !s.includes('*')))('%s exists in the repository', (src) => {
        expect(existsSync(src), `Dockerfile COPYs ${src}, which is not in the repo`).toBe(true)
    })

    it('still excludes the things it is meant to', () => {
        // Guards the negation above from being widened into "ship everything".
        for (const excluded of ['CHANGELOG.md', 'AGENTS.md', 'CLAUDE.md', 'docs/index.md', 'tests/build/dockerfile-context.test.js']) {
            expect(reachesContext(excluded), `${excluded} now reaches the image`).toBe(false)
        }
        for (const kept of ['README.md', 'LICENSE', 'NOTICE', 'TRADEMARKS.md']) {
            expect(reachesContext(kept), `${kept} no longer reaches the image`).toBe(true)
        }
    })
})
