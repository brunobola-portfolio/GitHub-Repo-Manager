/*
 * No browser-blue checkboxes.
 *
 * 20 of the app's 30 native checkboxes carried no `accent-*` utility, so
 * they rendered the UA's default blue — `@tailwindcss/forms` isn't
 * installed, so `text-*` on a checkbox is dead CSS (2026-09-04 panel, F01).
 * `Checkbox` in ui/form is the single place `type="checkbox"` is allowed to
 * live; every call site renders it instead.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CHECKBOX_PRIMITIVE = 'src/components/ui/form/Checkbox.jsx'

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry).split('\\').join('/')
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.jsx?$/.test(p)) out.push(p)
    }
    return out
}

const FILES = walk('src/components').filter((f) => f !== CHECKBOX_PRIMITIVE)

describe('checkbox rendering goes through the Checkbox primitive', () => {
    it('finds component files at all (guards the walker itself)', () => {
        expect(FILES.length).toBeGreaterThan(100)
    })

    it('has no raw type="checkbox" outside Checkbox.jsx', () => {
        const offenders = []
        for (const file of FILES) {
            const src = readFileSync(file, 'utf8')
            src.split(/\r?\n/).forEach((line, i) => {
                if (/type=["']checkbox["']/.test(line)) offenders.push(`${file}:${i + 1}`)
            })
        }
        expect(offenders, `use <Checkbox> from ui/form instead:\n${offenders.join('\n')}`).toEqual([])
    })

    it('the primitive itself still exists and owns the one raw checkbox input', () => {
        const src = readFileSync(CHECKBOX_PRIMITIVE, 'utf8')
        expect(src).toContain('type="checkbox"')
        expect(src).toContain('accent-brand-600')
    })

    it('is exported from the form barrel', () => {
        const src = readFileSync('src/components/ui/form/index.js', 'utf8')
        expect(src).toContain("export { Checkbox } from './Checkbox'")
    })
})
