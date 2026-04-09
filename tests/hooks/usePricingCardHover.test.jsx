import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { render } from '@testing-library/react'
import {
	usePricingCardHover,
	PricingCardHoverLayers,
	TIER_ACCENTS,
} from '@/hooks/usePricingCardHover'

// Mock framer-motion's useReducedMotion so we control it per test.
vi.mock('framer-motion', async () => {
	const actual = await vi.importActual('framer-motion')
	return { ...actual, useReducedMotion: vi.fn(() => false) }
})

import { useReducedMotion } from 'framer-motion'

describe('TIER_ACCENTS', () => {
	it('has all three tiers with expected shape', () => {
		for (const tier of ['free', 'pro', 'enterprise']) {
			expect(TIER_ACCENTS[tier]).toBeDefined()
			expect(TIER_ACCENTS[tier]).toHaveProperty('primary')
			expect(TIER_ACCENTS[tier]).toHaveProperty('secondary')
			expect(TIER_ACCENTS[tier]).toHaveProperty('spotlight')
			expect(TIER_ACCENTS[tier]).toHaveProperty('shadowClass')
		}
	})
})

describe('usePricingCardHover', () => {
	beforeEach(() => {
		useReducedMotion.mockReturnValue(false)
	})
	afterEach(() => {
		vi.clearAllMocks()
	})

	it('initializes with isHovered=false and hoverKey=0', () => {
		const { result } = renderHook(() => usePricingCardHover({ tier: 'pro' }))
		expect(result.current.isHovered).toBe(false)
		expect(result.current.hoverKey).toBe(0)
	})

	it('sets isHovered=true and bumps hoverKey on mouse enter', () => {
		const { result } = renderHook(() => usePricingCardHover({ tier: 'pro' }))
		act(() => {
			result.current.handlers.onMouseEnter()
		})
		expect(result.current.isHovered).toBe(true)
		expect(result.current.hoverKey).toBe(1)
		act(() => {
			result.current.handlers.onMouseEnter()
		})
		expect(result.current.hoverKey).toBe(2)
	})

	it('sets isHovered=false on mouse leave', () => {
		const { result } = renderHook(() => usePricingCardHover({ tier: 'pro' }))
		act(() => { result.current.handlers.onMouseEnter() })
		act(() => { result.current.handlers.onMouseLeave() })
		expect(result.current.isHovered).toBe(false)
	})

	it('exposes the correct accent for the tier argument', () => {
		const { result: free } = renderHook(() => usePricingCardHover({ tier: 'free' }))
		const { result: pro } = renderHook(() => usePricingCardHover({ tier: 'pro' }))
		const { result: ent } = renderHook(() => usePricingCardHover({ tier: 'enterprise' }))
		expect(free.current.accent).toBe(TIER_ACCENTS.free)
		expect(pro.current.accent).toBe(TIER_ACCENTS.pro)
		expect(ent.current.accent).toBe(TIER_ACCENTS.enterprise)
	})

	it('returns reducedMotion=true when framer-motion signals reduced motion', () => {
		useReducedMotion.mockReturnValue(true)
		const { result } = renderHook(() => usePricingCardHover({ tier: 'pro' }))
		expect(result.current.reducedMotion).toBe(true)
	})

	it('has no effect from onMouseMove when reducedMotion is true', () => {
		useReducedMotion.mockReturnValue(true)
		const { result } = renderHook(() => usePricingCardHover({ tier: 'pro' }))
		const fakeEl = { style: { setProperty: vi.fn() }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 400 }) }
		result.current.cardRef.current = fakeEl
		act(() => {
			result.current.handlers.onMouseMove({ clientX: 150, clientY: 200 })
		})
		expect(fakeEl.style.setProperty).not.toHaveBeenCalled()
	})

	it('updates --mx and --my CSS vars on mouse move when motion is enabled', () => {
		const { result } = renderHook(() => usePricingCardHover({ tier: 'pro' }))
		const fakeEl = { style: { setProperty: vi.fn() }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 400 }) }
		result.current.cardRef.current = fakeEl
		act(() => {
			result.current.handlers.onMouseMove({ clientX: 150, clientY: 200 })
		})
		expect(fakeEl.style.setProperty).toHaveBeenCalledWith('--mx', '50%')
		expect(fakeEl.style.setProperty).toHaveBeenCalledWith('--my', '50%')
	})
})

describe('PricingCardHoverLayers', () => {
	it('renders the spotlight layer when motion is enabled', () => {
		useReducedMotion.mockReturnValue(false)
		render(
			<div style={{ position: 'relative' }}>
				<PricingCardHoverLayers tier="pro" isHovered={false} hoverKey={0} reducedMotion={false} />
			</div>
		)
		expect(document.querySelector('[data-pricing-hover-layer="spotlight"]')).toBeTruthy()
	})

	it('does NOT render the spotlight layer when reducedMotion is true', () => {
		render(
			<div style={{ position: 'relative' }}>
				<PricingCardHoverLayers tier="pro" isHovered={false} hoverKey={0} reducedMotion={true} />
			</div>
		)
		expect(document.querySelector('[data-pricing-hover-layer="spotlight"]')).toBeNull()
	})
})
