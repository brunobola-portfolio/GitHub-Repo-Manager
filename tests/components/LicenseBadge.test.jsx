import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'

// Reset module cache so individual tests can swap `MOCK_MODE` before import.
beforeEach(() => {
  vi.resetModules()
  global.fetch = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function loadBadge({ mockMode }) {
  vi.doMock('@/config', () => ({ MOCK_MODE: mockMode, API_BASE_URL: '' }))
  const mod = await import('@/components/LicenseBadge')
  return mod.default
}

describe('LicenseBadge — real license always wins', () => {
  it('renders Enterprise pill when API returns active license_key (MOCK_MODE=false)', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        active: true,
        source: 'license_key',
        tier: 'enterprise',
        org: 'Bola Labs Dev',
        email: 'bruno@bolalabs.pt',
        seats: 100,
        seatsUsed: 2,
        expiresAt: '2028-03-31T17:33:30.000Z',
        issuedAt: '2026-04-11T17:33:30.000Z',
      }),
    })
    const LicenseBadge = await loadBadge({ mockMode: false })
    render(<LicenseBadge />)

    await waitFor(() => {
      expect(screen.getByTestId('license-badge')).toHaveTextContent(
        /enterprise/i
      )
    })
    const badge = screen.getByTestId('license-badge')
    expect(badge.getAttribute('title')).toContain('Bola Labs Dev')
    expect(badge.getAttribute('title')).toContain('2028-03-31')
    expect(badge.getAttribute('aria-label')).toContain('Enterprise')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/license',
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('renders Enterprise pill even when MOCK_MODE=true (backend license wins)', async () => {
    // This is the dev smoke-test scenario: frontend uses mock data for fake
    // repos/orgs, but the backend still has a real LICENSE_KEY — the badge
    // must show the real tier so Bruno can visually verify the license is
    // actually active in the running stack.
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        active: true,
        source: 'license_key',
        tier: 'enterprise',
        org: 'Bola Labs Dev',
        expiresAt: '2028-03-31T17:33:30.000Z',
      }),
    })
    const LicenseBadge = await loadBadge({ mockMode: true })
    render(<LicenseBadge />)

    await waitFor(() => {
      expect(screen.getByTestId('license-badge')).toHaveTextContent(
        /enterprise/i
      )
    })
  })

  it('renders Pro pill when API returns pro tier', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        active: true,
        source: 'license_key',
        tier: 'pro',
        org: 'Acme Corp',
        expiresAt: '2027-01-01T00:00:00.000Z',
      }),
    })
    const LicenseBadge = await loadBadge({ mockMode: false })
    render(<LicenseBadge />)

    await waitFor(() => {
      expect(screen.getByTestId('license-badge')).toHaveTextContent(/pro/i)
    })
    expect(screen.getByTestId('license-badge').getAttribute('title')).toContain(
      'Acme Corp'
    )
  })
})

describe('LicenseBadge — no real license', () => {
  it('renders Demo pill in MOCK_MODE when API returns active=false', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        active: false,
        source: 'none',
        tier: 'free',
      }),
    })
    const LicenseBadge = await loadBadge({ mockMode: true })
    render(<LicenseBadge />)

    await waitFor(() => {
      expect(screen.getByTestId('license-badge')).toHaveTextContent(/demo/i)
    })
  })

  it('renders Free pill in real mode when API returns active=false', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        active: false,
        source: 'none',
        tier: 'free',
      }),
    })
    const LicenseBadge = await loadBadge({ mockMode: false })
    render(<LicenseBadge />)

    await waitFor(() => {
      expect(screen.getByTestId('license-badge')).toHaveTextContent(/free/i)
    })
  })
})

describe('LicenseBadge — error fallbacks', () => {
  it('falls back to Demo pill in MOCK_MODE on fetch error', async () => {
    global.fetch.mockRejectedValueOnce(new Error('network down'))
    const LicenseBadge = await loadBadge({ mockMode: true })
    render(<LicenseBadge />)

    await waitFor(() => {
      expect(screen.getByTestId('license-badge')).toHaveTextContent(/demo/i)
    })
  })

  it('falls back to Free pill in real mode on fetch error', async () => {
    global.fetch.mockRejectedValueOnce(new Error('network down'))
    const LicenseBadge = await loadBadge({ mockMode: false })
    render(<LicenseBadge />)

    await waitFor(() => {
      expect(screen.getByTestId('license-badge')).toHaveTextContent(/free/i)
    })
    const badge = screen.getByTestId('license-badge')
    expect(badge.getAttribute('title')).toMatch(/unavailable/i)
  })

  it('falls back appropriately on non-2xx response', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    })
    const LicenseBadge = await loadBadge({ mockMode: false })
    render(<LicenseBadge />)

    await waitFor(() => {
      expect(screen.getByTestId('license-badge')).toHaveTextContent(/free/i)
    })
  })
})
