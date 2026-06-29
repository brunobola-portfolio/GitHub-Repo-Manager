/*
 * migrationApi error surfacing — the execute/resume/retry endpoints share the
 * server-side migration preflight, which can reject with a 422 ENV_TOOL_MISSING
 * envelope ({ error, code, fix, docsUrl }). Plain apiCall categorizes a 422 to
 * the generic "Invalid request. Please check your input." message, hiding what
 * the server actually told us. These wrappers must route through migrationCall
 * so the surfaced error names the missing tool AND the actionable fix — while
 * still preferring a human `message` over a machine `error` code (quota/host
 * envelopes put the code in `error` and the sentence in `message`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const apiCall = vi.fn()
vi.mock('@/utils/api', () => ({ apiCall: (...a) => apiCall(...a) }))

import { migrationApi } from '@/api/migration'

// Mirrors the ApiError shape produced by utils/api.categorizeError: a generic
// categorized `message`, the parsed server body on `.data`, and the
// machine-readable `.code` lifted from the body.
class FakeApiError extends Error {
  constructor(message, data) {
    super(message)
    this.name = 'ApiError'
    this.data = data
    this.code = data?.code ?? data?.error ?? null
  }
}

beforeEach(() => {
  apiCall.mockReset()
})

describe('migrationApi execute/resume/retry — error surfacing', () => {
  it('surfaces the ENV_TOOL_MISSING message and the actionable fix hint', async () => {
    apiCall.mockRejectedValue(new FakeApiError('Invalid request. Please check your input.', {
      error: 'TFVC client (tf) is missing on the migration server (needed for: tfvc, tfvc-clone).',
      code: 'ENV_TOOL_MISSING',
      fix: 'Run `npm run doctor:fix` or install TFVC client (tf) on the migration server, then retry.',
      docsUrl: 'https://learn.microsoft.com/azure/devops/repos/tfvc/',
    }))
    await expect(migrationApi.executePlan(15, { azurePat: 'x' }))
      .rejects.toThrow(/TFVC client \(tf\) is missing[\s\S]*doctor:fix/)
  })

  it('preserves err.code so the toast layer can map it to ENV_TOOL_MISSING', async () => {
    apiCall.mockRejectedValue(new FakeApiError('Invalid request. Please check your input.', {
      error: 'TFVC client (tf) is missing.',
      code: 'ENV_TOOL_MISSING',
    }))
    await expect(migrationApi.executePlan(1, {})).rejects.toMatchObject({ code: 'ENV_TOOL_MISSING' })
  })

  it('prefers the human message over the machine error code (quota 403)', async () => {
    apiCall.mockRejectedValue(new FakeApiError('You do not have permission to perform this action.', {
      error: 'upgrade_required',
      code: 'MIGRATION_QUOTA_EXCEEDED',
      message: 'The Free plan includes 1 full migration per month — upgrade to Pro for unlimited migrations.',
    }))
    await expect(migrationApi.executePlan(15, {}))
      .rejects.toThrow(/Free plan includes 1 full migration/)
  })

  it('applies the same enrichment to resumePlan and retryTask', async () => {
    apiCall.mockRejectedValue(new FakeApiError('Invalid request. Please check your input.', {
      error: 'Git LFS is missing on the migration server (needed for: lfs-migrate).',
      code: 'ENV_TOOL_MISSING',
      fix: 'Run `npm run doctor:fix` or install Git LFS on the migration server, then retry.',
    }))
    await expect(migrationApi.resumePlan(7, {})).rejects.toThrow(/Git LFS is missing/)
    await expect(migrationApi.retryTask(7, 3, {})).rejects.toThrow(/Git LFS is missing/)
  })
})
