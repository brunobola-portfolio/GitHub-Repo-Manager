import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    isNewModel,
    CAPABILITY_ICONS,
    TIER_ORDER,
    getCompletionModels,
} from '../../src/utils/providerModels'

describe('isNewModel', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-05-12T00:00:00Z'))
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('returns true when releasedAt is within 60 days', () => {
        expect(isNewModel('2026-03-14')).toBe(true) // 59 days ago
        expect(isNewModel('2026-05-12')).toBe(true) // today
    })

    it('returns false when releasedAt is exactly 60 days ago or older', () => {
        expect(isNewModel('2026-03-13')).toBe(false) // 60 days ago
        expect(isNewModel('2026-01-01')).toBe(false)
    })

    it('returns false for falsy or invalid values', () => {
        expect(isNewModel(undefined)).toBe(false)
        expect(isNewModel(null)).toBe(false)
        expect(isNewModel('')).toBe(false)
        expect(isNewModel('not-a-date')).toBe(false)
        expect(isNewModel('2026-12-31')).toBe(false) // future date
    })
})

describe('CAPABILITY_ICONS', () => {
    it('exposes vision, tools, json, reasoning entries with label + lucide-react icon name', () => {
        expect(CAPABILITY_ICONS.vision).toMatchObject({ label: expect.any(String), iconName: expect.any(String) })
        expect(CAPABILITY_ICONS.tools).toMatchObject({ label: expect.any(String), iconName: expect.any(String) })
        expect(CAPABILITY_ICONS.json).toMatchObject({ label: expect.any(String), iconName: expect.any(String) })
        expect(CAPABILITY_ICONS.reasoning).toMatchObject({ label: expect.any(String), iconName: expect.any(String) })
    })
})

describe('TIER_ORDER', () => {
    it('lists tiers in display order with legacy last', () => {
        expect(TIER_ORDER).toEqual(['fast', 'balanced', 'smart', 'reasoning', 'open', 'legacy'])
    })
})

describe('getCompletionModels (smoke)', () => {
    it('returns models with the extended schema for known providers', () => {
        const m = getCompletionModels('anthropic')
        expect(m.length).toBeGreaterThan(0)
        // Schema check on one entry — every curated entry has these fields
        const sample = m[0]
        expect(sample).toHaveProperty('id')
        expect(sample).toHaveProperty('label')
        expect(sample).toHaveProperty('tier')
        expect(sample).toHaveProperty('capabilities')
        expect(sample).toHaveProperty('pricing')
        expect(Array.isArray(sample.capabilities)).toBe(true)
    })

    it('marks exactly one model per provider as recommended', () => {
        for (const provider of ['anthropic', 'gemini', 'openai']) {
            const recommended = getCompletionModels(provider).filter((m) => m.recommended)
            expect(recommended.length).toBe(1)
        }
    })
})

describe('July 2026 model catalog refresh (P1.3)', () => {
    it('recommends the current-generation model per provider', () => {
        const recommendedId = (provider) => getCompletionModels(provider).find((m) => m.recommended)?.id
        expect(recommendedId('gemini')).toBe('gemini-3.5-flash')
        expect(recommendedId('anthropic')).toBe('claude-sonnet-5')
        expect(recommendedId('openai')).toBe('gpt-5.6-luna')
    })

    it('demotes gemini-2.5-flash to legacy with an honest deprecation note', () => {
        const entry = getCompletionModels('gemini').find((m) => m.id === 'gemini-2.5-flash')
        expect(entry).toBeTruthy()
        expect(entry.legacy).toBe(true)
        expect(entry.recommended).toBe(false)
        expect(entry.description).toMatch(/deprecated|retire/i)
        expect(entry.description).toMatch(/gemini-3\.5-flash|Gemini 3\.5 Flash/)
    })

    it('demotes the previous-generation Anthropic and OpenAI defaults to legacy', () => {
        const sonnet46 = getCompletionModels('anthropic').find((m) => m.id === 'claude-sonnet-4-6')
        const opus47 = getCompletionModels('anthropic').find((m) => m.id === 'claude-opus-4-7')
        expect(sonnet46.legacy).toBe(true)
        expect(opus47.legacy).toBe(true)

        for (const id of ['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4', 'gpt-5.5', 'gpt-5.4-pro', 'gpt-5.5-pro', 'gpt-4.1']) {
            const entry = getCompletionModels('openai').find((m) => m.id === id)
            expect(entry.legacy, `${id} should be legacy`).toBe(true)
        }
    })

    it('every legacy-flagged model uses the "legacy" tier bucket (required for the picker grouping)', () => {
        for (const provider of ['anthropic', 'gemini', 'openai']) {
            for (const m of getCompletionModels(provider)) {
                if (m.legacy) expect(m.tier).toBe('legacy')
            }
        }
    })
})
