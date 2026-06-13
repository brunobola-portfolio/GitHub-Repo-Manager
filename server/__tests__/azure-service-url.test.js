import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.AZURE_RETRY_BASE_MS = '1'

const okJson = (body = { value: [], count: 0 }) => ({
  ok: true,
  status: 200,
  headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) },
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(''),
})

const htmlError = (status) => ({
  ok: false,
  status,
  headers: { get: (h) => (h === 'content-type' ? 'text/html' : null) },
  json: () => Promise.resolve(null),
  text: () => Promise.resolve(`<html>${status}</html>`),
})

describe('azure-service URL construction (online + on-prem)', () => {
  beforeEach(() => {
    vi.resetModules()
    globalThis.fetch = vi.fn().mockResolvedValue(okJson())
  })

  async function firstProbeUrl(org, host) {
    const { validatePat } = await import('../azure-service.js')
    await validatePat(org, 'PAT', host)
    return globalThis.fetch.mock.calls[0][0]
  }

  it('dev.azure.com (online) puts the org in the path', async () => {
    const url = await firstProbeUrl('myorg', 'dev.azure.com')
    expect(url).toMatch(/^https:\/\/dev\.azure\.com\/myorg\/_apis\/projects/)
  })

  it('legacy *.visualstudio.com (online) does NOT repeat the account in the path', async () => {
    const url = await firstProbeUrl('brunobola', 'brunobola.visualstudio.com')
    // The account is the subdomain — the path must start straight at /_apis,
    // otherwise every call 404s (the bug this guards).
    expect(url).toMatch(/^https:\/\/brunobola\.visualstudio\.com\/_apis\/projects/)
    expect(url).not.toContain('/brunobola/_apis')
  })

  it('on-prem TFS keeps the collection path (and port)', async () => {
    const url = await firstProbeUrl('tfs/DefaultCollection', 'tfs.corp.com:8080')
    expect(url).toMatch(/^https:\/\/tfs\.corp\.com:8080\/tfs\/DefaultCollection\/_apis\/projects/)
  })

  it('classifies an HTML 404 as "not found", not a PAT problem (status preserved)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(htmlError(404))
    const { validatePat } = await import('../azure-service.js')
    const result = await validatePat('ghost', 'PAT', 'dev.azure.com')
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/not found/i)
    expect(result.error).not.toMatch(/PAT permissions/i)
  })

  it('classifies a 401 as an auth/PAT problem', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(htmlError(401))
    const { validatePat } = await import('../azure-service.js')
    const result = await validatePat('myorg', 'PAT', 'dev.azure.com')
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/PAT permissions/i)
  })
})
