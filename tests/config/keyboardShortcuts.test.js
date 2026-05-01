import { describe, it, expect } from 'vitest'
import {
    GLOBAL_SHORTCUTS,
    collectRegistryShortcuts,
    getAllShortcuts,
} from '../../src/config/keyboardShortcuts'

describe('GLOBAL_SHORTCUTS', () => {
    it('exposes the 8 historic global / navigation shortcuts', () => {
        const keys = GLOBAL_SHORTCUTS.map(s => s.key)
        expect(keys).toEqual(expect.arrayContaining(['/', 'n', 'i', 'g', '?', 'd', 'r', 't']))
        expect(GLOBAL_SHORTCUTS).toHaveLength(8)
    })

    it('every entry declares a non-empty action handler key', () => {
        for (const s of GLOBAL_SHORTCUTS) {
            expect(typeof s.action).toBe('string')
            expect(s.action.length).toBeGreaterThan(0)
        }
    })

    it('scopes are limited to global or navigation', () => {
        for (const s of GLOBAL_SHORTCUTS) {
            expect(['global', 'navigation']).toContain(s.scope)
        }
    })

    it('is frozen so callers cannot mutate the canonical catalog', () => {
        expect(Object.isFrozen(GLOBAL_SHORTCUTS)).toBe(true)
    })
})

describe('collectRegistryShortcuts', () => {
    it('returns [] today since no registry action declares a keyboardShortcut', () => {
        // The field is reserved; once an action declares
        // `keyboardShortcut: { key, description }`, this should pick it up.
        // This test will deliberately fail once the first action is added,
        // signalling that the help modal needs to render its new group.
        expect(collectRegistryShortcuts()).toEqual([])
    })
})

describe('getAllShortcuts', () => {
    it('returns the union of global + registry shortcuts', () => {
        const all = getAllShortcuts()
        expect(all.length).toBe(GLOBAL_SHORTCUTS.length + collectRegistryShortcuts().length)
        // Global ones come first.
        for (let i = 0; i < GLOBAL_SHORTCUTS.length; i++) {
            expect(all[i].key).toBe(GLOBAL_SHORTCUTS[i].key)
        }
    })
})
