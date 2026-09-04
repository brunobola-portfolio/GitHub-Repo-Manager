/*
 * Precompress build gate — verifies scripts/precompress-assets.mjs actually
 * produces .br/.gz siblings for a real production build, and that the .br
 * sibling is meaningfully smaller than the raw chunk (catching a regression
 * where the script runs but silently no-ops, e.g. a broken glob or an
 * extension filter that stops matching).
 *
 * Slow: runs `vite build`. Gated by RUN_BUILD_TESTS=1, same as
 * tests/build/bundle-budget.test.js and tests/build/build-honesty.test.js.
 * Builds into its own out dir (not `dist/`, not `dist-budget-check/`) so it
 * can run in parallel with the other build gates without one clobbering
 * another's artifacts mid-build (see the comment in bundle-budget.test.js
 * about the exact same race).
 */

import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'

import { precompressAssets } from '../../scripts/precompress-assets.mjs'

const RUN = process.env.RUN_BUILD_TESTS === '1'

const OUT_DIR = 'dist-precompress-check'
const ASSETS = join(OUT_DIR, 'assets')

function findEntryChunk() {
    return readdirSync(ASSETS)
        .filter((f) => f.startsWith('index-') && f.endsWith('.js'))
        .map((f) => join(ASSETS, f))
}

describe.skipIf(!RUN)('precompress-assets postbuild', () => {
    beforeAll(() => {
        // Same NODE_ENV pin as bundle-budget.test.js: vitest sets NODE_ENV=test,
        // which execSync inherits, and `--mode production` alone still emits a
        // React DEVELOPMENT build unless NODE_ENV is overridden explicitly.
        execSync(`npx vite build --mode production --outDir ${OUT_DIR} --emptyOutDir`, {
            stdio: 'inherit',
            env: { ...process.env, VITE_MOCK_MODE: '', NODE_ENV: 'production' },
        })
    }, 180_000)

    it('build assets exist', () => {
        expect(existsSync(ASSETS)).toBe(true)
    })

    it('running precompressAssets() produces .br and .gz siblings for the entry chunk', () => {
        const summary = precompressAssets(ASSETS)
        expect(summary.files).toBeGreaterThan(0)

        const [entry] = findEntryChunk()
        expect(entry, 'expected exactly one index-*.js entry chunk').toBeTruthy()
        expect(existsSync(`${entry}.br`)).toBe(true)
        expect(existsSync(`${entry}.gz`)).toBe(true)
    })

    it('the .br sibling is smaller than the raw entry chunk', () => {
        const [entry] = findEntryChunk()
        const rawSize = statSync(entry).size
        const brSize = statSync(`${entry}.br`).size

        expect(brSize).toBeLessThan(rawSize)
        // A real JS bundle compresses far below "smaller" — guard against a
        // no-op that happens to pass the strict-less-than check (e.g. writing
        // the input back out unchanged plus one byte of framing).
        expect(brSize).toBeLessThan(rawSize * 0.9)
    })

    it('is idempotent — running it twice yields byte-identical output', () => {
        precompressAssets(ASSETS)
        const [entry] = findEntryChunk()
        const first = readFileSync(`${entry}.br`)

        precompressAssets(ASSETS)
        const second = readFileSync(`${entry}.br`)

        expect(Buffer.compare(first, second)).toBe(0)
        // Brotli quality 11 over the full ~200-chunk build, twice, in one test.
    }, 60_000)
})
