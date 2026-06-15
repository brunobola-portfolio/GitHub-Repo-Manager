/*
 * GitHub Repo Manager
 * formatUserError tests — verifies the user-facing error helper never leaks
 * stack traces, raw backend strings, or unmapped exceptions into the UI.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { formatUserError } from '../../src/utils/errors.js'

describe('formatUserError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps known code to title/body/action', () => {
    const out = formatUserError({ code: 'AI_NOT_CONFIGURED' })
    expect(out.title).toBe('AI is not configured')
    expect(out.action.kind).toBe('open-settings')
    expect(out.action.settingsTab).toBe('ai')
    expect(out.raw).toBeNull()
  })

  it('detects a fetch network error', () => {
    const err = new TypeError('Failed to fetch')
    expect(formatUserError(err).code).toBe('NETWORK_ERROR')
  })

  it('detects 401 without explicit code', () => {
    expect(formatUserError({ status: 401 }).code).toBe('UNAUTHORIZED')
  })

  it('detects 401 from axios-shape response', () => {
    expect(formatUserError({ response: { status: 401 } }).code).toBe('UNAUTHORIZED')
  })

  it('returns fallback for unknown error', () => {
    const out = formatUserError(new Error('weird internal thing'))
    expect(out.title).toBe('Something went wrong')
    expect(out.body).toContain('bruno@bolalabs.pt')
  })

  it('never includes the original error message in the returned object', () => {
    const err = new Error('boom — secret backend detail')
    const out = formatUserError(err)
    expect(out.raw).toBeNull()
    expect(JSON.stringify(out)).not.toContain('boom')
    expect(JSON.stringify(out)).not.toContain('secret backend')
  })

  it('reads code from response.data.code (axios shape)', () => {
    expect(formatUserError({ response: { data: { code: 'AI_KEY_INVALID' } } }).code).toBe('AI_KEY_INVALID')
  })

  it('returns fallback when err is null/undefined', () => {
    expect(formatUserError(null).title).toBe('Something went wrong')
    expect(formatUserError(undefined).title).toBe('Something went wrong')
  })

  it('honors explicit code in context override', () => {
    expect(formatUserError(new Error('x'), { code: 'TIER_REQUIRED_PRO' }).code).toBe('TIER_REQUIRED_PRO')
  })

  it('maps QUOTA_EXCEEDED to open-quota action', () => {
    expect(formatUserError({ code: 'QUOTA_EXCEEDED' }).action.kind).toBe('open-quota')
  })

  it('honors fallbackTitle when error is unmapped', () => {
    const out = formatUserError(new Error('weird'), { fallbackTitle: 'Mirror failed' })
    expect(out.title).toBe('Mirror failed')
    expect(out.body).toContain('bruno@bolalabs.pt')
  })

  it('ignores fallbackTitle when error has a known code', () => {
    const out = formatUserError({ code: 'AI_NOT_CONFIGURED' }, { fallbackTitle: 'Mirror failed' })
    expect(out.title).toBe('AI is not configured')
  })

  // ---------------------------------------------------------------------
  // Server AI vocabulary — every code in handleAIError + adjacent routes
  // must round-trip into a presentational shape with action.type.
  // ---------------------------------------------------------------------

  it('maps INVALID_API_KEY to a configure action targeting the AI tab', () => {
    const out = formatUserError({ code: 'INVALID_API_KEY' })
    expect(out.title).toMatch(/key/i)
    expect(out.action.type).toBe('configure')
    expect(out.action.settingsTab).toBe('ai')
  })

  it('maps NO_AI_PROVIDER to a configure action', () => {
    const out = formatUserError({ code: 'NO_AI_PROVIDER' })
    expect(out.action.type).toBe('configure')
  })

  it('maps RATE_LIMITED to a retry action', () => {
    const out = formatUserError({ code: 'RATE_LIMITED' })
    expect(out.action.type).toBe('retry')
  })

  it('maps a 413 status to PAYLOAD_TOO_LARGE', () => {
    const out = formatUserError({ status: 413 })
    expect(out.code).toBe('PAYLOAD_TOO_LARGE')
    expect(out.title).toMatch(/too large/i)
  })

  it('maps a raw "request entity too large" message to PAYLOAD_TOO_LARGE', () => {
    const out = formatUserError(new Error('request entity too large'))
    expect(out.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('maps AI_TIMEOUT to a retry action', () => {
    const out = formatUserError({ code: 'AI_TIMEOUT' })
    expect(out.title).toMatch(/timed out/i)
    expect(out.action.type).toBe('retry')
  })

  it('maps AI_NETWORK_ERROR to a retry action', () => {
    expect(formatUserError({ code: 'AI_NETWORK_ERROR' }).action.type).toBe('retry')
  })

  it('maps AI_OVERLOADED to a retry action', () => {
    expect(formatUserError({ code: 'AI_OVERLOADED' }).action.type).toBe('retry')
  })

  it('maps AI_REQUEST_FAILED to a retry action', () => {
    expect(formatUserError({ code: 'AI_REQUEST_FAILED' }).action.type).toBe('retry')
  })

  it('maps AI_PARSE_ERROR to a retry action', () => {
    expect(formatUserError({ code: 'AI_PARSE_ERROR' }).action.type).toBe('retry')
  })

  it('maps MODEL_NOT_FOUND to a configure action', () => {
    expect(formatUserError({ code: 'MODEL_NOT_FOUND' }).action.type).toBe('configure')
  })

  it('maps AI_DISABLED to a dismiss action', () => {
    expect(formatUserError({ code: 'AI_DISABLED' }).action.type).toBe('dismiss')
  })

  it('maps PRESET_NOT_FOUND to a retry action', () => {
    expect(formatUserError({ code: 'PRESET_NOT_FOUND' }).action.type).toBe('retry')
  })

  it('maps GITHUB_FETCH_FAILED to a retry action', () => {
    expect(formatUserError({ code: 'GITHUB_FETCH_FAILED' }).action.type).toBe('retry')
  })

  it('maps PUBLISH_FAILED to a retry action', () => {
    expect(formatUserError({ code: 'PUBLISH_FAILED' }).action.type).toBe('retry')
  })

  it('reads code from server-style { error, code } body', () => {
    // Mirrors the shape thrown by useAIDeepReview.fetchJSON (err.code set from body.code)
    expect(formatUserError({ code: 'INVALID_API_KEY', message: 'Invalid key' }).code).toBe('INVALID_API_KEY')
  })

  it('every known action ships both a kind (legacy) and a type (canonical)', () => {
    for (const code of [
      'AI_NOT_CONFIGURED', 'INVALID_API_KEY', 'QUOTA_EXCEEDED', 'RATE_LIMITED',
      'AI_TIMEOUT', 'AI_OVERLOADED', 'AI_NETWORK_ERROR', 'NETWORK_ERROR',
    ]) {
      const out = formatUserError({ code })
      expect(out.action.kind, `kind for ${code}`).toBeTruthy()
      expect(out.action.type, `type for ${code}`).toBeTruthy()
    }
  })

  // -----------------------------------------------------------------------
  // GITHUB_PRO_REQUIRED — branch protection on free tier
  // -----------------------------------------------------------------------

  it('maps a code: GITHUB_PRO_REQUIRED error to a calm message and never falls through to FALLBACK', () => {
    const err = Object.assign(new Error('Upgrade to GitHub Pro or make this repository public to enable this feature.'), {
      status: 403,
      code: 'GITHUB_PRO_REQUIRED',
    })
    const result = formatUserError(err)
    expect(result.code).toBe('GITHUB_PRO_REQUIRED')
    expect(result.title).toMatch(/branch protection|github pro/i)
    // Must not be the generic fallback title
    expect(result.title).not.toBe('Something went wrong')
  })

  it('does not log "unmapped error" warn for a known GITHUB_PRO_REQUIRED code', () => {
    const err = Object.assign(new Error('Upgrade to GitHub Pro'), { status: 403, code: 'GITHUB_PRO_REQUIRED' })
    formatUserError(err)
    const warnSpy = console.warn
    const unmappedCalls = warnSpy.mock.calls.filter(c => String(c[0]).includes('[formatUserError] unmapped'))
    expect(unmappedCalls).toHaveLength(0)
  })
})
