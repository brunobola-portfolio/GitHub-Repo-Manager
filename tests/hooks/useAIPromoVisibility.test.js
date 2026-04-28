import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

beforeEach(() => {
    localStorage.clear()
})

const { useAIPromoVisibility } = await import('../../src/hooks/useAIPromoVisibility')

describe('useAIPromoVisibility', () => {
    it('returns true when no flags are set and repos exist', () => {
        const { result } = renderHook(() => useAIPromoVisibility({ reposCount: 2 }))
        expect(result.current).toBe(true)
    })

    it('returns false when explicitly dismissed', () => {
        localStorage.setItem('ai-promo-dismissed', 'true')
        const { result } = renderHook(() => useAIPromoVisibility({ reposCount: 2 }))
        expect(result.current).toBe(false)
    })

    it('returns false when assistant has been opened 3+ times', () => {
        localStorage.setItem('ai-assistant-opened-count', '3')
        const { result } = renderHook(() => useAIPromoVisibility({ reposCount: 2 }))
        expect(result.current).toBe(false)
    })

    it('returns true when assistant has been opened 2 times', () => {
        localStorage.setItem('ai-assistant-opened-count', '2')
        const { result } = renderHook(() => useAIPromoVisibility({ reposCount: 2 }))
        expect(result.current).toBe(true)
    })

    it('returns false when insights have been viewed', () => {
        localStorage.setItem('ai-insights-viewed', 'true')
        const { result } = renderHook(() => useAIPromoVisibility({ reposCount: 2 }))
        expect(result.current).toBe(false)
    })

    it('returns false when reposCount is 0', () => {
        const { result } = renderHook(() => useAIPromoVisibility({ reposCount: 0 }))
        expect(result.current).toBe(false)
    })
})
