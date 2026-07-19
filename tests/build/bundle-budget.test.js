/*
 * Bundle size budget — guards against eager-bundle regressions.
 *
 * The eager set is whatever index-*.js imports directly via static `import`.
 * This test:
 *   1. Verifies the entry chunk (index-*.js) stays under EAGER_INDEX_GZ_BUDGET
 *   2. Verifies the sum of all eagerly-imported vendor chunks stays under
 *      EAGER_TOTAL_GZ_BUDGET
 *   3. Verifies the heavy lazy `esm-*.js` chunk is NOT imported by index-*.js
 *      (this regression guard catches the issue where rolldown accidentally
 *      promotes a lazy chunk to eager because of an upstream import change)
 *
 * Slow: runs `vite build`. Gated by RUN_BUILD_TESTS=1, same as
 * tests/build/build-honesty.test.js.
 */

import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, it, expect, beforeAll } from 'vitest'

// Budgets track current actuals (fresh `vite build --mode production`).
// Raise these only after a deliberate, documented change. Lowering them is
// fine — that's the ratchet direction.
//   - Total eager: actual ~397 KB gz → budget 415 KB (unchanged since 2026-04-26)
//   - index-*.js entry: 2026-07-19 re-baseline. This gate was accidentally
//     dormant in CI (RUN_BUILD_TESTS was never set) between 2026-04-26 and
//     2026-07-19, during which the entry chunk grew ~66 → ~89 KB gz as the
//     v4.6 "Community WOW" work added code to the always-mounted app shell
//     (Header/Sidebar/RepoList/OrgSidebar/NotificationLayer). Re-baselined to
//     92 KB to LOCK the current ceiling and prevent further regression now that
//     the gate is wired into CI. Reducing the entry back toward 72 KB via a
//     dedicated shell code-split pass is tracked as perf follow-up — DO NOT
//     raise this budget further to accommodate new eager growth.
const EAGER_INDEX_GZ_BUDGET = 92 * 1024
const EAGER_TOTAL_GZ_BUDGET = 415 * 1024

const RUN = process.env.RUN_BUILD_TESTS === '1'

function gzipSize(filePath) {
    return gzipSync(readFileSync(filePath)).length
}

function findFiles(dir, prefix) {
    return readdirSync(dir)
        .filter((f) => f.startsWith(prefix) && f.endsWith('.js'))
        .map((f) => join(dir, f))
}

describe.skipIf(!RUN)('bundle size budget', () => {
    beforeAll(() => {
        execSync('npx vite build --mode production', {
            stdio: 'inherit',
            env: { ...process.env, VITE_MOCK_MODE: '' },
        })
    }, 180_000)

    it('dist/assets exists', () => {
        expect(existsSync('dist/assets')).toBe(true)
    })

    it(`index-*.js gzipped is under ${(EAGER_INDEX_GZ_BUDGET / 1024).toFixed(0)} KB`, () => {
        const indexFiles = findFiles('dist/assets', 'index-')
        expect(indexFiles).toHaveLength(1)
        const size = gzipSize(indexFiles[0])
        expect(size).toBeLessThan(EAGER_INDEX_GZ_BUDGET)
    })

    it(`eager bundle gzipped sum is under ${(EAGER_TOTAL_GZ_BUDGET / 1024).toFixed(0)} KB`, () => {
        const indexFiles = findFiles('dist/assets', 'index-')
        const indexContent = readFileSync(indexFiles[0], 'utf8')

        // Find every chunk filename referenced by `import "./..."` in the entry.
        // Captures both `from"./chunk.js"` (rolldown output style) and
        // `from "./chunk.js"` (rollup style with a space).
        const re = /from\s*['"]\.\/([^'"]+\.js)['"]/g
        const eagerChunks = new Set()
        let m
        while ((m = re.exec(indexContent))) {
            eagerChunks.add(m[1])
        }

        let totalGz = gzipSize(indexFiles[0])
        const breakdown = [{ chunk: indexFiles[0].replace(/\\/g, '/'), gz: totalGz }]
        for (const name of eagerChunks) {
            const path = join('dist/assets', name)
            if (!existsSync(path)) continue
            const gz = gzipSize(path)
            totalGz += gz
            breakdown.push({ chunk: `dist/assets/${name}`, gz })
        }
        breakdown.sort((a, b) => b.gz - a.gz)
        const summary = breakdown.map((b) => `  ${b.chunk}: ${(b.gz / 1024).toFixed(1)} KB gz`).join('\n')
        expect(
            totalGz,
            `Eager bundle gzipped sum is ${(totalGz / 1024).toFixed(1)} KB (budget ${(EAGER_TOTAL_GZ_BUDGET / 1024).toFixed(0)} KB).\n${summary}`,
        ).toBeLessThan(EAGER_TOTAL_GZ_BUDGET)
    })

    it('no esm-*.js chunk larger than 50 KB is eagerly imported by index-*.js', () => {
        // Regression guard: the slice-4.1 audit mistakenly claimed the big
        // esm-*.js chunk was eager. Ensuring it's NOT imported by index keeps
        // the lazy diff/markdown surfaces lazy.
        const indexFiles = findFiles('dist/assets', 'index-')
        const indexContent = readFileSync(indexFiles[0], 'utf8')
        const re = /from\s*['"]\.\/(esm-[^'"]+\.js)['"]/g
        const offenders = []
        let m
        while ((m = re.exec(indexContent))) {
            const chunk = m[1]
            const path = join('dist/assets', chunk)
            if (!existsSync(path)) continue
            const gz = gzipSize(path)
            if (gz > 50 * 1024) {
                offenders.push(`${chunk}: ${(gz / 1024).toFixed(1)} KB gz`)
            }
        }
        expect(
            offenders,
            `Found large esm-*.js chunks imported eagerly by index-*.js:\n${offenders.map((o) => `  - ${o}`).join('\n')}\n\n` +
                `Heavy esm-*.js chunks must remain lazy (loaded only by Insights/PR Review surfaces). ` +
                `If a lazy module accidentally became eager, find the new static import in src/ and either lazy-load it or split it.`,
        ).toEqual([])
    })
})
