import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchJSON, fetchJSONWithTimeout } from '../../src/utils/aiFetch'

function mockFetch(impl) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchJSON', () => {
  it('returns the parsed body on a 2xx response', async () => {
    mockFetch(async () => ({ status: 200, ok: true, json: async () => ({ hello: 'world' }) }))
    await expect(fetchJSON('/api/x')).resolves.toEqual({ hello: 'world' })
  })

  it('returns null on 204 without parsing', async () => {
    const json = vi.fn()
    mockFetch(async () => ({ status: 204, ok: true, json }))
    await expect(fetchJSON('/api/x')).resolves.toBeNull()
    expect(json).not.toHaveBeenCalled()
  })

  it('throws an Error carrying .status and .code on a non-2xx response', async () => {
    mockFetch(async () => ({ status: 402, ok: false, json: async () => ({ error: 'Quota hit', code: 'QUOTA' }) }))
    await expect(fetchJSON('/api/x')).rejects.toMatchObject({ message: 'Quota hit', status: 402, code: 'QUOTA' })
  })

  it('sends credentials and JSON content-type by default', async () => {
    const fetchSpy = vi.fn(async () => ({ status: 200, ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchSpy)
    await fetchJSON('/api/x', { method: 'POST' })
    expect(fetchSpy).toHaveBeenCalledWith('/api/x', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }))
  })
})

describe('fetchJSONWithTimeout', () => {
  it('returns the body when the request resolves in time', async () => {
    mockFetch(async () => ({ status: 200, ok: true, json: async () => ({ ok: true }) }))
    await expect(fetchJSONWithTimeout('/api/x', {}, { timeoutMs: 1000, label: 'Test' })).resolves.toEqual({ ok: true })
  })

  it('maps an AbortError to a typed AI_TIMEOUT error embedding the label', async () => {
    mockFetch(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) })
    await expect(
      fetchJSONWithTimeout('/api/x', {}, { timeoutMs: 90_000, label: 'AI Deep Review' }),
    ).rejects.toMatchObject({ code: 'AI_TIMEOUT', message: 'AI Deep Review timed out after 90s.' })
  })

  it('re-throws non-abort errors untouched', async () => {
    mockFetch(async () => ({ status: 500, ok: false, json: async () => ({ error: 'boom' }) }))
    await expect(fetchJSONWithTimeout('/api/x', {}, { label: 'X' })).rejects.toMatchObject({ message: 'boom', status: 500 })
  })
})
