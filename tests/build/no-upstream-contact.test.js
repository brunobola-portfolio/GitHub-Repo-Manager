/*
 * The web app must not hardcode a BolaLabs mailbox: one build serves the
 * hosted app and every self-hosted install, and the contacts come from the
 * shell at runtime (src/utils/supportContact.js). A hardcoded default sent
 * every self-hosted user's "contact support" to the maintainer's inbox.
 *
 * The legal pages are exempt: the data controller of the hosted service is
 * named there by law. Mocks are dev-only fixtures.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const EXEMPT = ['src/components/PublicLegal/', 'src/__mocks__/']

function walk(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full, out)
        else if (/\.(jsx?|mjs)$/.test(entry.name)) out.push(full.split('\\').join('/'))
    }
    return out
}

describe('no upstream mailbox in the web app', () => {
    it('no @bolalabs.pt address in src/ outside the legal pages and mocks', () => {
        const offenders = []
        for (const file of walk('src')) {
            if (EXEMPT.some((p) => file.startsWith(p))) continue
            const lines = readFileSync(file, 'utf8').split('\n')
            lines.forEach((line, i) => {
                if (/[\w.+-]+@bolalabs\.pt/.test(line)) offenders.push(`${file}:${i + 1}`)
            })
        }
        expect(offenders).toEqual([])
    })
})
