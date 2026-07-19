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
//   - index-*.js entry: 2026-07-19 re-baselined to 92 KB (see git history) to
//     lock the ceiling after this gate was found accidentally dormant in CI.
//     2026-07-19 shell code-split follow-up landed and dropped the entry to
//     ~78.8 KB gz actual:
//       1. vite.config.js's manualChunks no longer force-groups recharts into
//          its own 'vendor-charts' chunk — that grouping made rolldown hoist
//          the chunk into a STATIC import of the entry even though recharts
//          is only reachable via dynamic import() (ActivityChart/LanguageChart
//          lazy behind DashboardPremium). Left to per-consumer chunking,
//          recharts stays lazy and its d3-* deps can dedupe against mermaid's.
//       2. OrgSidebar/MobileOrgDrawer (+OrgPanel), NotificationLayer, and
//          HeaderBanners are now lazy() from App.jsx (null/skeleton
//          Suspense fallbacks — none are needed for the dashboard first paint).
//       3. SlimSidebar was split out of Sidebar.jsx into its own module and
//          made lazy — Sidebar.jsx keeps the shared QuickActionButtons/
//          ActionHistoryRow/ActivityRow the expanded sidebar also needs.
//     Header/Sidebar/RepoList stay eager on purpose: Header renders for every
//     view, and a hash deep-link (e.g. #/repos) can make Sidebar/RepoList the
//     first-painted view on a cold load (useAppRouter resolves the hash before
//     the user sees anything settle) — splitting them needs a layout-identical
//     Suspense fallback to avoid a flash, which is a larger, separate effort.
//     Budget re-baselined to 82 KB (~3 KB margin over the 78.82 KB actual) to
//     lock this gain — DO NOT raise it further to accommodate new eager
//     growth; find another lazy seam.
//   - Total eager: dropped from ~397 KB to ~379.9 KB gz actual (the recharts
//     fix mainly helped here too, even though it isn't in the index file
//     itself). Budget re-baselined to 395 KB (~15 KB margin).
const EAGER_INDEX_GZ_BUDGET = 82 * 1024
const EAGER_TOTAL_GZ_BUDGET = 395 * 1024

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
