import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('listRepoActivity', () => {
  beforeEach(() => {
    vi.resetModules()
    globalThis.fetch = vi.fn()
  })

  it('returns per-repo activity keyed by repoId', async () => {
    globalThis.fetch.mockImplementation((url) => {
      if (url.includes('/repoA/stats/branches')) {
        return Promise.resolve({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({
            value: [{
              name: 'main',
              commit: { committer: { date: '2026-04-10T10:00:00Z', name: 'Alice' } },
            }],
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ value: [] }),
      })
    })
    const { listRepoActivity } = await import('../azure-service.js')
    const out = await listRepoActivity('org', 'proj', [
      { id: 'repoA', defaultBranch: 'refs/heads/main' },
      { id: 'repoB', defaultBranch: '' },
    ], 'PAT')
    expect(out.repoA.lastCommitDate).toBe('2026-04-10T10:00:00Z')
    expect(out.repoA.lastCommitAuthor).toBe('Alice')
    expect(out.repoB.lastCommitDate).toBeNull()
  })

  it('tolerates individual failures', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({}),
    })
    const { listRepoActivity } = await import('../azure-service.js')
    const out = await listRepoActivity('org', 'proj', [{ id: 'r1', defaultBranch: 'refs/heads/main' }], 'PAT')
    expect(out.r1.lastCommitDate).toBeNull()
  })
})
