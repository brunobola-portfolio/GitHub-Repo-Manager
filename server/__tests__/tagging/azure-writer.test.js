import { describe, it, expect, vi } from 'vitest'
import { createAzureWriter } from '../../lib/tagging/azure-writer.js'

function makeApi({ get, patch } = {}) {
  return {
    get: get || vi.fn(),
    patch: patch || vi.fn()
  }
}

describe('azureWriter.patchProjectProperties', () => {
  it('sends JSON-Patch body with the expected operations and headers', async () => {
    const api = makeApi({ patch: vi.fn().mockResolvedValue({ data: {} }) })
    const writer = createAzureWriter({ api, host: 'dev.azure.com', org: 'acme', pat: 'x' })
    const ops = [{ op: 'add', path: '/Migration.PlanId', value: '42' }]
    const res = await writer.patchProjectProperties('proj-id', ops)
    expect(res.status).toBe('written')
    expect(api.patch).toHaveBeenCalledTimes(1)
    const [url, body, config] = api.patch.mock.calls[0]
    expect(url).toContain('/_apis/projects/proj-id/properties')
    expect(url).toContain('api-version=7.1-preview.1')
    expect(body).toEqual(ops)
    expect(config.headers['Content-Type']).toBe('application/json-patch+json')
    expect(config.headers.Authorization).toMatch(/^Basic /)
  })

  it('returns skipped with pat-scope-missing on 401', async () => {
    const api = makeApi({ patch: vi.fn().mockRejectedValue({ response: { status: 401 } }) })
    const writer = createAzureWriter({ api, host: 'dev.azure.com', org: 'acme', pat: 'x' })
    const res = await writer.patchProjectProperties('proj-id', [])
    expect(res.status).toBe('skipped')
    expect(res.skipReason).toBe('pat-scope-missing')
  })

  it('returns skipped with pat-scope-missing on 403', async () => {
    const api = makeApi({ patch: vi.fn().mockRejectedValue({ response: { status: 403 } }) })
    const writer = createAzureWriter({ api, host: 'dev.azure.com', org: 'acme', pat: 'x' })
    const res = await writer.patchProjectProperties('proj-id', [])
    expect(res.skipReason).toBe('pat-scope-missing')
  })

  it('returns skipped with unsupported-source-type on 404', async () => {
    const api = makeApi({ patch: vi.fn().mockRejectedValue({ response: { status: 404 } }) })
    const writer = createAzureWriter({ api, host: 'tfs.local', org: 'acme', pat: 'x' })
    const res = await writer.patchProjectProperties('proj-id', [])
    expect(res.status).toBe('skipped')
    expect(res.skipReason).toBe('unsupported-source-type')
  })

  it('re-throws non-classifiable errors', async () => {
    const api = makeApi({ patch: vi.fn().mockRejectedValue(new Error('network')) })
    const writer = createAzureWriter({ api, host: 'dev.azure.com', org: 'acme', pat: 'x' })
    await expect(writer.patchProjectProperties('p', [])).rejects.toThrow('network')
  })
})

describe('azureWriter.appendRepoDescription', () => {
  it('strips existing migration suffix before appending', async () => {
    const api = makeApi({
      get: vi.fn().mockResolvedValue({ data: { name: 'r', description: 'desc [Migrated from x on 2025-01-01]' } }),
      patch: vi.fn().mockResolvedValue({ data: {} })
    })
    const writer = createAzureWriter({ api, host: 'dev.azure.com', org: 'acme', pat: 'x' })
    await writer.appendRepoDescription({ projectId: 'p', repoId: 'r' }, ' [Migrated from new on 2026-05-23]')
    const body = api.patch.mock.calls[0][1]
    expect(body.description).toBe('desc [Migrated from new on 2026-05-23]')
  })

  it('handles null description', async () => {
    const api = makeApi({
      get: vi.fn().mockResolvedValue({ data: { description: null } }),
      patch: vi.fn().mockResolvedValue({ data: {} })
    })
    const writer = createAzureWriter({ api, host: 'dev.azure.com', org: 'acme', pat: 'x' })
    await writer.appendRepoDescription({ projectId: 'p', repoId: 'r' }, ' [Migrated from x on 2026-05-23]')
    expect(api.patch.mock.calls[0][1].description).toBe('[Migrated from x on 2026-05-23]')
  })

  it('returns skipped on 403', async () => {
    const api = makeApi({
      get: vi.fn().mockRejectedValue({ response: { status: 403 } })
    })
    const writer = createAzureWriter({ api, host: 'dev.azure.com', org: 'acme', pat: 'x' })
    const res = await writer.appendRepoDescription({ projectId: 'p', repoId: 'r' }, ' [Migrated]')
    expect(res.status).toBe('skipped')
    expect(res.skipReason).toBe('pat-scope-missing')
  })
})
