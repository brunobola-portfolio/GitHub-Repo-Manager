import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHttpShim } from '../../lib/tagging/http-shim.js'

describe('http-shim', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('GET against a baseURL prepends the base', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      text: async () => JSON.stringify({ names: ['a', 'b'] })
    })
    const shim = createHttpShim({ baseURL: 'https://api.example.com' })
    const { data } = await shim.get('/repos/x/y/topics', { headers: { Authorization: 'token T' } })
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/repos/x/y/topics',
      expect.objectContaining({ method: 'GET' })
    )
    expect(data).toEqual({ names: ['a', 'b'] })
  })

  it('PATCH serialises JSON body and sets content-type', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      text: async () => '{}'
    })
    const shim = createHttpShim({ baseURL: 'https://api.example.com' })
    await shim.patch('/repos/x/y', { description: 'new' })
    const init = global.fetch.mock.calls[0][1]
    expect(init.method).toBe('PATCH')
    expect(init.body).toBe(JSON.stringify({ description: 'new' }))
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('throws with err.response.status on non-2xx', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 404, statusText: 'Not Found',
      text: async () => 'not found'
    })
    const shim = createHttpShim()
    await expect(shim.patch('https://x.test/y', {})).rejects.toMatchObject({
      response: { status: 404 }
    })
  })

  it('preserves custom Content-Type when caller provides it', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK', text: async () => '{}' })
    const shim = createHttpShim()
    await shim.patch('https://x.test/y', [{ op: 'add' }], { headers: { 'Content-Type': 'application/json-patch+json' } })
    expect(global.fetch.mock.calls[0][1].headers['Content-Type']).toBe('application/json-patch+json')
  })

  it('passes absolute URLs through unchanged even with baseURL set', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK', text: async () => '{}' })
    const shim = createHttpShim({ baseURL: 'https://api.example.com' })
    await shim.get('https://other.test/abs')
    expect(global.fetch).toHaveBeenCalledWith('https://other.test/abs', expect.anything())
  })
})
