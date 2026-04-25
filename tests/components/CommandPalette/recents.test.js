import { describe, it, expect, beforeEach } from 'vitest'
import {
    readRecents, bumpRecent, clearRecents,
    RECENTS_STORAGE_KEY, RECENTS_MAX_PER_KIND,
} from '../../../src/components/CommandPalette/recents'

describe('recents', () => {
    beforeEach(() => {
        clearRecents()
    })

    it('returns empty when nothing stored', () => {
        expect(readRecents()).toEqual([])
    })

    it('survives malformed JSON in storage', () => {
        window.localStorage.setItem(RECENTS_STORAGE_KEY, '{not json')
        expect(readRecents()).toEqual([])
    })

    it('bumps a new entry to the front with a timestamp', () => {
        const list = bumpRecent({ kind: 'view', id: 'dashboard', label: 'Dashboard' })
        expect(list[0]).toMatchObject({ kind: 'view', id: 'dashboard', label: 'Dashboard' })
        expect(typeof list[0].ts).toBe('number')
    })

    it('moves an existing entry to the front instead of duplicating', () => {
        bumpRecent({ kind: 'view', id: 'a', label: 'A' })
        bumpRecent({ kind: 'view', id: 'b', label: 'B' })
        const list = bumpRecent({ kind: 'view', id: 'a', label: 'A' })
        expect(list[0].id).toBe('a')
        expect(list.filter(e => e.id === 'a')).toHaveLength(1)
    })

    it('caps each kind at MAX_PER_KIND', () => {
        for (let i = 0; i < RECENTS_MAX_PER_KIND + 3; i += 1) {
            bumpRecent({ kind: 'repo', id: `r${i}`, label: `Repo ${i}` })
        }
        const list = readRecents()
        expect(list.filter(e => e.kind === 'repo')).toHaveLength(RECENTS_MAX_PER_KIND)
    })

    it('keeps different kinds independent under the cap', () => {
        for (let i = 0; i < RECENTS_MAX_PER_KIND; i += 1) {
            bumpRecent({ kind: 'repo', id: `r${i}`, label: `Repo ${i}` })
        }
        bumpRecent({ kind: 'view', id: 'dashboard', label: 'Dashboard' })
        const list = readRecents()
        expect(list.filter(e => e.kind === 'view')).toHaveLength(1)
        expect(list.filter(e => e.kind === 'repo')).toHaveLength(RECENTS_MAX_PER_KIND)
    })

    it('ignores invalid entries', () => {
        expect(bumpRecent(null)).toEqual([])
        expect(bumpRecent({ kind: 'view' })).toEqual([])
    })
})
