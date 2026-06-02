import { describe, it, expect } from 'vitest'
import {
    GLOBAL_SHORTCUTS,
    DOCS_ONLY_SHORTCUTS,
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

describe('DOCS_ONLY_SHORTCUTS', () => {
    it('documents Ctrl+K and the Live Inbox shortcuts', () => {
        const keys = DOCS_ONLY_SHORTCUTS.map(s => s.key)
        expect(keys).toEqual(expect.arrayContaining(['Ctrl+K', 'e', 's']))
    })

    it('carries NO action — these are owned by other surfaces, so the global hook must not dispatch them', () => {
        for (const s of DOCS_ONLY_SHORTCUTS) {
            expect(s.action).toBeUndefined()
        }
    })

    it('is frozen', () => {
        expect(Object.isFrozen(DOCS_ONLY_SHORTCUTS)).toBe(true)
    })
})

describe('getAllShortcuts', () => {
    it('returns the union of global + docs-only + registry shortcuts', () => {
        const all = getAllShortcuts()
        expect(all.length).toBe(
            GLOBAL_SHORTCUTS.length + DOCS_ONLY_SHORTCUTS.length + collectRegistryShortcuts().length,
        )
        // Global ones come first.
        for (let i = 0; i < GLOBAL_SHORTCUTS.length; i++) {
            expect(all[i].key).toBe(GLOBAL_SHORTCUTS[i].key)
        }
    })
})
