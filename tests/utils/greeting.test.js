import { describe, it, expect } from 'vitest'

const { getGreeting, getDashboardSubtitle, getSyncedLabel, getDashboardLocale, getHeroFallbackGreeting } = await import('../../src/utils/greeting')

// The dashboard hero is intentionally English-only (a previous locale switch
// shipped half-Portuguese copy on an otherwise English UI). These tests pin
// that English-only contract so the mixed-language regression can't return.

describe('getGreeting', () => {
    it('returns the English morning greeting before 12:00', () => {
        expect(getGreeting(new Date(2026, 3, 27, 8, 0), 'Bruno')).toBe('Good morning, Bruno')
        expect(getGreeting(new Date(2026, 3, 27, 11, 59), 'Bruno')).toBe('Good morning, Bruno')
    })

    it('returns the English afternoon greeting between 12:00 and 17:59', () => {
        expect(getGreeting(new Date(2026, 3, 27, 12, 0), 'Bruno')).toBe('Good afternoon, Bruno')
        expect(getGreeting(new Date(2026, 3, 27, 17, 59), 'Bruno')).toBe('Good afternoon, Bruno')
    })

    it('returns the English evening greeting from 18:00 onwards', () => {
        expect(getGreeting(new Date(2026, 3, 27, 18, 0), 'Bruno')).toBe('Good evening, Bruno')
        expect(getGreeting(new Date(2026, 3, 27, 23, 59), 'Bruno')).toBe('Good evening, Bruno')
    })

    it('treats late night (before 06:00) as evening', () => {
        expect(getGreeting(new Date(2026, 3, 27, 0, 0), 'Bruno')).toBe('Good evening, Bruno')
        expect(getGreeting(new Date(2026, 3, 27, 5, 59), 'Bruno')).toBe('Good evening, Bruno')
    })

    it('returns the greeting without name when name is missing', () => {
        expect(getGreeting(new Date(2026, 3, 27, 10, 0), null)).toBe('Good morning')
        expect(getGreeting(new Date(2026, 3, 27, 10, 0), '')).toBe('Good morning')
    })

    it('returns the English morning greeting at exactly 06:00', () => {
        expect(getGreeting(new Date(2026, 3, 27, 6, 0), 'Bruno')).toBe('Good morning, Bruno')
    })

    it('ignores any locale argument — output is always English', () => {
        // Older call sites / future regressions might pass a locale; it must
        // not flip the copy back to Portuguese.
        expect(getGreeting(new Date(2026, 3, 27, 8, 0), 'Joana', 'pt-BR')).toBe('Good morning, Joana')
        expect(getGreeting(new Date(2026, 3, 27, 8, 0), 'Bruno', 'pt-PT')).toBe('Good morning, Bruno')
    })
})

describe('dashboard hero copy is English-only', () => {
    it('subtitle, synced label, fallback and locale are English', () => {
        expect(getDashboardSubtitle()).toBe("Here's what needs your attention today.")
        expect(getSyncedLabel()).toBe('synced')
        expect(getHeroFallbackGreeting()).toBe('Hello ✨')
        expect(getDashboardLocale()).toBe('en-US')
    })
})
