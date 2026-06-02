import { describe, it, expect, vi, beforeEach } from 'vitest'

// Speed up backoff so retry tests don't sleep for hundreds of ms. Read at
// module-eval time by azure-service.js, so it must be set before the import.
process.env.AZURE_RETRY_BASE_MS = '1'

const okText = (body) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  text: () => Promise.resolve(body),
  json: () => Promise.resolve({}),
})
const transient = (status) => ({
  ok: false,
  status,
  headers: { get: () => null },
  text: () => Promise.resolve(''),
  json: () => Promise.resolve({ message: `error ${status}` }),
})

describe('azure-service resilience', () => {
  beforeEach(() => {
    vi.resetModules()
    globalThis.fetch = vi.fn()
  })

  it('normalises a TimeoutError into a 504 azure_timeout error (after retrying)', async () => {
    globalThis.fetch.mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
    const { getCommitActivity } = await import('../azure-service.js')
    await expect(getCommitActivity('org', 'proj', 'r1', 'main', 'PAT')).rejects.toMatchObject({
      status: 504,
      code: 'azure_timeout',
    })
    // 1 initial + AZURE_RETRY_ATTEMPTS (2) retries for an idempotent GET.
    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
  })

  it('retries an idempotent GET on 503 and recovers', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(transient(503))
      .mockResolvedValueOnce(okText('*.psd filter=lfs diff=lfs -text'))
    const { checkLfsMarkers } = await import('../azure-service.js')
    const out = await checkLfsMarkers('org', 'proj', [{ id: 'r1' }], 'PAT')
    expect(out.r1).toBe(true)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('passes a timeout signal to fetch', async () => {
    globalThis.fetch.mockResolvedValue(okText('no markers here'))
    const { checkLfsMarkers } = await import('../azure-service.js')
    await checkLfsMarkers('org', 'proj', [{ id: 'r1' }], 'PAT')
    const opts = globalThis.fetch.mock.calls[0][1]
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })

  it('does NOT retry a mutation (DELETE) on 503', async () => {
    globalThis.fetch.mockResolvedValue(transient(503))
    const { deleteGitRepo } = await import('../azure-service.js')
    await expect(deleteGitRepo('org', 'proj', 'r1', 'PAT')).rejects.toThrow(/503/)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})
