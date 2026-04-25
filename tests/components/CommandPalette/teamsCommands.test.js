import { describe, it, expect } from 'vitest'
import { buildTeamsCommands } from '../../../src/components/CommandPalette/teamsCommands'

describe('buildTeamsCommands', () => {
    it('returns Create + Refresh, both event-kind', () => {
        const items = buildTeamsCommands()
        expect(items).toHaveLength(2)
        for (const i of items) {
            expect(i.kind).toBe('event')
            expect(typeof i.event).toBe('string')
        }
    })

    it('produces unique ids', () => {
        const items = buildTeamsCommands()
        const ids = new Set(items.map(i => i.id))
        expect(ids.size).toBe(items.length)
    })
})
