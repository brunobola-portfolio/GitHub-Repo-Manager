/*
 * One eyebrow recipe, not nine letter-spacings.
 *
 * 222 uppercase micro-labels each hand-rolled their own size/weight/tracking
 * combo — nine different letter-spacings for the one role, and the
 * primitives disagreed with each other (PageHeader/PanelHeader at 0.22em,
 * SectionPanel/AIQuotaMeter at 0.2em, Steppers/WhatNeedsYouGrid at 0.18em,
 * UpgradeRequired at 0.14em) (2026-09-04 panel, F17). `.ds-eyebrow` in
 * design-system.css is the single recipe now; a call site still supplies its
 * own colour/layout classes alongside it.
 *
 * Scoped like the checkbox/palette gates: `uppercase` and a `tracking-*`
 * utility on the SAME line is the eyebrow-label recipe (a className string
 * belongs to one element), so this only fires on a real recount, not on
 * unrelated uppercase text or unrelated tracking use elsewhere on the node.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry).split('\\').join('/')
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.jsx?$/.test(p)) out.push(p)
    }
    return out
}

// Settings/**, Audit/**, RepoFilterBar.jsx and WorkBoard/filters/** carry
// pre-existing eyebrow recipes outside this pass's scope — a concurrent
// 2026-09-04 panel pass owns those paths (focus-ring / filter-bar work) so
// this gate does not race it. CommandPalette/styles.js drives an arbitrary
// Tailwind variant (`[&>[cmdk-group-heading]]:uppercase`) — a custom
// unlayered class like `ds-eyebrow` cannot be composed into that syntax
// (Tailwind only recognizes utilities it generates), so it is excluded here
// rather than force-fit.
const ALLOWED = new Set([
    'src/components/CommandPalette/styles.js',
    'src/components/RepoList/RepoFilterBar.jsx',
])
const ALLOWED_PREFIXES = ['src/components/Settings/', 'src/components/Audit/', 'src/components/WorkBoard/filters/']

const FILES = walk('src/components').filter(
    (f) => !ALLOWED.has(f) && !ALLOWED_PREFIXES.some((prefix) => f.startsWith(prefix)),
)

const RECIPE = /uppercase[^"'`]*tracking-(?:wider|wide|widest|\[0\.\d+em\])|tracking-(?:wider|wide|widest|\[0\.\d+em\])[^"'`]*uppercase/

describe('uppercase micro-labels use .ds-eyebrow, not a hand-rolled recipe', () => {
    it('finds component files at all (guards the walker itself)', () => {
        expect(FILES.length).toBeGreaterThan(100)
    })

    it('has no uppercase + tracking-* recipe outside ds-eyebrow', () => {
        const offenders = []
        for (const file of FILES) {
            const src = readFileSync(file, 'utf8')
            src.split(/\r?\n/).forEach((line, i) => {
                if (RECIPE.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`)
            })
        }
        expect(offenders, `use ds-eyebrow instead:\n${offenders.join('\n')}`).toEqual([])
    })
})
