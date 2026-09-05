/*
 * No bare `shadow-sm|md|lg|xl` — use ds-elevation-sm|md|lg|overlay.
 *
 * F11 (2026-09-04 panel) found 229 raw Tailwind `shadow-*` utilities against
 * 22 uses of the `--ds-shadow-*` tokens; light mode's default Tailwind shadow
 * is slate-tinted and measures ~1.07:1 against the page (see Card.jsx's own
 * doc comment — Card already reads the token via `shadow-[var(--ds-shadow-lg)]`,
 * which is why it never shows up here). `shadow-2xl` got its own narrower gate
 * (no-shadow-2xl.test.js, bounded to 10 one-off uses); this one covers the
 * other three steps — 143 bare uses swept onto the token classes across 62
 * files (2026-09-05 panel follow-up).
 *
 * What this gate does NOT flag, on purpose:
 *   - `shadow-[var(--ds-shadow-*)]` — already the token, just spelled as an
 *     arbitrary value instead of the .ds-elevation-* class (Card, Modal,
 *     Drawer, WizardPanel, InsightCard all do this).
 *   - Any `hover:`/`focus:`/`focus-visible:`/`group-hover:`-prefixed shadow
 *     utility. `.ds-elevation-*` are plain CSS classes (not Tailwind
 *     utilities), so Tailwind never generates a `hover:ds-elevation-md`
 *     variant for them — rewriting a hover-only shadow onto the token class
 *     would silently delete the hover effect. These stay raw Tailwind.
 *   - A bare shadow-sm|md|lg|xl that shares a class string with a
 *     shadow-<colour>-NNN or shadow-<colour>/NN companion (same or any
 *     prefix) — a deliberate coloured glow, not neutral elevation (e.g.
 *     MobileQuickActionsFab's `shadow-xl shadow-brand-500/40`, PricingCard's
 *     `shadow-xl shadow-amber-500/10`). Stripping the size utility would
 *     leave the colour override with nothing to tint.
 *   - `shadow-inner` and the brand mark (BrandMark.jsx draws no shadows).
 *
 * ALLOWED below is for one-off exceptions that don't fit the two structural
 * carve-outs above. It is currently empty — the 2026-09-05 sweep found none
 * needed — but is wired up (with a stale-entry check) for whatever the next
 * one turns out to be, mirroring no-shadow-2xl.test.js's allowlist shape.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** file -> reason. Extend only for a genuine one-off; the two structural
 *  carve-outs above (variant-prefixed, colour-companion) need no entry. */
const ALLOWED = new Map([
    // (none yet)
])

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry).split('\\').join('/')
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.jsx$/.test(p)) out.push(p)
    }
    return out
}

const FILES = ['src/App.jsx', ...walk('src/components')]

// A shadow-<colour>-NNN or shadow-<colour>/NN companion anywhere on the line,
// at any prefix — signals a deliberate tinted glow rather than plain
// elevation, regardless of which prefix the size utility itself carries.
const COLOR_COMPANION = /(?:^|[\s"'`{,()])shadow-(?:black|white|slate|brand|amber|rose|emerald|blue)(?:-\d{2,3})?\/\d{1,3}\b/
const COLOR_COMPANION2 = /(?:^|[\s"'`{,()])shadow-(?:black|white|slate|brand|amber|rose|emerald|blue)-\d{2,3}\b/

// A BARE shadow-sm|md|lg|xl — no variant prefix directly on it. A prefixed
// one (hover:shadow-md, dark:shadow-lg, group-hover:shadow-sm, ...) is left
// alone structurally (see file doc comment) and never reaches this list.
const BARE_TOKEN = /(?:^|[\s"'`{,()])shadow-(?:sm|md|lg|xl)\b/

describe('elevation uses ds-elevation-*, not a bare shadow-sm|md|lg|xl', () => {
    it('finds component files at all (guards the walker itself)', () => {
        expect(FILES.length).toBeGreaterThan(100)
    })

    it('has no bare, uncoloured shadow-sm|md|lg|xl outside the allowlist', () => {
        const offenders = []
        for (const file of FILES) {
            if (ALLOWED.has(file)) continue
            const src = readFileSync(file, 'utf8')
            src.split(/\r?\n/).forEach((line, i) => {
                if (!BARE_TOKEN.test(line)) return
                if (COLOR_COMPANION.test(line) || COLOR_COMPANION2.test(line)) return
                offenders.push(`${file}:${i + 1} ${line.trim()}`)
            })
        }
        expect(offenders, `use ds-elevation-sm/md/lg/overlay instead:\n${offenders.slice(0, 20).join('\n')}`).toEqual([])
    })

    it('keeps no stale allowlist entries', () => {
        // An ALLOWED file that no longer contains a bare shadow-* utility is
        // dead weight — either it was fixed and the entry should be deleted,
        // or (2026-09-04 panel precedent, no-shadow-2xl.test.js) the file was
        // renamed/refactored and the entry now silently protects nothing.
        const stale = []
        for (const [file] of ALLOWED) {
            let src
            try {
                src = readFileSync(file, 'utf8')
            } catch {
                stale.push(`${file} (file no longer exists)`)
                continue
            }
            if (!/\bshadow-(?:sm|md|lg|xl)\b/.test(src)) {
                stale.push(`${file} (no longer has a shadow-sm|md|lg|xl utility)`)
            }
        }
        expect(stale, `remove these stale ALLOWED entries:\n${stale.join('\n')}`).toEqual([])
    })
})
