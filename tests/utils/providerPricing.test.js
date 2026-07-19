import { describe, it, expect } from 'vitest'
import { pricingTier, PRICING_TIER_CLS, getPricingForModel, PRICING_LAST_UPDATED } from '../../src/utils/providerPricing'

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
        expect(PRICING_TIER_CLS.cheap).toBe('text-emerald-600 dark:text-emerald-300')
        expect(PRICING_TIER_CLS.mid).toBe('text-slate-600 dark:text-slate-300')
        expect(PRICING_TIER_CLS.premium).toBe('text-rose-500 dark:text-rose-300')
    })
})

describe('July 2026 model catalog refresh (P1.3)', () => {
    it('prices the newly added current-generation models (verified against official provider docs)', () => {
        expect(getPricingForModel('gemini-3.5-flash')).toEqual({ input: 1.50, output: 9.00, currency: 'USD', per: '1M tokens' })
        expect(getPricingForModel('claude-sonnet-5')).toEqual({ input: 2.00, output: 10.00, currency: 'USD', per: '1M tokens' })
        expect(getPricingForModel('claude-opus-4-8')).toEqual({ input: 5.00, output: 25.00, currency: 'USD', per: '1M tokens' })
        expect(getPricingForModel('gpt-5.6-sol')).toEqual({ input: 5.00, output: 30.00, currency: 'USD', per: '1M tokens' })
        expect(getPricingForModel('gpt-5.6-terra')).toEqual({ input: 2.50, output: 15.00, currency: 'USD', per: '1M tokens' })
        expect(getPricingForModel('gpt-5.6-luna')).toEqual({ input: 1.00, output: 6.00, currency: 'USD', per: '1M tokens' })
    })

    it('still prices legacy models kept in the catalog (unchanged rates)', () => {
        expect(getPricingForModel('gemini-2.5-flash')).toEqual({ input: 0.30, output: 2.50, currency: 'USD', per: '1M tokens' })
        expect(getPricingForModel('claude-sonnet-4-6')).toEqual({ input: 3.00, output: 15.00, currency: 'USD', per: '1M tokens' })
    })

    it('bumps PRICING_LAST_UPDATED to a valid, current-looking date', () => {
        expect(PRICING_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(Number.isNaN(Date.parse(PRICING_LAST_UPDATED))).toBe(false)
    })
})
