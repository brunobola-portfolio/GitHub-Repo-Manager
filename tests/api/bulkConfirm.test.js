import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { bulkExecuteWithConfirmation } from '@/api/bulkConfirm'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(status, body, ok = status >= 200 && status < 300) {
  return {
    ok,
    status,
    json: async () => body,
    headers: { get: () => 'application/json' },
  }
}

const DRY_RUN_OK = {
  dryRun: true,
  plan: { action: 'delete', repos: ['org/repo-a'], extraData: {} },
  confirmationToken: 'jwt-token-abc123',
  expiresInSeconds: 60,
}

const EXECUTE_OK = { message: 'Deleted 1 repository', results: [{ repo: 'org/repo-a', success: true }] }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bulkExecuteWithConfirmation', () => {
  let mockFetch

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---- Happy path ----------------------------------------------------------

  it('happy path: dry-run → execute, returns execute response', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, DRY_RUN_OK))   // dry-run
      .mockResolvedValueOnce(makeResponse(200, EXECUTE_OK))   // execute

    const resp = await bulkExecuteWithConfirmation({
      url: '/api/delete',
      body: { repos: ['org/repo-a'], confirm: 'DELETE' },
    })

    expect(resp.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('first call injects dryRun:true into the body', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, DRY_RUN_OK))
      .mockResolvedValueOnce(makeResponse(200, EXECUTE_OK))

    await bulkExecuteWithConfirmation({
      url: '/api/delete',
      body: { repos: ['org/repo-a'], confirm: 'DELETE' },
    })

    const [firstCall] = mockFetch.mock.calls
    const sentBody = JSON.parse(firstCall[1].body)
    expect(sentBody.dryRun).toBe(true)
    expect(sentBody.repos).toEqual(['org/repo-a'])
    expect(sentBody.confirm).toBe('DELETE')
  })

  it('execute call does NOT include dryRun in body', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, DRY_RUN_OK))
      .mockResolvedValueOnce(makeResponse(200, EXECUTE_OK))

    await bulkExecuteWithConfirmation({
      url: '/api/delete',
      body: { repos: ['org/repo-a'] },
    })

    const [, secondCall] = mockFetch.mock.calls
    const sentBody = JSON.parse(secondCall[1].body)
    expect(sentBody.dryRun).toBeUndefined()
  })

  it('execute call carries X-Bulk-Confirmation-Token header with exact token', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, DRY_RUN_OK))
      .mockResolvedValueOnce(makeResponse(200, EXECUTE_OK))

    await bulkExecuteWithConfirmation({
      url: '/api/delete',
      body: { repos: ['org/repo-a'] },
    })

    const [, secondCall] = mockFetch.mock.calls
    expect(secondCall[1].headers['X-Bulk-Confirmation-Token']).toBe('jwt-token-abc123')
  })

  it('both calls use credentials:include and correct Content-Type', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, DRY_RUN_OK))
      .mockResolvedValueOnce(makeResponse(200, EXECUTE_OK))

    await bulkExecuteWithConfirmation({ url: '/api/delete', body: { repos: [] } })

    for (const call of mockFetch.mock.calls) {
      expect(call[1].credentials).toBe('include')
      expect(call[1].headers['Content-Type']).toBe('application/json')
    }
  })

  // ---- Dry-run failures ----------------------------------------------------

  it('dry-run 403 (tier rejected) throws with status 403 and reason', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(403, { error: 'upgrade_required', reason: 'upgrade_required' }, false)
    )

    await expect(
      bulkExecuteWithConfirmation({ url: '/api/visibility', body: { repos: ['org/r'] } })
    ).rejects.toMatchObject({ status: 403, reason: 'upgrade_required' })

    // execute should never be called
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('dry-run 400 (validation) throws with status 400', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(400, { error: 'validation failed' }, false)
    )

    await expect(
      bulkExecuteWithConfirmation({ url: '/api/archive', body: { repos: [], archive: true } })
    ).rejects.toMatchObject({ status: 400 })

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  // ---- Missing token -------------------------------------------------------

  it('dry-run succeeds but missing confirmationToken → descriptive error', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(200, { dryRun: true, plan: {}, expiresInSeconds: 60 })  // no confirmationToken
    )

    await expect(
      bulkExecuteWithConfirmation({ url: '/api/delete', body: { repos: ['org/r'] } })
    ).rejects.toThrow(/confirmation token/i)

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('dry-run succeeds but missing expiresInSeconds → descriptive error', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse(200, { dryRun: true, confirmationToken: 'tok', plan: {} })  // no expiresInSeconds
    )

    await expect(
      bulkExecuteWithConfirmation({ url: '/api/delete', body: { repos: ['org/r'] } })
    ).rejects.toThrow(/confirmation token/i)

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  // ---- Execute failures ----------------------------------------------------

  it('execute 400 repos-mismatch throws with status 400 and reason', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, DRY_RUN_OK))
      .mockResolvedValueOnce(
        makeResponse(400, { error: 'repos mismatch', reason: 'repos-mismatch' }, false)
      )

    await expect(
      bulkExecuteWithConfirmation({ url: '/api/delete', body: { repos: ['org/repo-a'] } })
    ).rejects.toMatchObject({ status: 400, reason: 'repos-mismatch' })
  })

  // ---- Body pass-through ---------------------------------------------------

  it('body fields are passed unchanged to both calls (except dryRun injection)', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, DRY_RUN_OK))
      .mockResolvedValueOnce(makeResponse(200, EXECUTE_OK))

    const originalBody = {
      repos: ['org/repo-a', 'org/repo-b'],
      toOrg: 'my-org',
      makePublic: false,
      strategies: ['lfs'],
    }

    await bulkExecuteWithConfirmation({ url: '/api/mirror', body: originalBody })

    const [firstCall, secondCall] = mockFetch.mock.calls
    const dryBody = JSON.parse(firstCall[1].body)
    const execBody = JSON.parse(secondCall[1].body)

    // Both should have the original fields
    expect(dryBody.repos).toEqual(originalBody.repos)
    expect(dryBody.toOrg).toBe(originalBody.toOrg)
    expect(dryBody.makePublic).toBe(false)
    expect(execBody.repos).toEqual(originalBody.repos)
    expect(execBody.toOrg).toBe(originalBody.toOrg)
    expect(execBody.makePublic).toBe(false)

    // Dry-run has dryRun:true; execute does not
    expect(dryBody.dryRun).toBe(true)
    expect(execBody.dryRun).toBeUndefined()
  })

  // ---- fetchOptions pass-through -------------------------------------------

  it('fetchOptions are merged into both fetch calls', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(200, DRY_RUN_OK))
      .mockResolvedValueOnce(makeResponse(200, EXECUTE_OK))

    await bulkExecuteWithConfirmation({
      url: '/api/delete',
      body: { repos: ['org/r'] },
      fetchOptions: { signal: 'fake-signal' },
    })

    for (const call of mockFetch.mock.calls) {
      expect(call[1].signal).toBe('fake-signal')
    }
  })

  // ---- Network failures ----------------------------------------------------

  it('network error on dry-run propagates as thrown error', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(
      bulkExecuteWithConfirmation({ url: '/api/delete', body: { repos: ['org/r'] } })
    ).rejects.toThrow('Failed to fetch')
  })
})
