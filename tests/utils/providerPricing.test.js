import { describe, it, expect } from 'vitest'
import { pricingTier, PRICING_TIER_CLS } from '../../src/utils/providerPricing'

describe('pricingTier', () => {
    it('returns "cheap" when output is at or below $5/M', () => {
        expect(pricingTier({ output: 0.40 })).toBe('cheap')
        expect(pricingTier({ output: 5 })).toBe('cheap')
    })

    it('returns "mid" when output is between $5 and $30/M (exclusive lower, inclusive upper)', () => {
        expect(pricingTier({ output: 5.01 })).toBe('mid')
        expect(pricingTier({ output: 15 })).toBe('mid')
        expect(pricingTier({ output: 30 })).toBe('mid')
    })

    it('returns "premium" when output exceeds $30/M', () => {
        expect(pricingTier({ output: 30.01 })).toBe('premium')
        expect(pricingTier({ output: 180 })).toBe('premium')
    })

    it('returns null when pricing is missing or has no output', () => {
        expect(pricingTier(null)).toBeNull()
        expect(pricingTier(undefined)).toBeNull()
        expect(pricingTier({ input: 1 })).toBeNull()
    })

    it('exposes a tailwind class per tier in PRICING_TIER_CLS', () => {
        expect(PRICING_TIER_CLS.cheap).toContain('emerald')
        expect(PRICING_TIER_CLS.mid).toContain('slate')
        expect(PRICING_TIER_CLS.premium).toContain('rose')
    })
})
