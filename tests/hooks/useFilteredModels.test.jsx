import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'

const { useFilteredModels } = await import('../../src/hooks/useFilteredModels')

const OPTIONS = [
    { id: 'a-fast', label: 'A Fast', tier: 'fast', description: 'fast one', legacy: false },
    { id: 'b-balanced', label: 'B Balanced', tier: 'balanced', description: 'balanced one', legacy: false },
    { id: 'c-smart', label: 'C Smart', tier: 'smart', description: 'smart one', legacy: false },
    { id: 'd-legacy', label: 'D Legacy', tier: 'legacy', description: 'old one', legacy: true },
]

describe('useFilteredModels', () => {
    it('groups options by tier in TIER_ORDER and excludes legacy by default', () => {
        const { result } = renderHook(() => useFilteredModels(OPTIONS, { query: '', tier: null, showLegacy: false }))
        const tiers = result.current.sections.map((s) => s.tier)
        expect(tiers).toEqual(['fast', 'balanced', 'smart'])
        expect(result.current.totalCount).toBe(3)
    })

    it('includes legacy when showLegacy is true', () => {
        const { result } = renderHook(() => useFilteredModels(OPTIONS, { query: '', tier: null, showLegacy: true }))
        const tiers = result.current.sections.map((s) => s.tier)
        expect(tiers).toEqual(['fast', 'balanced', 'smart', 'legacy'])
        expect(result.current.totalCount).toBe(4)
    })

    it('filters by tier when set', () => {
        const { result } = renderHook(() => useFilteredModels(OPTIONS, { query: '', tier: 'fast', showLegacy: false }))
        expect(result.current.sections).toHaveLength(1)
        expect(result.current.sections[0].tier).toBe('fast')
        expect(result.current.sections[0].items).toHaveLength(1)
    })

    it('filters by query against id, label, and description', () => {
        const { result: byId } = renderHook(() => useFilteredModels(OPTIONS, { query: 'a-fast', tier: null, showLegacy: false }))
        expect(byId.current.totalCount).toBe(1)

        const { result: byLabel } = renderHook(() => useFilteredModels(OPTIONS, { query: 'B BAL', tier: null, showLegacy: false }))
        expect(byLabel.current.totalCount).toBe(1)

        const { result: byDesc } = renderHook(() => useFilteredModels(OPTIONS, { query: 'old', tier: null, showLegacy: true }))
        expect(byDesc.current.totalCount).toBe(1)
    })

    it('returns a flat itemsInOrder array matching the rendered order', () => {
        const { result } = renderHook(() => useFilteredModels(OPTIONS, { query: '', tier: null, showLegacy: true }))
        expect(result.current.itemsInOrder.map((o) => o.id)).toEqual(['a-fast', 'b-balanced', 'c-smart', 'd-legacy'])
    })

    it('returns availableTiers (without legacy) for the chip bar', () => {
        const { result } = renderHook(() => useFilteredModels(OPTIONS, { query: '', tier: null, showLegacy: false }))
        expect(result.current.availableTiers).toEqual(['fast', 'balanced', 'smart'])
    })
})
