import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useViewportSafeHeight } from '@/hooks/useViewportSafeHeight'

const originalVV = Object.getOwnPropertyDescriptor(window, 'visualViewport')

afterEach(() => {
	if (originalVV) Object.defineProperty(window, 'visualViewport', originalVV)
	else delete window.visualViewport
})

function setInnerHeight(value) {
	Object.defineProperty(window, 'innerHeight', { value, configurable: true })
}

describe('useViewportSafeHeight', () => {
	it('returns innerHeight when visualViewport is undefined', () => {
		setInnerHeight(800)
		Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true })
		const { result } = renderHook(() => useViewportSafeHeight())
		expect(result.current).toBe(800)
	})

	it('returns visualViewport.height when present', () => {
		setInnerHeight(800)
		Object.defineProperty(window, 'visualViewport', {
			value: { height: 650, addEventListener: vi.fn(), removeEventListener: vi.fn() },
			configurable: true,
		})
		const { result } = renderHook(() => useViewportSafeHeight())
		expect(result.current).toBe(650)
	})

	it('updates when visualViewport resize fires', () => {
		setInnerHeight(800)
		const listeners = new Map()
		const vv = {
			height: 650,
			addEventListener: vi.fn((evt, cb) => { listeners.set(evt, cb) }),
			removeEventListener: vi.fn(),
		}
		Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })

		const { result } = renderHook(() => useViewportSafeHeight())
		expect(result.current).toBe(650)

		act(() => {
			vv.height = 720
			listeners.get('resize')?.()
		})
		expect(result.current).toBe(720)
	})

	it('cleans up the resize listener on unmount', () => {
		setInnerHeight(800)
		const remove = vi.fn()
		Object.defineProperty(window, 'visualViewport', {
			value: { height: 650, addEventListener: vi.fn(), removeEventListener: remove },
			configurable: true,
		})

		const { unmount } = renderHook(() => useViewportSafeHeight())
		unmount()
		expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
	})
})
