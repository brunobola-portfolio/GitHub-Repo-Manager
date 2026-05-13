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
