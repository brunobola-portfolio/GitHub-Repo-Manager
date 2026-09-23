// @vitest-environment node
/**
 * An on-prem collection can contain "/" ("tfs/DefaultCollection"). A plain
 * split('/') read that as org=tfs, project=DefaultCollection, so every task
 * on such a server addressed the wrong project.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../import-service.js', () => ({ importRepository: vi.fn() }))
vi.mock('../work-item-service.js', () => ({ migrateWorkItems: vi.fn() }))
vi.mock('../wiki-service.js', () => ({ migrateWiki: vi.fn(async () => ({ ok: true })) }))

const { splitSourceRef, runWiki } = await import('../lib/migration/task-runners.js')
const { migrateWiki } = await import('../wiki-service.js')

describe('splitSourceRef', () => {
    it('uses the plan org/project as a known prefix, so a "/" in the collection survives', () => {
        expect(splitSourceRef('tfs/DefaultCollection/Platform/api', { org: 'tfs/DefaultCollection', project: 'Platform' }))
            .toEqual({ org: 'tfs/DefaultCollection', project: 'Platform', rest: 'api' })
    })
    it('keeps a TFVC folder path intact', () => {
        expect(splitSourceRef('Trigenius/ERP/Main/src', { org: 'Trigenius', project: 'ERP' }))
            .toEqual({ org: 'Trigenius', project: 'ERP', rest: 'Main/src' })
    })
    it('falls back to the first two segments without plan context', () => {
        expect(splitSourceRef('acme/proj/repo', null)).toEqual({ org: 'acme', project: 'proj', rest: 'repo' })
    })
})

describe('runWiki', () => {
    it('clones the wiki named by source_ref when the plan predates config.wikiId', async () => {
        await runWiki(
            { source_ref: 'Platform.wiki', config: {} },
            { config: { destination: 'wiki' }, resolvedCredentials: { azurePat: 'p', githubToken: 'g', azureOrg: 'o', azureProject: 'p' }, callbacks: { onProgress: () => {}, isCancelled: () => false }, targetOwner: 'acme', targetRepo: 'api', azureHost: 'dev.azure.com' },
        )
        expect(migrateWiki.mock.calls[0][0].wikiId).toBe('Platform.wiki')
    })
})
