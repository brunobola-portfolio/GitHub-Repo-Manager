/*
 * No bare `shadow-2xl` — use ds-elevation-overlay (or ds-elevation-lg for a
 * static, non-floating panel).
 *
 * F11 (2026-09-04 panel) found 229 raw Tailwind `shadow-*` utilities against
 * 22 uses of the `--ds-shadow-*` tokens; light mode's default Tailwind
 * shadow is slate-tinted and measures ~1.07:1 against the page (see
 * Card.jsx's own doc comment). That sweep is bounded to `shadow-2xl` here —
 * all 10 uses were one-offs, unlike `shadow-sm`/`md`/`lg` at 105/46/43 uses
 * each, which is a separate, much larger pass. Two call sites carry a
 * colour-tinted shadow (`shadow-2xl shadow-brand-500/50`,
 * `shadow-2xl shadow-slate-900/15`) — a decorative glow, not a neutral
 * elevation step — and are allowlisted rather than force-fit onto a token
 * that would strip the colour.
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

const ALLOWED = new Set([
    // Colour-tinted decorative glow (shadow-brand-500/50), not a neutral
    // elevation step — ds-elevation-overlay would strip the brand tint.
    'src/components/MobileQuickActionsFab.jsx',
    // Settings/** is outside this pass's scope (2026-09-04 panel follow-up).
    'src/components/Settings/AIConfig/ModelDropdown.jsx',
])

const FILES = walk('src/components').filter((f) => !ALLOWED.has(f))

describe('elevation uses ds-elevation-*, not bare shadow-2xl', () => {
    it('finds component files at all (guards the walker itself)', () => {
        expect(FILES.length).toBeGreaterThan(100)
    })

    it('has no shadow-2xl outside the allowlist', () => {
        const offenders = []
        for (const file of FILES) {
            const src = readFileSync(file, 'utf8')
            src.split(/\r?\n/).forEach((line, i) => {
                if (/\bshadow-2xl\b/.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`)
            })
        }
        expect(offenders, `use ds-elevation-overlay/lg instead:\n${offenders.join('\n')}`).toEqual([])
    })
})
