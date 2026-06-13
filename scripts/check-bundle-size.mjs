#!/usr/bin/env node
/**
 * CI performance budget — enforce gzipped bundle size ceilings on the
 * primary client chunks produced by `vite build`. After P4-W split the
 * shiki highlighter off, the main bundle stabilised at ~200 KB
 * (~50 KB gzipped); this script locks that in so regressions fail fast.
 *
 * A failure (any chunk over budget) exits non-zero; missing chunks emit
 * a warning and are skipped (never fatal) so renamed/deleted bundles
 * don't break CI until the budget file is updated intentionally.
 */
import { readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BUDGETS = {
    // Recalibrated 2026-06: the 60 KB ceiling predated months of feature
    // growth (work board, licensing, AI quick actions, org panel) and the
    // build had silently drifted to 86 KB. Lazy-loading the CommandPalette
    // (+cmdk and its search/AI deps) recovered 21 KB → 65.6 KB measured;
    // 68 KB keeps a tight tripwire. Remaining content is first-paint UI
    // (Header/Sidebar/RepoList/providers) — shrinking further means
    // splitting the initial view, which costs UX. Ratchet down if a future
    // split lands.
    'index-': { maxGzipKB: 68, name: 'main bundle' },
    'vendor-react-': { maxGzipKB: 57, name: 'vendor-react' },
    'vendor-ui-': { maxGzipKB: 28, name: 'vendor-ui' },
    'vendor-icons-': { maxGzipKB: 15, name: 'vendor-icons' },
    'WorkBoardPage-': { maxGzipKB: 20, name: 'WorkBoard' },
    // vendor-diff (highlight.js common-langs + @git-diff-view, shim replaces all→common)
    // was 332 KB gzip before P5 code-split; now capped at 86 KB (-74%).
    'vendor-diff-': { maxGzipKB: 86, name: 'vendor-diff' },
    // vendor-charts-* (recharts v3 + d3 transitively): ~102 KB gzip today.
    // Ceiling carries ~8 KB headroom so the single biggest payload offender
    // can't grow unnoticed. Real reduction requires Rolldown advancedChunks
    // (currently conflicts with manualChunks in 1.0.0-rc.15) or a library
    // swap (visx / nivo).
    'vendor-charts-': { maxGzipKB: 110, name: 'vendor-charts' },
}

const dist = 'dist/assets'
const files = readdirSync(dist).filter(f => f.endsWith('.js'))
const failures = []
const passes = []

for (const [prefix, budget] of Object.entries(BUDGETS)) {
    const match = files.find(f => f.startsWith(prefix) && f.endsWith('.js'))
    if (!match) {
        console.warn(`⚠️  No file matched prefix "${prefix}" — skipping`)
        continue
    }
    const raw = readFileSync(join(dist, match))
    const gzipKB = Math.round(gzipSync(raw).length / 1024 * 10) / 10
    const line = `${budget.name.padEnd(20)} ${match.padEnd(40)} ${gzipKB.toString().padStart(6)} KB gzip (budget ${budget.maxGzipKB} KB)`
    if (gzipKB > budget.maxGzipKB) {
        failures.push(line)
        console.error(`❌ ${line}`)
    } else {
        passes.push(line)
        console.log(`✅ ${line}`)
    }
}

if (failures.length > 0) {
    console.error(`\n${failures.length} bundle budget violation(s) — fix or raise budget in scripts/check-bundle-size.mjs`)
    process.exit(1)
}
console.log(`\n${passes.length} bundles within budget`)
