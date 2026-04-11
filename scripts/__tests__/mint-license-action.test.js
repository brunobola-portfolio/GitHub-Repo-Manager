import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runMintAction } from '../mint-license-action.js'

describe('mint-license-action', () => {
  let tmpDir, summaryPath, env

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mint-action-'))
    summaryPath = join(tmpDir, 'summary')
    writeFileSync(summaryPath, '')
    env = {
      LICENSE_PRIVATE_PEM: '__WILL_BE_REPLACED_PER_TEST__',
      // Test override: in production the script reads keys/public.pem from
      // disk after checkout. Tests inject a matching throwaway keypair via
      // env.PUBLIC_KEY_PEM so we don't need a real committed key for tests.
      PUBLIC_KEY_PEM: '__WILL_BE_REPLACED_PER_TEST__',
      RESEND_API_KEY: 'resend-test',
      LICENSE_LOG_PAT: 'pat-test',
      AUDIT_REPO: 'brunobola-portfolio/license-log',
      FROM_EMAIL: 'licenses@bolalabs.pt',
      TIER: 'enterprise',
      ORG: 'Test Co',
      EMAIL: 'test@example.com',
      SEATS: '10',
      MONTHS: '12',
      NOTES: 'Test',
      DRY_RUN: 'false',
      GITHUB_RUN_ID: '1000',
      GITHUB_STEP_SUMMARY: summaryPath,
      KID: 'k-test',
    }
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('runs the happy path: validate -> mint -> pending -> deliver -> delivered -> exit 0', async () => {
    const { generateKeyPair } = await import('../../server/lib/license.js')
    const pair = await generateKeyPair()
    env.LICENSE_PRIVATE_PEM = pair.privateKey
    env.PUBLIC_KEY_PEM = pair.publicKey

    const originalFetch = global.fetch
    let fetchCalls = 0
    global.fetch = vi.fn((url, init) => {
      fetchCalls++
      if (url.includes('api.resend.com')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'msg-001' }) })
      }
      if (url.includes('api.github.com') && (init?.method === 'GET' || !init?.method)) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
      }
      if (url.includes('api.github.com') && init?.method === 'PUT') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ commit: { sha: 'abc123' } }) })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    let exitCode
    try {
      exitCode = await runMintAction({ env })
    } finally {
      global.fetch = originalFetch
    }

    expect(exitCode).toBe(0)
    expect(fetchCalls).toBeGreaterThanOrEqual(4) // GET, PUT, Resend POST, GET, PUT

    const summary = readFileSync(summaryPath, 'utf8')
    expect(summary).toMatch(/tier.*enterprise/i)
    expect(summary).toMatch(/Test Co/)
    expect(summary).toMatch(/lic_/)
    // Must NOT contain the full license key
    expect(summary).not.toMatch(/grm_lic_[A-Za-z0-9._-]{20}/)
  })

  it('dry-run short-circuits after mint: no fetch, summary only', async () => {
    const { generateKeyPair } = await import('../../server/lib/license.js')
    const pair = await generateKeyPair()
    env.LICENSE_PRIVATE_PEM = pair.privateKey
    env.PUBLIC_KEY_PEM = pair.publicKey
    env.DRY_RUN = 'true'

    const originalFetch = global.fetch
    const fetchSpy = vi.fn(() => {
      throw new Error('dry-run should not call fetch')
    })
    global.fetch = fetchSpy

    let exitCode
    try {
      exitCode = await runMintAction({ env })
    } finally {
      global.fetch = originalFetch
    }

    expect(exitCode).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()

    const summary = readFileSync(summaryPath, 'utf8')
    expect(summary).toMatch(/dry.run/i)
  })

  it('exits 2 on InputValidationError', async () => {
    env.TIER = 'free'  // invalid
    env.LICENSE_PRIVATE_PEM = 'will-not-be-used'
    env.PUBLIC_KEY_PEM = 'will-not-be-used'

    const exitCode = await runMintAction({ env })
    expect(exitCode).toBe(2)
  })

  it('exits 5 on DeliveryError and leaves pending audit entry intact', async () => {
    const { generateKeyPair } = await import('../../server/lib/license.js')
    const pair = await generateKeyPair()
    env.LICENSE_PRIVATE_PEM = pair.privateKey
    env.PUBLIC_KEY_PEM = pair.publicKey

    const originalFetch = global.fetch
    const ghCalls = { get: 0, put: 0 }
    global.fetch = vi.fn((url, init) => {
      if (url.includes('api.resend.com')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ message: 'resend down' }) })
      }
      if (url.includes('api.github.com')) {
        if (init?.method === 'PUT') {
          ghCalls.put++
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ commit: { sha: 'abc' } }) })
        }
        ghCalls.get++
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    let exitCode
    try {
      exitCode = await runMintAction({ env })
    } finally {
      global.fetch = originalFetch
    }

    expect(exitCode).toBe(5)
    // Pending audit write must have happened (one PUT for pending)
    expect(ghCalls.put).toBe(1)
  })
})
