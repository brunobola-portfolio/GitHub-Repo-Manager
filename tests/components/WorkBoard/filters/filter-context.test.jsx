import { describe, it, expect } from 'vitest'

const { applyFilters } = await import('@/components/WorkBoard/filters/filter-context-helpers')

const items = [
    { repoFullName: 'acme/x', authorLogin: 'alice', labels: ['bug'], openedAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString() },
    { repoFullName: 'acme/y', authorLogin: 'bob',   labels: ['enhancement'], openedAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString() },
    { repoFullName: 'acme/x', authorLogin: 'bob',   labels: ['bug', 'p1'],  openedAt: new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString() },
]

describe('applyFilters', () => {
    it('returns input when no filters are active', () => {
        expect(applyFilters(items, {}).length).toBe(3)
    })

    it('filters by repos (CSV, OR)', () => {
        const r = applyFilters(items, { repos: 'acme/x' })
        expect(r).toHaveLength(2)
        r.forEach(i => expect(i.repoFullName).toBe('acme/x'))
    })

    it('filters by multiple repos (OR)', () => {
        expect(applyFilters(items, { repos: 'acme/x,acme/y' })).toHaveLength(3)
    })

    it('filters by authors', () => {
        const r = applyFilters(items, { authors: 'bob' })
        expect(r).toHaveLength(2)
    })

    it('filters by labels (any match)', () => {
        expect(applyFilters(items, { labels: 'p1' })).toHaveLength(1)
        expect(applyFilters(items, { labels: 'bug' })).toHaveLength(2)
    })

    it('age bucket keeps items younger than the bucket', () => {
        expect(applyFilters(items, { age: '24h' })).toHaveLength(1)  // 12h
        expect(applyFilters(items, { age: '7d' })).toHaveLength(1)   // 12h
        expect(applyFilters(items, { age: '30d' })).toHaveLength(2)  // 12h + 10d
    })

    it('combines filters (AND across dimensions)', () => {
        const r = applyFilters(items, { repos: 'acme/x', labels: 'bug' })
        expect(r).toHaveLength(2)
    })

    it('returns the input untouched for non-array input', () => {
        expect(applyFilters(null, { repos: 'x' })).toBe(null)
        expect(applyFilters(undefined, { repos: 'x' })).toBe(undefined)
    })
})
