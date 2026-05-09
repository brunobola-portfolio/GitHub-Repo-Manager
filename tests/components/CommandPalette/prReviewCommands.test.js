import { describe, it, expect } from 'vitest'
import { buildPRReviewCommands } from '@/components/CommandPalette/prReviewCommands'

describe('buildPRReviewCommands', () => {
    it('returns an array of cmdk command items', () => {
        const items = buildPRReviewCommands()
        expect(Array.isArray(items)).toBe(true)
        expect(items.length).toBeGreaterThan(0)
    })

    it('every item has the required cmdk shape (id, label, searchValue, icon, kind=event, event)', () => {
        const items = buildPRReviewCommands()
        for (const item of items) {
            expect(item.id).toMatch(/^pr-review-/)
            expect(typeof item.label).toBe('string')
            expect(item.label.length).toBeGreaterThan(0)
            expect(typeof item.searchValue).toBe('string')
            expect(typeof item.icon).toBe('string')
            expect(item.kind).toBe('event')
            expect(item.event).toMatch(/^pr-review:/)
        }
    })

    it('exposes the canonical events PRReviewView listens for', () => {
        const events = buildPRReviewCommands().map(c => c.event)
        // Spot-check the load-bearing ones — full enumeration is not the point;
        // catching accidental rename of the wire format is.
        expect(events).toContain('pr-review:toggle-reviewed')
        expect(events).toContain('pr-review:approve')
        expect(events).toContain('pr-review:request-changes')
        expect(events).toContain('pr-review:show-help')
    })
})
