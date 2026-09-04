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
//     DO NOT raise the budget to accommodate new eager growth; find another
//     lazy seam.
//
// RE-BASELINED 2026-07-27, and the old numbers were never real. Vitest sets
// NODE_ENV=test and the beforeAll execSync inherited it, so `--mode production`
// still emitted a React DEVELOPMENT build — vendor-react at 2.02x its shipped
// size. The 82 / 395 KB budgets were sized against an artifact that never
// reaches a user. With NODE_ENV pinned (see beforeAll), the SHIPPED bundle
// measures 69.38 KB index and 349.53 KB eager across 24 chunks, so the budgets
// below carry ~3.8% and ~4.4% margin over reality.
//
// RE-BASELINED 2026-09-04: dropping the vendor-diff manualChunks group (see
// vite.config.js) took the diff viewer off the entry's static closure. The
// TRANSITIVE eager closure now measures 55.7 KB index / 292.9 KB total across
// 41 chunks (it was 340.4 KB with the diff chunk hoisted in). ~4% margin.
const EAGER_INDEX_GZ_BUDGET = 58 * 1024
const EAGER_TOTAL_GZ_BUDGET = 305 * 1024

const RUN = process.env.RUN_BUILD_TESTS === '1'

// Each build gate builds into its OWN out dir. Both files used to build into
// `dist/`, and vitest runs test FILES in parallel workers — so whichever
// finished second clobbered the artifact the first was still asserting against,
// making the pair fail together while each passed alone. Separate out dirs
// remove the race instead of serialising the suite.
const OUT_DIR = 'dist-budget-check'
const ASSETS = `${OUT_DIR}/assets`

function gzipSize(filePath) {
    return gzipSync(readFileSync(filePath)).length
}

function findFiles(dir, prefix) {
    return readdirSync(dir)
        .filter((f) => f.startsWith(prefix) && f.endsWith('.js'))
        .map((f) => join(dir, f))
}

/**
 * Every chunk reachable from the entry through STATIC imports, transitively.
 * The previous version scanned only the entry's own `from"./x.js"` lines, so a
 * heavy chunk pulled in one hop deeper (vendor-diff via vendor-react's jsx
 * runtime, 2026-09-04 panel: 87 KB brotli on every cold load) was invisible to
 * the budget. Captures `from"./chunk.js"` (rolldown) and `from "./chunk.js"`.
 */
function eagerClosure(entryPath) {
    const re = /from\s*['"]\.\/([^'"]+\.js)['"]/g
    const seen = new Set()
    const queue = [entryPath]
    while (queue.length) {
        const file = queue.shift()
        if (!existsSync(file)) continue
        const content = readFileSync(file, 'utf8')
        let m
        while ((m = re.exec(content))) {
            if (!seen.has(m[1])) {
                seen.add(m[1])
                queue.push(join(ASSETS, m[1]))
            }
        }
    }
    return seen
}

describe.skipIf(!RUN)('bundle size budget', () => {
    it('the diff viewer is not on the critical path', () => {
        // index.html modulepreloads the entry's static closure. The diff
        // viewer (@git-diff-view + highlight.js grammars, ~316 KB raw) has no
        // first-paint consumer — every one is React.lazy — so neither a
        // vendor-diff chunk nor its stylesheet may appear there.
        const html = readFileSync(join(OUT_DIR, 'index.html'), 'utf8')
        expect(html).not.toMatch(/vendor-diff/)
        expect(html).not.toMatch(/diff-view[^"']*\.css/)
        const indexFiles = findFiles(ASSETS, 'index-')
        const eager = [...eagerClosure(indexFiles[0])]
        expect(eager.filter((c) => /vendor-diff|DiffRenderer|diff-view/i.test(c))).toEqual([])
    })

    beforeAll(() => {
        // NODE_ENV must be pinned. Vitest sets NODE_ENV=test and
        // execSync inherits it, so `--mode production` still produced a
        // React DEVELOPMENT build: vendor-react came out 2.02x larger
        // (366,652 B vs 181,795 B raw) and the bundle carried DEV-only
        // symbols. This gate was measuring an artifact we never ship.
        execSync(`npx vite build --mode production --outDir ${OUT_DIR} --emptyOutDir`, {
            stdio: 'inherit',
            env: { ...process.env, VITE_MOCK_MODE: '', NODE_ENV: 'production' },
        })
    }, 180_000)

    it('build assets exist', () => {
        expect(existsSync(ASSETS)).toBe(true)
    })

    it(`index-*.js gzipped is under ${(EAGER_INDEX_GZ_BUDGET / 1024).toFixed(0)} KB`, () => {
        const indexFiles = findFiles(ASSETS, 'index-')
        expect(indexFiles).toHaveLength(1)
        const size = gzipSize(indexFiles[0])
        expect(size).toBeLessThan(EAGER_INDEX_GZ_BUDGET)
    })

    it(`eager bundle gzipped sum is under ${(EAGER_TOTAL_GZ_BUDGET / 1024).toFixed(0)} KB`, () => {
        const indexFiles = findFiles(ASSETS, 'index-')
        const eagerChunks = eagerClosure(indexFiles[0])

        let totalGz = gzipSize(indexFiles[0])
        const breakdown = [{ chunk: indexFiles[0].replace(/\\/g, '/'), gz: totalGz }]
        for (const name of eagerChunks) {
            const path = join(ASSETS, name)
            if (!existsSync(path)) continue
            const gz = gzipSize(path)
            totalGz += gz
            breakdown.push({ chunk: `${ASSETS}/${name}`, gz })
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
        const indexFiles = findFiles(ASSETS, 'index-')
        const indexContent = readFileSync(indexFiles[0], 'utf8')
        const re = /from\s*['"]\.\/(esm-[^'"]+\.js)['"]/g
        const offenders = []
        let m
        while ((m = re.exec(indexContent))) {
            const chunk = m[1]
            const path = join(ASSETS, chunk)
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
