/*
 * No arbitrary `text-[Npx]` sizes off the `--ds-text-*` scale.
 *
 * 45+ call sites used bracket sizes the scale already names —
 * `--ds-text-xs/sm/base/md` and the `ds-text-micro`(10px)/`ds-text-meta`(11px)
 * utilities — one per file, mechanically drifted (2026-09-04 panel, F18).
 * The mapping this gate enforces: text-[13px]->ds-text-sm, text-[12px]->text-xs,
 * text-[8px]/[9px]/[10px]/[10.5px]->ds-text-micro.
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

// Settings/** still carries pre-existing arbitrary text sizes outside this
// pass's scope (2026-09-04 panel follow-up); excluded here rather than
// silently narrowing the pattern for everyone else.
const ALLOWED_PREFIXES = ['src/components/Settings/']

const FILES = walk('src/components').filter(
    (f) => !ALLOWED_PREFIXES.some((prefix) => f.startsWith(prefix)),
)

const ARBITRARY_TEXT_PX = /text-\[[0-9.]+px\]/

describe('text sizes come from the --ds-text-* scale, not arbitrary brackets', () => {
    it('finds component files at all (guards the walker itself)', () => {
        expect(FILES.length).toBeGreaterThan(100)
    })

    it('has no text-[Npx] outside design-system.css / Settings', () => {
        const offenders = []
        for (const file of FILES) {
            const src = readFileSync(file, 'utf8')
            src.split(/\r?\n/).forEach((line, i) => {
                if (ARBITRARY_TEXT_PX.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`)
            })
        }
        expect(offenders, `use ds-text-micro / text-xs / ds-text-sm instead:\n${offenders.join('\n')}`).toEqual([])
    })
})
