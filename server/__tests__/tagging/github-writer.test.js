import { describe, it, expect, vi } from 'vitest'
import { createGithubWriter } from '../../lib/tagging/github-writer.js'

function makeApi({ get, put, patch } = {}) {
  return {
    get: get || vi.fn(),
    put: put || vi.fn(),
    patch: patch || vi.fn()
  }
}

describe('githubWriter.setTopics', () => {
  it('merges new topics with existing without duplicates', async () => {
    const api = makeApi({
      get: vi.fn().mockResolvedValue({ data: { names: ['existing', 'foo'] } }),
      put: vi.fn().mockResolvedValue({ data: { names: ['existing', 'foo', 'migrated', 'from-azure'] } })
    })
    const writer = createGithubWriter({ api, token: 't' })
    const res = await writer.setTopics({ owner: 'o', repo: 'r' }, ['migrated', 'from-azure', 'foo'])
    expect(res.status).toBe('written')
    const putArg = api.put.mock.calls[0][1].names
    expect(new Set(putArg).size).toBe(putArg.length)
    expect(putArg).toEqual(expect.arrayContaining(['existing', 'foo', 'migrated', 'from-azure']))
  })

  it('drops optional slug topic when 20-topic cap would be exceeded', async () => {
    const existing = Array.from({ length: 19 }, (_, i) => `t${i}`)
    const api = makeApi({
      get: vi.fn().mockResolvedValue({ data: { names: existing } }),
      put: vi.fn().mockResolvedValue({ data: {} })
    })
    const writer = createGithubWriter({ api, token: 't' })
    const res = await writer.setTopics({ owner: 'o', repo: 'r' }, ['migrated', 'from-azure', 'mig-x'])
    const putArg = api.put.mock.calls[0][1].names
    expect(putArg.length).toBe(20)
    expect(putArg).toContain('migrated')
    expect(putArg).not.toContain('mig-x')
    expect(res.skippedTopics).toEqual(['mig-x'])
    expect(res.skipReason).toBe('topic-limit-reached')
  })

  it('handles 0 existing topics gracefully', async () => {
    const api = makeApi({
      get: vi.fn().mockResolvedValue({ data: { names: [] } }),
      put: vi.fn().mockResolvedValue({ data: {} })
    })
    const writer = createGithubWriter({ api, token: 't' })
    const res = await writer.setTopics({ owner: 'o', repo: 'r' }, ['migrated', 'from-azure', 'mig-x'])
    expect(res.status).toBe('written')
    expect(api.put.mock.calls[0][1].names).toEqual(['migrated', 'from-azure', 'mig-x'])
  })
})

describe('githubWriter.appendDescription', () => {
  it('replaces existing migration suffix to avoid duplication', async () => {
    const api = makeApi({
      get: vi.fn().mockResolvedValue({ data: { description: 'My repo [Migrated from old on 2025-01-01]' } }),
      patch: vi.fn().mockResolvedValue({ data: {} })
    })
    const writer = createGithubWriter({ api, token: 't' })
    await writer.appendDescription({ owner: 'o', repo: 'r' }, ' [Migrated from new on 2026-05-23]')
    const body = api.patch.mock.calls[0][1]
    expect(body.description).toBe('My repo [Migrated from new on 2026-05-23]')
  })

  it('appends to plain description without existing suffix', async () => {
    const api = makeApi({
      get: vi.fn().mockResolvedValue({ data: { description: 'Plain description' } }),
      patch: vi.fn().mockResolvedValue({ data: {} })
    })
    const writer = createGithubWriter({ api, token: 't' })
    await writer.appendDescription({ owner: 'o', repo: 'r' }, ' [Migrated from x on 2026-05-23]')
    expect(api.patch.mock.calls[0][1].description).toBe('Plain description [Migrated from x on 2026-05-23]')
  })

  it('handles null description', async () => {
    const api = makeApi({
      get: vi.fn().mockResolvedValue({ data: { description: null } }),
      patch: vi.fn().mockResolvedValue({ data: {} })
    })
    const writer = createGithubWriter({ api, token: 't' })
    await writer.appendDescription({ owner: 'o', repo: 'r' }, ' [Migrated from x on 2026-05-23]')
    expect(api.patch.mock.calls[0][1].description).toBe('[Migrated from x on 2026-05-23]')
  })
})

describe('githubWriter.setCustomProperty', () => {
  it('returns written when successful', async () => {
    const api = makeApi({
      patch: vi.fn().mockResolvedValue({ data: {} })
    })
    const writer = createGithubWriter({ api, token: 't' })
    const res = await writer.setCustomProperty({ owner: 'org', repo: 'r' }, 'migration_source', 'azure://a/b')
    expect(res.status).toBe('written')
    expect(api.patch).toHaveBeenCalled()
  })

  it('returns skipped with org-policy-blocks-custom-props on 404', async () => {
    const api = makeApi({ patch: vi.fn().mockRejectedValue({ response: { status: 404 } }) })
    const writer = createGithubWriter({ api, token: 't' })
    const res = await writer.setCustomProperty({ owner: 'org', repo: 'r' }, 'migration_source', 'x')
    expect(res.status).toBe('skipped')
    expect(res.skipReason).toBe('org-policy-blocks-custom-props')
  })

  it('returns skipped with personal-account-no-props for personal accounts', async () => {
    const api = makeApi({ patch: vi.fn().mockRejectedValue({ response: { status: 404 } }) })
    const writer = createGithubWriter({ api, token: 't' })
    const res = await writer.setCustomProperty({ owner: 'user', repo: 'r' }, 'migration_source', 'x', { isPersonal: true })
    expect(res.status).toBe('skipped')
    expect(res.skipReason).toBe('personal-account-no-props')
  })

  it('re-throws non-404 errors', async () => {
    const api = makeApi({ patch: vi.fn().mockRejectedValue({ response: { status: 500 } }) })
    const writer = createGithubWriter({ api, token: 't' })
    await expect(writer.setCustomProperty({ owner: 'o', repo: 'r' }, 'k', 'v')).rejects.toMatchObject({ response: { status: 500 } })
  })
})
