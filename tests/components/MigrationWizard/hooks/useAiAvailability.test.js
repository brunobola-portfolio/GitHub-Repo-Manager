import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// vi.hoisted so the hoisted vi.mock factory can share the subscriber list.
const { subscribers } = vi.hoisted(() => ({ subscribers: [] }))
vi.mock('@/utils/aiAvailability', () => ({
  isAIUnavailable: vi.fn(() => false),
  subscribeAIUnavailable: vi.fn((cb) => { subscribers.push(cb); return () => {} }),
}))

import { isAIUnavailable } from '@/utils/aiAvailability'
const { useAiAvailability } = await import('@/components/MigrationWizard/hooks/useAiAvailability')

// apiCall's safeParseJson reads response.headers.get('content-type') and
// falls back to response.text() — both must be present on the mock Response.
const JSON_HEADERS = { get: (k) => (k?.toLowerCase?.() === 'content-type' ? 'application/json' : null) }
function jsonResponse(body) {
  return { ok: true, json: async () => body, text: async () => JSON.stringify(body), headers: JSON_HEADERS }
}

describe('useAiAvailability', () => {
  beforeEach(() => {
    subscribers.length = 0
    vi.mocked(isAIUnavailable).mockReturnValue(false)
  })

  it('enables AI when the probe says configured and not session-unavailable', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ configured: true }))
    const { result } = renderHook(() => useAiAvailability())
    await waitFor(() => expect(result.current.aiAvailable).toBe(true))
  })

  it('stays disabled when the probe says not configured', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ configured: false }))
    const { result } = renderHook(() => useAiAvailability())
    await new Promise((r) => setTimeout(r, 0))
    expect(result.current.aiAvailable).toBe(false)
  })

  it('respects session unavailability even if the probe says configured', async () => {
    vi.mocked(isAIUnavailable).mockReturnValue(true)
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ configured: true }))
    const { result } = renderHook(() => useAiAvailability())
    await new Promise((r) => setTimeout(r, 0))
    expect(result.current.aiAvailable).toBe(false)
  })

  it('downgrades + sets a humanized notice when a fatal AI failure is broadcast', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ configured: true }))
    const { result } = renderHook(() => useAiAvailability())
    await waitFor(() => expect(result.current.aiAvailable).toBe(true))
    act(() => { subscribers.forEach((cb) => cb('404:/api/x')) })
    expect(result.current.aiAvailable).toBe(false)
    expect(result.current.aiNotice).toMatch(/configured model/i)
  })
})
