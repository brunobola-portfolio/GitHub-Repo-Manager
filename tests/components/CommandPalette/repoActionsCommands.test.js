import { describe, it, expect, vi } from 'vitest'
import { buildRepoActionsCommands } from '../../../src/components/CommandPalette/repoActionsCommands'

const mkRepo = (id, fullName) => ({
    id,
    name: fullName.split('/')[1],
    full_name: fullName,
    owner: { login: fullName.split('/')[0] },
    private: false,
    archived: false,
    isMirror: false,
})

describe('buildRepoActionsCommands', () => {
    it('returns [] when repos is empty', () => {
        expect(buildRepoActionsCommands([], {})).toEqual([])
        expect(buildRepoActionsCommands(null, {})).toEqual([])
    })

    it('returns [] when ctx is missing', () => {
        expect(buildRepoActionsCommands([mkRepo(1, 'a/b')], null)).toEqual([])
    })

    it('emits palette items with kind:"run" and a callable run()', () => {
        const repos = [mkRepo(1, 'octocat/hello')]
        const ctx = { openModal: vi.fn(), openModalWithData: vi.fn(), toast: { success: vi.fn() } }
        const items = buildRepoActionsCommands(repos, ctx)

        expect(items.length).toBeGreaterThan(0)
        for (const item of items) {
            expect(item.kind).toBe('run')
            expect(typeof item.run).toBe('function')
            expect(item.searchValue).toContain('octocat/hello')
        }
    })

    it('caps the number of repos enumerated to reposLimit (default 3)', () => {
        const repos = Array.from({ length: 8 }, (_, i) => mkRepo(i + 1, `org/r${i + 1}`))
        const ctx = { openModal: vi.fn(), openModalWithData: vi.fn(), toast: { success: vi.fn() } }
        const items = buildRepoActionsCommands(repos, ctx)

        const distinctRepos = new Set(items.map((i) => i.label.split(' — ')[1]))
        expect(distinctRepos.size).toBeLessThanOrEqual(3)
    })

    it('honours an overridden reposLimit', () => {
        const repos = Array.from({ length: 8 }, (_, i) => mkRepo(i + 1, `org/r${i + 1}`))
        const ctx = { openModal: vi.fn(), openModalWithData: vi.fn(), toast: { success: vi.fn() } }
        const items = buildRepoActionsCommands(repos, ctx, { reposLimit: 5 })

        const distinctRepos = new Set(items.map((i) => i.label.split(' — ')[1]))
        expect(distinctRepos.size).toBeLessThanOrEqual(5)
        expect(distinctRepos.size).toBeGreaterThan(3)
    })

    it('includes Open Details + community_health for every repo (registered as commandPalette surface)', () => {
        const repos = [mkRepo(1, 'octocat/hello')]
        const ctx = { openModal: vi.fn(), openModalWithData: vi.fn(), toast: { success: vi.fn() } }
        const items = buildRepoActionsCommands(repos, ctx)
        const ids = items.map((i) => i.id)

        expect(ids).toContain('open_detail::1')
        expect(ids).toContain('community_health::1')
        expect(ids).toContain('fix_community_health::1')
    })
})
