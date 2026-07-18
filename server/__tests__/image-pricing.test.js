// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 6c — image-pricing.js coverage. Confirms the per-model/per-quality
 * flat-cents table resolves real tiered numbers (not a single flattened
 * constant), throws on unknown gemini/openai combos rather than guessing,
 * and marks every OpenRouter result as an estimate.
 */
import { describe, it, expect } from 'vitest'
import { getImageCostCents, IMAGE_PRICING } from '../lib/ai-features/image-pricing.js'

describe('getImageCostCents — gemini', () => {
	it('resolves the flat standard price for a known Gemini image model', () => {
		expect(getImageCostCents('gemini', 'gemini-2.5-flash-image')).toEqual({ cents: 4, estimated: false })
	})

	it('resolves the preview model too', () => {
		expect(getImageCostCents('gemini', 'gemini-3.1-flash-image-preview')).toEqual({ cents: 4, estimated: false })
	})

	it('throws on an unknown gemini model rather than guessing', () => {
		expect(() => getImageCostCents('gemini', 'gemini-4-nonexistent')).toThrow(/unknown model/i)
	})
})

describe('getImageCostCents — openai (tiered, not flattened)', () => {
	it('low/medium/high quality resolve to materially different prices at the same size', () => {
		const low = getImageCostCents('openai', 'gpt-image-1', { quality: 'low', size: '1024x1024' })
		const medium = getImageCostCents('openai', 'gpt-image-1', { quality: 'medium', size: '1024x1024' })
		const high = getImageCostCents('openai', 'gpt-image-1', { quality: 'high', size: '1024x1024' })

		expect(low).toEqual({ cents: 1.1, estimated: false })
		expect(medium).toEqual({ cents: 4.2, estimated: false })
		expect(high).toEqual({ cents: 16.7, estimated: false })

		// The whole point of a tiered table: low and high must not collapse
		// to the same (or a merely-averaged) number.
		expect(low.cents).toBeLessThan(medium.cents)
		expect(medium.cents).toBeLessThan(high.cents)
		expect(high.cents / low.cents).toBeGreaterThan(10) // ~20x spread per the real pricing this mirrors
	})

	it('a non-square size at the same quality prices differently from the square size', () => {
		const square = getImageCostCents('openai', 'gpt-image-1', { quality: 'medium', size: '1024x1024' })
		const wide = getImageCostCents('openai', 'gpt-image-1', { quality: 'medium', size: '1536x1024' })
		expect(wide.cents).toBeGreaterThan(square.cents)
	})

	it('throws on an unknown quality for a known model', () => {
		expect(() => getImageCostCents('openai', 'gpt-image-1', { quality: 'ultra', size: '1024x1024' }))
			.toThrow(/unknown quality/i)
	})

	it('throws on an unknown size for a known quality', () => {
		expect(() => getImageCostCents('openai', 'gpt-image-1', { quality: 'low', size: '4096x4096' }))
			.toThrow(/unknown size/i)
	})

	it('throws on an unknown openai model', () => {
		expect(() => getImageCostCents('openai', 'gpt-image-99', { quality: 'low', size: '1024x1024' }))
			.toThrow(/unknown model/i)
	})
})

describe('getImageCostCents — openrouter (pass-through, always an estimate)', () => {
	it('a known routed model id still returns estimated: true', () => {
		const out = getImageCostCents('openrouter', 'google/gemini-2.5-flash-image')
		expect(out.estimated).toBe(true)
		expect(out.cents).toBeGreaterThan(0)
	})

	it('an unrecognised model id falls back to the documented estimate instead of throwing', () => {
		const out = getImageCostCents('openrouter', 'some-vendor/brand-new-image-model')
		expect(out.estimated).toBe(true)
		expect(out.cents).toBeGreaterThan(0)
	})
})

describe('getImageCostCents — invalid inputs', () => {
	it('throws when provider is missing', () => {
		expect(() => getImageCostCents(undefined, 'gpt-image-1')).toThrow(/provider is required/i)
	})

	it('throws when model is missing', () => {
		expect(() => getImageCostCents('openai', undefined)).toThrow(/model is required/i)
	})

	it('throws for a provider with no pricing table at all (e.g. anthropic — never image-capable)', () => {
		expect(() => getImageCostCents('anthropic', 'claude-opus-4-5')).toThrow(/not image-capable/i)
	})
})

describe('IMAGE_PRICING table shape', () => {
	it('is frozen so accidental runtime mutation is caught', () => {
		expect(Object.isFrozen(IMAGE_PRICING)).toBe(true)
	})

	it('openai gpt-image-1 declares all 3 quality tiers x 3 sizes (9 entries) — no gaps', () => {
		const model = IMAGE_PRICING.openai['gpt-image-1']
		for (const quality of ['low', 'medium', 'high']) {
			for (const size of ['1024x1024', '1024x1536', '1536x1024']) {
				expect(model[quality][size]).toEqual(expect.any(Number))
			}
		}
	})
})
