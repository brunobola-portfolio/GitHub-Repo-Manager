import { describe, it, expect } from 'vitest'
import { pickRenderStrategy, FOLD_THRESHOLD, COMPUTE_THRESHOLD } from '@/components/PRReview/DiffPanel/diffSize'

describe('pickRenderStrategy', () => {
    it('exports the documented thresholds', () => {
        expect(FOLD_THRESHOLD).toBe(500)
        expect(COMPUTE_THRESHOLD).toBe(50_000)
    })

    it('returns "pass" for files at or below the fold threshold', () => {
        expect(pickRenderStrategy({ additions: 0, deletions: 0 })).toBe('pass')
        expect(pickRenderStrategy({ additions: 250, deletions: 250 })).toBe('pass')
        expect(pickRenderStrategy({ additions: 500, deletions: 0 })).toBe('pass')
    })

    it('returns "collapse" between the fold and compute thresholds', () => {
        expect(pickRenderStrategy({ additions: 501, deletions: 0 })).toBe('collapse')
        expect(pickRenderStrategy({ additions: 5_000, deletions: 4_000 })).toBe('collapse')
        expect(pickRenderStrategy({ additions: 50_000, deletions: 0 })).toBe('collapse')
    })

    it('returns "compute" above the compute threshold', () => {
        expect(pickRenderStrategy({ additions: 50_001, deletions: 0 })).toBe('compute')
        expect(pickRenderStrategy({ additions: 100_000, deletions: 100_000 })).toBe('compute')
    })

    it('treats missing additions/deletions as zero (defensive)', () => {
        expect(pickRenderStrategy({})).toBe('pass')
        expect(pickRenderStrategy(null)).toBe('pass')
        expect(pickRenderStrategy(undefined)).toBe('pass')
    })
})
