// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const rawItem = (id, title) => ({ id, fields: { 'System.Title': title, 'System.WorkItemType': 'Bug', 'System.State': 'Active' }, relations: [] })
vi.mock('../azure-service.js', async (io) => ({
    ...(await io()),
    fetchWorkItems: vi.fn(async (_org, _project, _pat, ids) => ids.map((id) => rawItem(id, `Item ${id}`))),
}))

const { migrateWorkItems, buildIssueBody, fetchMigratedIssueMap } = await import('../work-item-service.js')

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let created
let existingIssues
beforeEach(() => {
    created = []
    existingIssues = []
    let next = 100
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
        const u = String(url)
        if (u.includes('/_apis/wit/wiql')) return json({ workItems: [{ id: 1 }, { id: 2 }, { id: 3 }] })
        if (u.includes('/labels?')) {
            const page = Number(new URL(u).searchParams.get('page'))
            return json(page === 1 ? [{ name: 'bug' }, { name: 'state: active' }] : [])
        }
        if (u.endsWith('/labels') && init.method === 'POST') return json({}, 201)
        if (u.includes('/issues?state=all')) {
            const page = Number(new URL(u).searchParams.get('page'))
            return json(page === 1 ? existingIssues : [])
        }
        if (u.endsWith('/issues') && init.method === 'POST') {
            const body = JSON.parse(init.body)
            created.push(body)
            return json({ number: next++, html_url: 'x' }, 201)
        }
        throw new Error('unexpected fetch ' + u)
    }))
})
afterEach(() => vi.unstubAllGlobals())

const run = () => migrateWorkItems({ org: 'acme', project: 'web' }, { pat: 'p' }, 'ghp', 'acme', 'web', {})

describe('migrateWorkItems — resumable', () => {
    it('marks every issue it creates with its Azure DevOps id', async () => {
        await run()
        expect(created.map((b) => b.body.split('\n')[0])).toEqual([
            '<!-- ado-work-item:1 -->', '<!-- ado-work-item:2 -->', '<!-- ado-work-item:3 -->',
        ])
    })

    it('skips work items a previous run already turned into issues', async () => {
        existingIssues = [
            { number: 7, body: buildIssueBody({ id: 2, title: 'Item 2', type: 'Bug' }) },
            // Created before the marker existed: only the metadata table.
            { number: 8, body: '## Metadata\n\n| Field | Value |\n|-------|-------|\n| **Source** | Azure DevOps |\n| **Original ID** | 3 |' },
            { number: 9, body: 'a pull request', pull_request: {} },
        ]
        const result = await run()
        expect(created.map((b) => b.title)).toEqual(['Item 1'])
        expect(result).toMatchObject({ issuesCreated: 1, issuesSkipped: 2 })
    })

    it('reports a failed listing instead of re-creating everything', async () => {
        const base = globalThis.fetch
        vi.stubGlobal('fetch', vi.fn(async (url, init) => (String(url).includes('/issues?state=all')
            ? json({ message: 'Bad credentials' }, 401)
            : base(url, init))))
        await expect(run()).rejects.toThrow('Bad credentials')
        expect(created).toEqual([])
    })
})

describe('fetchMigratedIssueMap', () => {
    it('keeps the oldest issue when a past run duplicated one', async () => {
        existingIssues = [
            { number: 12, body: '<!-- ado-work-item:5 -->' },
            { number: 4, body: '<!-- ado-work-item:5 -->' },
        ]
        const map = await fetchMigratedIssueMap('ghp', 'acme', 'web')
        expect(map.get(5)).toBe(4)
    })
})
