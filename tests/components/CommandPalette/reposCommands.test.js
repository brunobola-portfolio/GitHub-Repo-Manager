import { describe, it, expect } from 'vitest'
import { buildReposCommands } from '../../../src/components/CommandPalette/reposCommands'

describe('buildReposCommands', () => {
    it('emits filter, sort and clear commands', () => {
        const items = buildReposCommands()
        const events = new Set(items.map(i => i.event))
        expect(events.has('repos:set-filter')).toBe(true)
        expect(events.has('repos:sort')).toBe(true)
        expect(events.has('repos:clear-filters')).toBe(true)
    })

    it('every sort command carries a string detail', () => {
        const sorts = buildReposCommands().filter(i => i.event === 'repos:sort')
        expect(sorts.length).toBeGreaterThan(0)
        for (const s of sorts) {
            expect(typeof s.detail).toBe('string')
        }
    })

    it('produces unique ids', () => {
        const items = buildReposCommands()
        const ids = new Set(items.map(i => i.id))
        expect(ids.size).toBe(items.length)
    })
})
