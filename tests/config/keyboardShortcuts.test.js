import { describe, it, expect } from 'vitest'
import {
    GLOBAL_SHORTCUTS,
    NAVIGATION_CHORDS,
    DOCS_ONLY_SHORTCUTS,
    WORKBOARD_SHORTCUTS,
    PRREVIEW_SHORTCUTS,
    WIZARD_SHORTCUTS,
    collectRegistryShortcuts,
    getAllShortcuts,
} from '../../src/config/keyboardShortcuts'

describe('GLOBAL_SHORTCUTS', () => {
    it('exposes the 5 single-keystroke global shortcuts (chords moved to NAVIGATION_CHORDS)', () => {
        const keys = GLOBAL_SHORTCUTS.map(s => s.key)
        expect(keys).toEqual(expect.arrayContaining(['/', 'n', 'i', '`', '?']))
        expect(GLOBAL_SHORTCUTS).toHaveLength(5)
    })

    it('does not bind bare d/r/t/g any more — navigation moved to the g-chord', () => {
        const keys = GLOBAL_SHORTCUTS.map(s => s.key)
        expect(keys).not.toContain('d')
        expect(keys).not.toContain('r')
        expect(keys).not.toContain('t')
        expect(keys).not.toContain('g')
    })

    it('every entry declares a non-empty action handler key', () => {
        for (const s of GLOBAL_SHORTCUTS) {
            expect(typeof s.action).toBe('string')
            expect(s.action.length).toBeGreaterThan(0)
        }
    })

    it('scope is always global', () => {
        for (const s of GLOBAL_SHORTCUTS) {
            expect(s.scope).toBe('global')
        }
    })

    it('is frozen so callers cannot mutate the canonical catalog', () => {
        expect(Object.isFrozen(GLOBAL_SHORTCUTS)).toBe(true)
    })
})

describe('NAVIGATION_CHORDS', () => {
    it('exposes the 5 g-prefixed navigation chords', () => {
        expect(NAVIGATION_CHORDS).toHaveLength(5)
        const follows = NAVIGATION_CHORDS.map(c => c.keys[1])
        expect(follows).toEqual(expect.arrayContaining(['d', 'r', 'w', 't', 'p']))
    })

    it('every chord starts with the g prefix, carries a 2-key sequence and a scope:navigation action', () => {
        for (const c of NAVIGATION_CHORDS) {
            expect(c.keys[0]).toBe('g')
            expect(c.keys).toHaveLength(2)
            expect(c.scope).toBe('navigation')
            expect(typeof c.action).toBe('string')
            expect(c.action.length).toBeGreaterThan(0)
        }
    })

    it('is frozen', () => {
        expect(Object.isFrozen(NAVIGATION_CHORDS)).toBe(true)
    })
})

describe('collectRegistryShortcuts', () => {
    it('returns [] today since no registry action declares a keyboardShortcut', () => {
        // The field is reserved; once an action declares
        // `keyboardShortcut: { key, description }`, this should pick it up.
        // This test will deliberately fail once the first action is added,
        // signalling that the help dialog needs to render its new group.
        expect(collectRegistryShortcuts()).toEqual([])
    })

    it('would tag collected entries scope:repos / group:Actions (documented contract, exercised once a registry action opts in)', () => {
        // No live fixture today (see test above) — this locks the shape so a
        // future contributor adding `keyboardShortcut` to a repoAction knows
        // what collectRegistryShortcuts is expected to emit.
        expect(collectRegistryShortcuts()).toEqual([])
    })
})

describe('DOCS_ONLY_SHORTCUTS', () => {
    it('documents Ctrl+K and the Live Inbox shortcuts', () => {
        const keys = DOCS_ONLY_SHORTCUTS.map(s => s.key)
        expect(keys).toEqual(expect.arrayContaining(['Ctrl+K', 'e', 's']))
    })

    it('documents j/k/Enter row navigation for both repos and inbox scopes', () => {
        const repos = DOCS_ONLY_SHORTCUTS.filter(s => s.scope === 'repos')
        const inbox = DOCS_ONLY_SHORTCUTS.filter(s => s.scope === 'inbox')
        for (const scoped of [repos, inbox]) {
            expect(scoped.map(s => s.key)).toEqual(expect.arrayContaining(['j', 'k', 'Enter']))
        }
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

describe('WORKBOARD_SHORTCUTS', () => {
    it('scopes every entry to workBoard with no action (executed by WorkBoardPage itself)', () => {
        expect(WORKBOARD_SHORTCUTS.length).toBeGreaterThan(0)
        for (const s of WORKBOARD_SHORTCUTS) {
            expect(s.scope).toBe('workBoard')
            expect(s.action).toBeUndefined()
        }
    })

    it('is frozen', () => {
        expect(Object.isFrozen(WORKBOARD_SHORTCUTS)).toBe(true)
    })
})

describe('PRREVIEW_SHORTCUTS', () => {
    it('scopes every entry to prReview with no action', () => {
        expect(PRREVIEW_SHORTCUTS.length).toBeGreaterThan(0)
        for (const s of PRREVIEW_SHORTCUTS) {
            expect(s.scope).toBe('prReview')
            expect(s.action).toBeUndefined()
        }
    })

    it('is frozen', () => {
        expect(Object.isFrozen(PRREVIEW_SHORTCUTS)).toBe(true)
    })
})

describe('WIZARD_SHORTCUTS', () => {
    it('scopes every entry to wizard with no action', () => {
        expect(WIZARD_SHORTCUTS.length).toBeGreaterThan(0)
        for (const s of WIZARD_SHORTCUTS) {
            expect(s.scope).toBe('wizard')
            expect(s.action).toBeUndefined()
        }
    })

    it('is frozen', () => {
        expect(Object.isFrozen(WIZARD_SHORTCUTS)).toBe(true)
    })
})

describe('getAllShortcuts', () => {
    it('returns the union of every catalog array', () => {
        const all = getAllShortcuts()
        expect(all.length).toBe(
            GLOBAL_SHORTCUTS.length +
            NAVIGATION_CHORDS.length +
            DOCS_ONLY_SHORTCUTS.length +
            WORKBOARD_SHORTCUTS.length +
            PRREVIEW_SHORTCUTS.length +
            WIZARD_SHORTCUTS.length +
            collectRegistryShortcuts().length,
        )
        // Global ones come first.
        for (let i = 0; i < GLOBAL_SHORTCUTS.length; i++) {
            expect(all[i].key).toBe(GLOBAL_SHORTCUTS[i].key)
        }
    })

    it('covers every scope the help dialog groups by', () => {
        const scopes = new Set(getAllShortcuts().map(s => s.scope))
        for (const scope of ['global', 'navigation', 'repos', 'inbox', 'workBoard', 'prReview', 'wizard']) {
            expect(scopes.has(scope)).toBe(true)
        }
    })
})
