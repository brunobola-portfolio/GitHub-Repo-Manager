import { describe, it, expect } from 'vitest'
import { getLanguageColor, LANGUAGE_COLORS, FALLBACK_COLORS } from '@/utils/languageColors'

describe('getLanguageColor', () => {
    it('returns GitHub linguist colours for mapped languages', () => {
        expect(getLanguageColor('TypeScript')).toBe('#3178c6')
        expect(getLanguageColor('Go')).toBe('#00ADD8')
        expect(getLanguageColor('C#')).toBe('#178600')
    })

    it('gives visually distinct colours to distinct languages', () => {
        // The bug this module exists to kill: RepoCard painted every language
        // the same indigo. A live sample rendered 15 languages in 1 colour.
        const sample = [
            'TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java',
            'Kotlin', 'Swift', 'CSS', 'HTML', 'HCL', 'PHP', 'Dart', 'C++', 'YAML',
        ]
        const colours = new Set(sample.map(getLanguageColor))
        expect(colours.size).toBe(sample.length)
    })

    it('falls back to the palette for unmapped languages', () => {
        const c = getLanguageColor('Brainfuck')
        expect(FALLBACK_COLORS).toContain(c)
    })

    it('fallback is stable for the same name — not position-dependent', () => {
        // The old LanguageChart fallback indexed by list position, so the same
        // unmapped language changed colour when the sort order changed and could
        // never agree with a repo card (which has no list index at all).
        expect(getLanguageColor('Brainfuck')).toBe(getLanguageColor('Brainfuck'))
        expect(getLanguageColor('Zephyr')).not.toBe(undefined)
    })

    it('handles missing/empty language without throwing', () => {
        expect(getLanguageColor(undefined)).toBe(FALLBACK_COLORS[0])
        expect(getLanguageColor(null)).toBe(FALLBACK_COLORS[0])
        expect(getLanguageColor('')).toBe(FALLBACK_COLORS[0])
    })

    it('every mapped value is a hex colour', () => {
        for (const [name, hex] of Object.entries(LANGUAGE_COLORS)) {
            expect(hex, name).toMatch(/^#[0-9a-fA-F]{6}$/)
        }
    })
})
