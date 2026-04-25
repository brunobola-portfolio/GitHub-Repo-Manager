import { describe, it, expect } from 'vitest'
import { buildRepoDetailCommands } from '../../../src/components/CommandPalette/repoDetailCommands'

describe('buildRepoDetailCommands', () => {
    it('returns empty for nullish or unnamed repo', () => {
        expect(buildRepoDetailCommands(null)).toEqual([])
        expect(buildRepoDetailCommands(undefined)).toEqual([])
        expect(buildRepoDetailCommands({})).toEqual([])
    })

    it('emits an Open on GitHub command when html_url is present', () => {
        const items = buildRepoDetailCommands({ full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' })
        const open = items.find(i => i.kind === 'open-external')
        expect(open).toBeTruthy()
        expect(open.url).toBe('https://github.com/owner/repo')
    })

    it('emits separate copy commands for HTTPS and SSH clone URLs', () => {
        const items = buildRepoDetailCommands({
            full_name: 'owner/repo',
            clone_url: 'https://github.com/owner/repo.git',
            ssh_url: 'git@github.com:owner/repo.git',
        })
        const copies = items.filter(i => i.kind === 'copy')
        expect(copies).toHaveLength(2)
        expect(copies.map(c => c.text)).toEqual(expect.arrayContaining([
            'https://github.com/owner/repo.git',
            'git@github.com:owner/repo.git',
        ]))
    })

    it('emits one command per detail tab', () => {
        const items = buildRepoDetailCommands({ full_name: 'a/b' })
        const tabs = items.filter(i => i.event === 'repo-detail:go-tab').map(i => i.tab)
        expect(tabs).toEqual(expect.arrayContaining(['overview', 'branches', 'releases', 'issues', 'pulls', 'settings']))
    })

    it('emits a security audit command', () => {
        const items = buildRepoDetailCommands({ full_name: 'a/b' })
        expect(items.find(i => i.event === 'repo-detail:run-audit')).toBeTruthy()
    })

    it('produces unique ids across the whole list', () => {
        const items = buildRepoDetailCommands({
            full_name: 'a/b',
            html_url: 'https://x',
            clone_url: 'https://y',
            ssh_url: 'git@z',
        })
        const ids = new Set(items.map(i => i.id))
        expect(ids.size).toBe(items.length)
    })
})
