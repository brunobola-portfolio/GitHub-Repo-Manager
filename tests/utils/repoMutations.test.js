/*
 * Tests for src/utils/repoMutations.js
 *
 * These verify the pure-callable HTTP shape extracted from useRepos. The
 * underlying transport is the two-step `bulkExecuteWithConfirmation` flow
 * (dry-run + execute), which is verified in src/api/bulkConfirm tests.
 * Here we mock that helper and assert call shape (URL, body) so the tests
 * stay focused on the extraction contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock config so we can assert on resolved endpoint URLs deterministically.
vi.mock('@/config', () => ({
  MOCK_MODE: false,
  API_BASE: '/api',
  API_ENDPOINTS: {
    visibility: '/api/visibility',
    transfer: '/api/transfer',
    mirror: '/api/mirror',
    archive: '/api/archive',
    delete: '/api/delete',
  },
}))

// Mock the two-step confirmation helper. Each test controls the resolved
// Response and asserts how the helper is invoked.
vi.mock('@/api/bulkConfirm', () => ({
  bulkExecuteWithConfirmation: vi.fn(),
}))

const { bulkExecuteWithConfirmation } = await import('@/api/bulkConfirm')
const { archiveRepos, deleteRepos, performAction } = await import('@/utils/repoMutations')

function jsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: {
      get: (name) => (name && name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
}

describe('repoMutations', () => {
  beforeEach(() => {
    bulkExecuteWithConfirmation.mockReset()
  })

  describe('archiveRepos', () => {
    it('posts to API_ENDPOINTS.archive with { repos, archive: true }', async () => {
      bulkExecuteWithConfirmation.mockResolvedValueOnce(
        jsonResponse({ message: 'ok' })
      )
      await archiveRepos(['owner/repo'], true)
      expect(bulkExecuteWithConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/api/archive',
          body: { repos: ['owner/repo'], archive: true },
        })
      )
    })

    it('passes archive=false through verbatim', async () => {
      bulkExecuteWithConfirmation.mockResolvedValueOnce(
        jsonResponse({ message: 'unarchived' })
      )
      await archiveRepos(['a/b', 'c/d'], false)
      expect(bulkExecuteWithConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/api/archive',
          body: { repos: ['a/b', 'c/d'], archive: false },
        })
      )
    })

    it('returns parsed response JSON', async () => {
      bulkExecuteWithConfirmation.mockResolvedValueOnce(
        jsonResponse({ message: 'archived 2', results: [] })
      )
      const data = await archiveRepos(['a/b', 'c/d'], true)
      expect(data).toEqual({ message: 'archived 2', results: [] })
    })

    it('throws when bulkExecuteWithConfirmation rejects', async () => {
      bulkExecuteWithConfirmation.mockRejectedValueOnce(new Error('boom'))
      await expect(archiveRepos(['x/y'], true)).rejects.toThrow('boom')
    })
  })

  describe('deleteRepos', () => {
    it('posts to API_ENDPOINTS.delete with { repos, confirm: "DELETE" } by default', async () => {
      bulkExecuteWithConfirmation.mockResolvedValueOnce(
        jsonResponse({ message: 'deleted' })
      )
      await deleteRepos(['owner/repo'])
      expect(bulkExecuteWithConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/api/delete',
          body: { repos: ['owner/repo'], confirm: 'DELETE' },
        })
      )
    })

    it('threads a custom confirm token', async () => {
      bulkExecuteWithConfirmation.mockResolvedValueOnce(
        jsonResponse({ message: 'deleted' })
      )
      await deleteRepos(['x/y'], 'CUSTOM_TOKEN')
      expect(bulkExecuteWithConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { repos: ['x/y'], confirm: 'CUSTOM_TOKEN' },
        })
      )
    })

    it('returns parsed response JSON', async () => {
      bulkExecuteWithConfirmation.mockResolvedValueOnce(
        jsonResponse({ message: 'deleted', count: 3 })
      )
      const data = await deleteRepos(['a/b'])
      expect(data).toEqual({ message: 'deleted', count: 3 })
    })

    it('throws when bulkExecuteWithConfirmation rejects', async () => {
      bulkExecuteWithConfirmation.mockRejectedValueOnce(new Error('forbidden'))
      await expect(deleteRepos(['x/y'])).rejects.toThrow('forbidden')
    })
  })

  describe('performAction', () => {
    it('resolves endpoint via API_ENDPOINTS for known actions', async () => {
      bulkExecuteWithConfirmation.mockResolvedValueOnce(
        jsonResponse({ results: [] })
      )
      await performAction('visibility', ['x/y'], '', { makePublic: true })
      expect(bulkExecuteWithConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/api/visibility',
          body: { repos: ['x/y'], toOrg: '', makePublic: true },
        })
      )
    })

    it('falls back to ${API_BASE}/${action} for unknown actions', async () => {
      bulkExecuteWithConfirmation.mockResolvedValueOnce(
        jsonResponse({ results: [] })
      )
      await performAction('custom-action', ['a/b'], 'org-x', {})
      expect(bulkExecuteWithConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/api/custom-action',
          body: { repos: ['a/b'], toOrg: 'org-x' },
        })
      )
    })

    it('threads transfer/mirror org through toOrg', async () => {
      bulkExecuteWithConfirmation.mockResolvedValueOnce(
        jsonResponse({ results: [] })
      )
      await performAction('transfer', ['a/b'], 'newOrg', { keepBoth: true })
      expect(bulkExecuteWithConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/api/transfer',
          body: { repos: ['a/b'], toOrg: 'newOrg', keepBoth: true },
        })
      )
    })

    it('returns the parsed JSON body', async () => {
      const payload = { results: [{ success: true }, { success: false }], message: 'mixed' }
      bulkExecuteWithConfirmation.mockResolvedValueOnce(jsonResponse(payload))
      const data = await performAction('visibility', ['a/b'], '', { makePublic: false })
      expect(data).toEqual(payload)
    })

    it('throws when bulkExecuteWithConfirmation rejects', async () => {
      const err = new Error('execute rejected')
      err.status = 500
      bulkExecuteWithConfirmation.mockRejectedValueOnce(err)
      await expect(
        performAction('visibility', ['x/y'], '', { makePublic: true })
      ).rejects.toThrow('execute rejected')
    })
  })
})

/*
 * The server caps `repos` at 100 per bulk request (bulkArchiveSchema and
 * friends are .max(100)), while Select-all is uncapped. Selecting 137
 * repositories and hitting Archive produced an opaque 400 from Zod that the
 * user could do nothing with — and, on the destructive actions, only after
 * they had already confirmed.
 *
 * Chunking is the wrong answer here: these go through a two-step dry-run +
 * confirmation-token flow, so splitting one confirmed intent into N requests
 * would mean N separate confirmations of a thing the user confirmed once.
 * Failing early with a number they can act on is the honest fix.
 */
