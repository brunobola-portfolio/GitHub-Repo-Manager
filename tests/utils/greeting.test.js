import { describe, it, expect } from 'vitest'

const { getGreeting } = await import('../../src/utils/greeting')

describe('getGreeting', () => {
    it('returns morning greeting before 12:00', () => {
        expect(getGreeting(new Date(2026, 3, 27, 8, 0), 'Bruno')).toBe('Bom dia, Bruno')
        expect(getGreeting(new Date(2026, 3, 27, 11, 59), 'Bruno')).toBe('Bom dia, Bruno')
    })

    it('returns afternoon greeting between 12:00 and 17:59', () => {
        expect(getGreeting(new Date(2026, 3, 27, 12, 0), 'Bruno')).toBe('Boa tarde, Bruno')
        expect(getGreeting(new Date(2026, 3, 27, 17, 59), 'Bruno')).toBe('Boa tarde, Bruno')
    })

    it('returns evening greeting from 18:00 onwards', () => {
        expect(getGreeting(new Date(2026, 3, 27, 18, 0), 'Bruno')).toBe('Boa noite, Bruno')
        expect(getGreeting(new Date(2026, 3, 27, 23, 59), 'Bruno')).toBe('Boa noite, Bruno')
    })

    it('returns evening greeting before 6:00 (late night)', () => {
        expect(getGreeting(new Date(2026, 3, 27, 0, 0), 'Bruno')).toBe('Boa noite, Bruno')
        expect(getGreeting(new Date(2026, 3, 27, 5, 59), 'Bruno')).toBe('Boa noite, Bruno')
    })

    it('returns greeting without name when name is missing', () => {
        expect(getGreeting(new Date(2026, 3, 27, 10, 0), null)).toBe('Bom dia')
        expect(getGreeting(new Date(2026, 3, 27, 10, 0), '')).toBe('Bom dia')
    })

    it('returns morning greeting at exactly 06:00', () => {
        expect(getGreeting(new Date(2026, 3, 27, 6, 0), 'Bruno')).toBe('Bom dia, Bruno')
    })
})
