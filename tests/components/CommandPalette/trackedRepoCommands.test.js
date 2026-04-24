import { describe, it, expect } from 'vitest'
import { buildTrackedRepoCommands } from '../../../src/components/CommandPalette/trackedRepoCommands'

function repo(name, overrides = {}) {
    return { repo_full_name: name, is_pinned: 0, is_muted: 0, ...overrides }
}

describe('buildTrackedRepoCommands', () => {
    it('returns empty array for no repos', () => {
        expect(buildTrackedRepoCommands([])).toEqual([])
    })

    it('emits 3 items per unpinned unmuted repo: Pin, Mute, Untrack', () => {
        const items = buildTrackedRepoCommands([repo('acme/x')])
        expect(items).toHaveLength(3)
        expect(items.map(i => i.actionType).sort()).toEqual(['mute', 'pin', 'untrack'])
    })

    it('shows Unpin instead of Pin for pinned repo', () => {
        const items = buildTrackedRepoCommands([repo('acme/x', { is_pinned: 1 })])
        expect(items.some(i => i.actionType === 'unpin')).toBe(true)
        expect(items.some(i => i.actionType === 'pin')).toBe(false)
    })

    it('shows Unmute instead of Mute for muted repo', () => {
        const items = buildTrackedRepoCommands([repo('acme/x', { is_muted: 1 })])
        expect(items.some(i => i.actionType === 'unmute')).toBe(true)
        expect(items.some(i => i.actionType === 'mute')).toBe(false)
    })

    it('each item has unique id, label includes repo name, and searchValue has verb + repo', () => {
        const items = buildTrackedRepoCommands([repo('acme/x')])
        const ids = new Set(items.map(i => i.id))
        expect(ids.size).toBe(items.length)

        const pin = items.find(i => i.actionType === 'pin')
        expect(pin.label).toContain('acme/x')
        expect(pin.searchValue).toBe('pin acme/x')
        expect(pin.repoFullName).toBe('acme/x')
    })

    it('emits items for all repos in the list (bulk smoke test)', () => {
        const repos = Array.from({ length: 5 }, (_, i) => repo(`org/r${i}`))
        const items = buildTrackedRepoCommands(repos)
        expect(items).toHaveLength(5 * 3)
    })
})