describe('bulk selection cap', () => {
  const tooMany = Array.from({ length: 137 }, (_, i) => `acme/repo-${i}`)
  const justEnough = Array.from({ length: 100 }, (_, i) => `acme/repo-${i}`)

  beforeEach(() => { bulkExecuteWithConfirmation.mockClear() })

  it('refuses an over-cap archive before contacting the server', async () => {
    await expect(archiveRepos(tooMany)).rejects.toThrow(/100/)
    expect(bulkExecuteWithConfirmation).not.toHaveBeenCalled()
  })

  it('says how many were selected, so the message is actionable', async () => {
    await expect(archiveRepos(tooMany)).rejects.toThrow(/137/)
  })

  it('refuses an over-cap delete before contacting the server', async () => {
    await expect(deleteRepos(tooMany)).rejects.toThrow(/100/)
    expect(bulkExecuteWithConfirmation).not.toHaveBeenCalled()
  })

  it('refuses an over-cap generic action before contacting the server', async () => {
    await expect(performAction('visibility', tooMany)).rejects.toThrow(/100/)
    expect(bulkExecuteWithConfirmation).not.toHaveBeenCalled()
  })

  it('still allows exactly the cap', async () => {
    bulkExecuteWithConfirmation.mockResolvedValueOnce(jsonResponse({ message: 'ok' }))
    await archiveRepos(justEnough)
    expect(bulkExecuteWithConfirmation).toHaveBeenCalled()
  })
})

describe('the selection-cap error reaches the UI as a validation error', () => {
  it('is not offered as retryable — retrying the same selection fails identically', async () => {
    const { getErrorInfo } = await import('@/utils/errors')
    const err = await archiveRepos(Array.from({ length: 137 }, (_, i) => `a/r${i}`)).catch((e) => e)
    const info = getErrorInfo(err)
    expect(info.isRetryable).toBe(false)
    expect(info.message).toMatch(/100/)
    expect(info.message).toMatch(/137/)
  })
})
