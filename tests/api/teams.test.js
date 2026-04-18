import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Shared mock state — tests flip `mockMode` before importing @/api/teams.
// Using a single hoisted vi.mock with getters avoids the vi.mock/vi.doMock
// interaction that leaked across runs on CI (flake: teams.test.js:27).
let mockMode = false
vi.mock('@/config', () => ({
  get MOCK_MODE() { return mockMode },
  API_BASE_URL: '',
  API_BASE: '/api',
}))

describe('listTeams — mock mode', () => {
  beforeEach(() => {
    vi.resetModules()
    mockMode = false
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns seeded mock teams without hitting the network', async () => {
    mockMode = true
    const { listTeams } = await import('@/api/teams')

    const result = await listTeams()

    expect(global.fetch).not.toHaveBeenCalled()
    expect(result.upgradeRequired).toBe(false)
    expect(result.error).toBeNull()
    expect(Array.isArray(result.teams)).toBe(true)
    expect(result.teams.length).toBeGreaterThan(0)
    // Mock teams match the server shape so the UI doesn't need special-casing.
    expect(result.teams[0]).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        name: expect.any(String),
        role: expect.any(String),
        member_count: expect.any(Number),
        repo_count: expect.any(Number),
      })
    )
  })
})

describe('listTeams — real mode (free tier)', () => {
  beforeEach(() => {
    vi.resetModules()
    mockMode = false
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty teams with upgradeRequired=true on 403 upgrade_required', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        error: 'upgrade_required',
        message: 'This feature requires the pro plan',
        currentTier: 'free',
        requiredTier: 'pro',
      }),
    })
    const { listTeams } = await import('@/api/teams')

    const result = await listTeams()

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/teams',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(result.teams).toEqual([])
    expect(result.upgradeRequired).toBe(true)
    expect(result.error).toBeNull()
  })

  it('returns real teams on 200', async () => {
    const payload = [
      { id: 42, name: 'Alpha', role: 'owner', member_count: 3, repo_count: 5 },
    ]
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => payload,
    })
    const { listTeams } = await import('@/api/teams')

    const result = await listTeams()

    expect(result.teams).toEqual(payload)
    expect(result.upgradeRequired).toBe(false)
    expect(result.error).toBeNull()
  })

  it('returns empty teams with an error string on 500', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal error' }),
    })
    const { listTeams } = await import('@/api/teams')

    const result = await listTeams()

    expect(result.teams).toEqual([])
    expect(result.upgradeRequired).toBe(false)
    expect(result.error).toBe('HTTP 500')
  })

  it('handles network errors gracefully', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network down'))
    const { listTeams } = await import('@/api/teams')

    const result = await listTeams()

    expect(result.teams).toEqual([])
    expect(result.upgradeRequired).toBe(false)
    expect(result.error).toBe('Network down')
  })

  it('coerces non-array JSON responses to an empty array', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ unexpected: 'object' }),
    })
    const { listTeams } = await import('@/api/teams')

    const result = await listTeams()

    expect(result.teams).toEqual([])
    expect(result.upgradeRequired).toBe(false)
  })
})
