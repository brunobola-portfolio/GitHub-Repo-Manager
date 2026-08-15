/*
 * The licence is claimed in eleven places. They have to agree.
 *
 * This project moved from AGPL-3.0-only to Apache-2.0 in v4.19.0, and a
 * relicence is exactly the kind of change that lands at 95%: the LICENSE file
 * swaps, the package manifest swaps, and then a badge in the README or an
 * `SPDX-License-Identifier` on one file left behind keeps telling people the
 * old answer for years. A stale AGPL claim is worse than a stale version
 * number — someone can rely on it.
 *
 * Historical documents are exempt on purpose. docs/plans/, docs/specs/ and
 * docs/reports/ record what was true when they were written; rewriting them
 * would be falsifying a record, not fixing a claim.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const HISTORICAL = ['docs/plans/', 'docs/specs/', 'docs/reports/', '.dev/', '.superpowers/']
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'release', 'coverage', 'brand'])

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry).split('\\').join('/')
        if (SKIP_DIRS.has(entry)) continue
        if (statSync(p).isDirectory()) walk(p, out)
        else out.push(p)
    }
    return out
}

const SELF = 'tests/build/license-consistency.test.js'

const ALL = walk('.').map((p) => p.replace(/^\.\//, '')).filter((p) => p !== SELF)
const isHistorical = (p) => HISTORICAL.some((h) => p.startsWith(h))

const NEWLINE = String.fromCharCode(10)

const SOURCE = ALL.filter((p) => /\.(jsx?|mjs|cjs)$/.test(p) && !isHistorical(p))
const DOCS = ALL.filter((p) => p.endsWith('.md') && !isHistorical(p))

describe('the licence is Apache-2.0, everywhere it is claimed', () => {
    it('finds the files it is meant to check (guards the walker)', () => {
        expect(SOURCE.length).toBeGreaterThan(200)
        expect(DOCS.length).toBeGreaterThan(20)
    })

    it('LICENSE is the Apache text, complete', () => {
        const license = readFileSync('LICENSE', 'utf8')
        expect(license).toContain('Apache License')
        expect(license).toContain('Version 2.0, January 2004')
        // Nine numbered sections plus the appendix — a truncated licence is a
        // licence nobody can rely on.
        expect(license.match(/^ {3}\d\. /gm)?.length).toBe(9)
        expect(license).toContain('APPENDIX: How to apply')
        expect(license).toContain('Bola Labs, Inc.')
    })

    it('the package manifest agrees with the LICENSE file', () => {
        expect(JSON.parse(readFileSync('package.json', 'utf8')).license).toBe('Apache-2.0')
    })

    it('ships a NOTICE, which Apache-2.0 §4(d) gives meaning to', () => {
        const notice = readFileSync('NOTICE', 'utf8')
        expect(notice).toContain('Apache License, Version 2.0')
        expect(notice).toContain('Bola Labs')
    })

    it('reserves the mark in writing, because §6 does not do it for you', () => {
        const tm = readFileSync('TRADEMARKS.md', 'utf8')
        expect(tm).toMatch(/RepoManager/)
        // The two halves that make it a usable policy rather than a warning.
        expect(tm, 'must say what is allowed without asking').toMatch(/without asking/i)
        expect(tm, 'must say what needs permission').toMatch(/permission/i)
    })

    // A file's licence claim is its HEADER, not its body. license-detect.js
    // reads licences out of OTHER people's repositories, so SPDX strings and
    // the word AGPL appear there as data, not as a claim about this project.
    const header = (p) => readFileSync(p, 'utf8').split(NEWLINE).slice(0, 6).join(NEWLINE)

    it('carries no AGPL SPDX identifier in its own headers', () => {
        const offenders = SOURCE.filter((p) => header(p).includes('SPDX-License-Identifier: AGPL'))
        expect(offenders, `still AGPL:${NEWLINE}${offenders.join(NEWLINE)}`).toEqual([])
    })

    it('every SPDX identifier we set says Apache-2.0', () => {
        const wrong = []
        for (const p of SOURCE) {
            for (const m of header(p).matchAll(/SPDX-License-Identifier:\s*(\S+)/g)) {
                if (m[1] !== 'Apache-2.0') wrong.push(`${p} → ${m[1]}`)
            }
        }
        expect(wrong, wrong.join(NEWLINE)).toEqual([])
    })

    it('claims no copyleft obligation it no longer has', () => {
        // 'AGPL' may appear in a doc that explains the move; what may not
        // appear is a live instruction derived from it.
        const FORBIDDEN = [
            'AGPL §13 requires',
            'must offer their corresponding source',
            'without AGPL obligations',
            'reverts to AGPL',
        ]
        const offenders = []
        for (const p of [...DOCS, ...SOURCE]) {
            const body = readFileSync(p, 'utf8')
            for (const phrase of FORBIDDEN) {
                if (body.includes(phrase)) offenders.push(`${p}: "${phrase}"`)
            }
        }
        expect(offenders, offenders.join('\n')).toEqual([])
    })

    it('does not sell permission it already gave away', () => {
        // The subscription page is the one place tempted to re-sell the
        // licence. It must say the opposite, in as many words.
        const terms = readFileSync('docs/LICENSE-COMMERCIAL.md', 'utf8')
        expect(terms).toMatch(/Apache License 2\.0/)
        expect(terms).toMatch(/nothing on it is required[\s\S]{0,40}to use the software/i)
    })

    it('the provenance endpoint reports the licence it actually ships under', () => {
        const route = readFileSync('server/routes/system.js', 'utf8')
        expect(route).toContain("license: 'Apache-2.0'")
        expect(route).not.toContain('AGPL-3.0-only')
    })

    it('links no reader at the commercial-licence URL that 404s', () => {
        // bolalabs.pt/license does not exist. Until it does, nothing user-facing
        // may point there — a dead link in a footer is worse than no link.
        const offenders = []
        for (const p of [...SOURCE, ...DOCS]) {
            if (readFileSync(p, 'utf8').includes('bolalabs.pt/license')) offenders.push(p)
        }
        expect(offenders, offenders.join('\n')).toEqual([])
    })
})
