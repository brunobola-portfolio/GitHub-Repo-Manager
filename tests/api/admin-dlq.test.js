import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fetchWithRetry + safeParseJson via the utils/api module. The admin-dlq
// client imports these by name; we stub them with the same signatures so
// tests control the response without exercising the full retry machinery.
vi.mock('@/utils/api', () => {
  const fetchWithRetry = vi.fn()
  const safeParseJson = async (res) => {
    try { return await res.json() } catch { return null }
  }
  return { fetchWithRetry, safeParseJson }
})

// Import after the mock so the client wires the stub, not the real thing.
const { fetchWithRetry } = await import('@/utils/api')
const {
  listEmailDLQ, getEmailEntry, retryEmailEntry, resolveEmailEntry,
  listWebhookDLQ, getWebhookEntry, retryWebhookEntry, resolveWebhookEntry,
} = await import('@/api/admin-dlq')

function mockResponse({ ok = true, status = 200, body = {} } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  }
}

beforeEach(() => {
  fetchWithRetry.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Email DLQ
// ---------------------------------------------------------------------------

describe('admin-dlq — email', () => {
  it('listEmailDLQ unwraps entries and passes the resolved filter', async () => {
    const rows = [{ id: 1, to_address: 'x@y.com' }, { id: 2, to_address: 'a@b.com' }]
    fetchWithRetry.mockResolvedValueOnce(mockResponse({ body: { entries: rows } }))

    const out = await listEmailDLQ('all')

    expect(fetchWithRetry).toHaveBeenCalledWith(
      '/api/v1/admin/dlq/email?resolved=all',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    )
    expect(out).toEqual(rows)
  })

  it('listEmailDLQ defaults to resolved=false', async () => {
    fetchWithRetry.mockResolvedValueOnce(mockResponse({ body: { entries: [] } }))
    await listEmailDLQ()
    expect(fetchWithRetry.mock.calls[0][0]).toBe('/api/v1/admin/dlq/email?resolved=false')
  })

  it('listEmailDLQ throws with server error message on non-2xx', async () => {
    fetchWithRetry.mockResolvedValueOnce(mockResponse({
      ok: false,
      status: 403,
      body: { error: 'Admin only' },
    }))
    await expect(listEmailDLQ()).rejects.toThrow('Admin only')
  })

  it('getEmailEntry unwraps entry', async () => {
    const entry = { id: 7, to_address: 'a@b.com', body_html: '<p>hi</p>' }
    fetchWithRetry.mockResolvedValueOnce(mockResponse({ body: { entry } }))

    const out = await getEmailEntry(7)

    expect(fetchWithRetry.mock.calls[0][0]).toBe('/api/v1/admin/dlq/email/7')
    expect(out).toEqual(entry)
  })

  it('retryEmailEntry POSTs and unwraps entry', async () => {
    const entry = { id: 7, next_retry_at: 'now' }
    fetchWithRetry.mockResolvedValueOnce(mockResponse({ body: { queued: true, entry } }))

    const out = await retryEmailEntry(7)

    expect(fetchWithRetry).toHaveBeenCalledWith(
      '/api/v1/admin/dlq/email/7/retry',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    )
    expect(out).toEqual(entry)
  })

  it('resolveEmailEntry DELETEs and returns the envelope', async () => {
    fetchWithRetry.mockResolvedValueOnce(mockResponse({ body: { resolved: true, id: 9 } }))

    const out = await resolveEmailEntry(9)

    expect(fetchWithRetry).toHaveBeenCalledWith(
      '/api/v1/admin/dlq/email/9',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    )
    expect(out).toEqual({ resolved: true, id: 9 })
  })

  it('surfaces 403 status on thrown errors so callers can branch', async () => {
    fetchWithRetry.mockResolvedValueOnce(mockResponse({
      ok: false,
      status: 403,
      body: { error: 'Admin only' },
    }))
    try {
      await listEmailDLQ()
      throw new Error('should not reach')
    } catch (e) {
      expect(e.status).toBe(403)
      expect(e.message).toBe('Admin only')
    }
  })
})

// ---------------------------------------------------------------------------
// Webhook DLQ — same contract, different path
// ---------------------------------------------------------------------------

describe('admin-dlq — webhook', () => {
  it('listWebhookDLQ hits /webhook with filter', async () => {
    fetchWithRetry.mockResolvedValueOnce(mockResponse({ body: { entries: [{ id: 1, delivery_id: 'abc' }] } }))

    await listWebhookDLQ('true')

    expect(fetchWithRetry.mock.calls[0][0]).toBe('/api/v1/admin/dlq/webhook?resolved=true')
  })

  it('getWebhookEntry unwraps entry with payload', async () => {
    const entry = { id: 3, delivery_id: 'abc', payload: '{"x":1}' }
    fetchWithRetry.mockResolvedValueOnce(mockResponse({ body: { entry } }))
    const out = await getWebhookEntry(3)
    expect(out).toEqual(entry)
  })

  it('retryWebhookEntry POSTs to /retry', async () => {
    fetchWithRetry.mockResolvedValueOnce(mockResponse({ body: { queued: true, entry: { id: 3 } } }))
    await retryWebhookEntry(3)
    expect(fetchWithRetry.mock.calls[0][0]).toBe('/api/v1/admin/dlq/webhook/3/retry')
    expect(fetchWithRetry.mock.calls[0][1].method).toBe('POST')
  })

  it('resolveWebhookEntry DELETEs the entry', async () => {
    fetchWithRetry.mockResolvedValueOnce(mockResponse({ body: { resolved: true, id: 5 } }))
    const out = await resolveWebhookEntry(5)
    expect(fetchWithRetry.mock.calls[0][0]).toBe('/api/v1/admin/dlq/webhook/5')
    expect(fetchWithRetry.mock.calls[0][1].method).toBe('DELETE')
    expect(out).toEqual({ resolved: true, id: 5 })
  })

  it('falls back to status message when server omits error body', async () => {
    fetchWithRetry.mockResolvedValueOnce(mockResponse({
      ok: false,
      status: 500,
      body: null,
    }))
    await expect(listWebhookDLQ()).rejects.toThrow(/status 500/)
  })
})
