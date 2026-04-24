import { describe, it, expect } from 'vitest'
import { buildAICommands } from '../../../src/components/CommandPalette/aiCommands'

describe('buildAICommands', () => {
    it('returns empty when AI not enabled', () => {
        expect(buildAICommands({ enabled: false })).toEqual([])
    })

    it('returns at least one AI command when enabled', () => {
        const items = buildAICommands({ enabled: true })
        expect(items.length).toBeGreaterThan(0)
        expect(items[0]).toMatchObject({ actionType: expect.any(String), label: expect.any(String) })
    })

    it('each item has a unique id', () => {
        const items = buildAICommands({ enabled: true })
        const ids = new Set(items.map(i => i.id))
        expect(ids.size).toBe(items.length)
    })
})
