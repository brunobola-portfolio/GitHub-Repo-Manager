import { describe, it, expect } from 'vitest'

const { getGreeting } = await import('../../src/utils/greeting')

describe('getGreeting', () => {
    it('returns Portuguese morning greeting before 12:00 when locale is pt-PT', () => {
        expect(getGreeting(new Date(2026, 3, 27, 8, 0), 'Bruno', 'pt-PT')).toBe('Bom dia, Bruno')
        expect(getGreeting(new Date(2026, 3, 27, 11, 59), 'Bruno', 'pt-PT')).toBe('Bom dia, Bruno')
    })

    it('returns Portuguese afternoon greeting between 12:00 and 17:59 when locale is pt-PT', () => {
        expect(getGreeting(new Date(2026, 3, 27, 12, 0), 'Bruno', 'pt-PT')).toBe('Boa tarde, Bruno')
        expect(getGreeting(new Date(2026, 3, 27, 17, 59), 'Bruno', 'pt-PT')).toBe('Boa tarde, Bruno')
    })

    it('returns Portuguese evening greeting from 18:00 onwards when locale is pt-PT', () => {
        expect(getGreeting(new Date(2026, 3, 27, 18, 0), 'Bruno', 'pt-PT')).toBe('Boa noite, Bruno')
        expect(getGreeting(new Date(2026, 3, 27, 23, 59), 'Bruno', 'pt-PT')).toBe('Boa noite, Bruno')
    })

    it('returns Portuguese evening greeting before 6:00 (late night) when locale is pt-PT', () => {
        expect(getGreeting(new Date(2026, 3, 27, 0, 0), 'Bruno', 'pt-PT')).toBe('Boa noite, Bruno')
        expect(getGreeting(new Date(2026, 3, 27, 5, 59), 'Bruno', 'pt-PT')).toBe('Boa noite, Bruno')
    })

    it('returns greeting without name when name is missing', () => {
        expect(getGreeting(new Date(2026, 3, 27, 10, 0), null, 'pt-PT')).toBe('Bom dia')
        expect(getGreeting(new Date(2026, 3, 27, 10, 0), '', 'pt-PT')).toBe('Bom dia')
    })

    it('returns Portuguese morning greeting at exactly 06:00 when locale is pt-PT', () => {
        expect(getGreeting(new Date(2026, 3, 27, 6, 0), 'Bruno', 'pt-PT')).toBe('Bom dia, Bruno')
    })

    it('returns English greetings for non-pt locales', () => {
        expect(getGreeting(new Date(2026, 3, 27, 8, 0), 'Alex', 'en-US')).toBe('Good morning, Alex')
        expect(getGreeting(new Date(2026, 3, 27, 14, 0), 'Alex', 'en-US')).toBe('Good afternoon, Alex')
        expect(getGreeting(new Date(2026, 3, 27, 20, 0), 'Alex', 'en-US')).toBe('Good evening, Alex')
        expect(getGreeting(new Date(2026, 3, 27, 3, 0), 'Alex', 'en-US')).toBe('Good evening, Alex')
    })

    it('treats pt-BR as Portuguese as well', () => {
        expect(getGreeting(new Date(2026, 3, 27, 8, 0), 'Joana', 'pt-BR')).toBe('Bom dia, Joana')
    })
})
