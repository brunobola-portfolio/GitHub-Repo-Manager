/*
 * The seller is published as the brand and the region only: "BolaLabs,
 * Portugal, Europe", with legal identification sent on request (owner
 * decision 2026-10-26). A tax number reached the Terms page once, in a
 * reviewed and merged PR, before anyone noticed it should not be public.
 *
 * Scans what ships or is read publicly: the app and server source, the
 * README, the licence files and the top-level docs. Dated plans, specs and
 * reports under docs/ are historical records and are not scanned.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const ROOTS = ['src', 'server', 'public']
const FILES = ['README.md', 'LICENSE', 'NOTICE', 'TRADEMARKS.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'CONTRIBUTING.md', 'CLA.md']
const SKIP_DIRS = new Set(['node_modules', '__tests__', 'data', 'data-backups', 'dist'])
const TEXT = /\.(jsx?|mjs|cjs|json|md|html|css|txt|svg)$/

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (SKIP_DIRS.has(name)) continue
        const p = join(dir, name)
        const st = statSync(p)
        if (st.isDirectory()) walk(p, out)
        else if (TEXT.test(name) && st.size < 2_000_000) out.push(p)
    }
    return out
}

const topDocs = readdirSync('docs').filter((n) => n.endsWith('.md')).map((n) => join('docs', n))
const files = [...ROOTS.flatMap((r) => walk(r)), ...FILES, ...topDocs]

const FORBIDDEN = [
    { what: 'a Portuguese tax number (NIF/VAT)', re: /\bPT ?\d{9}\b|\bNIF[:\s]+\d{9}\b/ },
    { what: 'the personal name', re: /Bruno Silva Marques|Bruno Marques/ },
    { what: 'a personal e-mail address', re: /bruno@bolalabs\.(pt|com)|brunobola@gmail\.com/ },
]

describe('no personal identity on public surfaces', () => {
    for (const { what, re } of FORBIDDEN) {
        it(`no file publishes ${what}`, () => {
            const hits = files.filter((f) => re.test(readFileSync(f, 'utf8')))
            expect(hits, `${what} found in: ${hits.join(', ')}`).toEqual([])
        })
    }

    it('the legal pages identify the seller by brand and region', () => {
        for (const f of ['src/components/PublicLegal/TermsPage.jsx', 'src/components/PublicLegal/PrivacyPage.jsx']) {
            const src = readFileSync(f, 'utf8')
            expect(src, f).toMatch(/BolaLabs, Portugal, Europe/)
            expect(src, f).toMatch(/on request/)
        }
    })
})
