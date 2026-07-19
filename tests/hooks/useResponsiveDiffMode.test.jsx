import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { DiffModeEnum } from '@git-diff-view/react'
import { useResponsiveDiffMode } from '../../src/hooks/useResponsiveDiffMode'

/**
 * Minimal controllable matchMedia — only needs a fixed initial match per
 * query (unlike useMediaQuery.test.jsx's version, no live-toggle needed here).
 */
function installMatchMedia(initialMatches = {}) {
    window.matchMedia = vi.fn((query) => ({
        matches: Boolean(initialMatches[query]),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }))
}

describe('useResponsiveDiffMode', () => {
    afterEach(() => { vi.restoreAllMocks() })

    it('returns Unified below the md breakpoint (mobile)', () => {
        installMatchMedia({ '(max-width: 767px)': true })
        const { result } = renderHook(() => useResponsiveDiffMode())
        expect(result.current).toBe(DiffModeEnum.Unified)
    })

    it('returns Split at/above the md breakpoint (desktop)', () => {
        installMatchMedia({ '(max-width: 767px)': false })
        const { result } = renderHook(() => useResponsiveDiffMode())
        expect(result.current).toBe(DiffModeEnum.Split)
    })
})
