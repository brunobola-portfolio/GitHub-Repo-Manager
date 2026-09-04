import { describe, it, expect } from 'vitest'
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

// G8 (command palette drill-down): this adapter used to enumerate action ×
// repo, capped at `reposLimit` (default 3), so the palette could only ever
// act on the first few repos. It is now a plain repo picker — one item per
// repo, uncapped — and selecting one pushes CommandPalette's second-level
// "scoped" mode, which enumerates the FULL action list for that one repo via
// buildRepoActionCommands([repo], ctx) directly (see CommandPalette.jsx).
describe('buildRepoActionsCommands', () => {
    it('returns [] when repos is empty or missing', () => {
        expect(buildRepoActionsCommands([])).toEqual([])
        expect(buildRepoActionsCommands(null)).toEqual([])
        expect(buildRepoActionsCommands(undefined)).toEqual([])
    })

    it('emits one picker item per repo, kind:"drill", carrying the repo object', () => {
        const repos = [mkRepo(1, 'octocat/hello'), mkRepo(2, 'octocat/world')]
        const items = buildRepoActionsCommands(repos)

        expect(items).toHaveLength(2)
        for (const item of items) {
            expect(item.kind).toBe('drill')
            expect(item.repo).toBeTruthy()
            expect(item.searchValue).toContain(item.repo.full_name)
        }
        expect(items[0].label).toBe('octocat/hello')
        expect(items[0].repo).toBe(repos[0])
        expect(items[1].label).toBe('octocat/world')
        expect(items[1].repo).toBe(repos[1])
    })

    it('does not cap the number of repos enumerated — capping is the caller\'s job (displayRepos)', () => {
        const repos = Array.from({ length: 8 }, (_, i) => mkRepo(i + 1, `org/r${i + 1}`))
        const items = buildRepoActionsCommands(repos)
        expect(items).toHaveLength(8)
    })

    it('gives each item a stable, unique id keyed by repo id', () => {
        const repos = [mkRepo(1, 'a/b'), mkRepo(2, 'c/d')]
        const items = buildRepoActionsCommands(repos)
        expect(items.map((i) => i.id)).toEqual(['repo-actions-picker::1', 'repo-actions-picker::2'])
        expect(new Set(items.map((i) => i.id)).size).toBe(2)
    })
})
