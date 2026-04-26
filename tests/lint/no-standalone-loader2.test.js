/*
 * Regression guard: every <Loader2 ... animate-spin> in src/components/
 * must be either inside a <button> / <Button> / <motion.button> (idiomatic
 * loading icon) OR in the small ALLOWED set below. Any new standalone use
 * should go through <Spinner /> / <SectionSpinner /> / <PageSpinner />.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// Sites that legitimately use a raw Loader2 outside of a button.
// The first entry (Spinner.jsx) is the source primitive — it MUST use Loader2.
// The rest are PRE-EXISTING standalone spinners frozen as the slice-3 baseline:
// the regression guard prevents NEW offenders, but migrating these to
// <SectionSpinner /> / <Spinner /> happens incrementally in follow-up sweeps
// (one PR per area). Each entry costs ~1 minute of work — adding to a future
// slice avoids blowing this slice's context budget.
const ALLOWED = new Set([
    // The source primitive itself wraps Loader2 — that's its job.
    'src/components/ui/Spinner.jsx',
])

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry)
        const st = statSync(p)
        if (st.isDirectory()) yield* walk(p)
        else if (p.endsWith('.jsx') || p.endsWith('.js')) yield p
    }
}

function isInsideButton(content, matchIndex) {
    // Approximation: scan ~600 chars before the match for an unclosed
    // <button / <Button / <motion.button.
    const window = content.slice(Math.max(0, matchIndex - 600), matchIndex)
    const lastOpen = Math.max(
        window.lastIndexOf('<button'),
        window.lastIndexOf('<Button'),
        window.lastIndexOf('<motion.button'),
    )
    if (lastOpen === -1) return false
    const lastClose = Math.max(
        window.lastIndexOf('</button>'),
        window.lastIndexOf('</Button>'),
        window.lastIndexOf('</motion.button>'),
    )
    return lastOpen > lastClose
}

describe('no standalone Loader2 outside buttons', () => {
    it('every <Loader2 ... animate-spin> is inside a button or in the allow-list', () => {
        const offenders = []
        const re = /<Loader2[^>]*animate-spin[^>]*\/?>/g
        for (const file of walk('src/components')) {
            const rel = file.replace(/\\/g, '/')
            if (ALLOWED.has(rel)) continue
            const content = readFileSync(file, 'utf8')
            let m
            while ((m = re.exec(content))) {
                if (!isInsideButton(content, m.index)) {
                    offenders.push(rel)
                    break // one offender per file is enough to fail
                }
            }
        }
        expect(
            offenders,
            `Found ${offenders.length} files with standalone Loader2 outside buttons:\n` +
                offenders.map((f) => `  - ${f}`).join('\n') +
                '\n\nReplace each with <SectionSpinner label="..." /> (full-section loading) or ' +
                '<Spinner size="sm" tone="muted" /> (inline status).',
        ).toEqual([])
    })
})
