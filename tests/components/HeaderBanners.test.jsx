/*
 * HeaderBanners — the in-flow banner strip that renders directly under the
 * Header (rate-limit notice, session-expired banner, BYOK first-login upgrade).
 * Extracted from App.jsx as a pure presentational wrapper; this locks its
 * prop-wiring contract. Children are stubbed to prop-echoes so the test asserts
 * what HeaderBanners passes/gates, independent of each banner's internals.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HeaderBanners } from '@/components/HeaderBanners'

vi.mock('@/components/ui/RateLimitNotice', () => ({
  RateLimitNotice: ({ variant, retryAt, onRetry, onDismiss }) => (
    <div data-testid="rate-limit" data-variant={variant} data-retry-at={retryAt}>
      <button onClick={onRetry}>rl-retry</button>
      <button onClick={onDismiss}>rl-dismiss</button>
    </div>
  ),
}))
vi.mock('@/components/SessionBanner', () => ({
  SessionBanner: ({ visible, onLogin, onDismiss }) =>
    visible ? (
      <div data-testid="session-banner">
        <button onClick={onLogin}>sb-login</button>
        <button onClick={onDismiss}>sb-dismiss</button>
      </div>
    ) : null,
}))
vi.mock('@/components/BYOKUpgradeBanner', () => ({
  BYOKUpgradeBanner: ({ isAuthenticated, onOpenAISettings }) =>
    isAuthenticated ? (
      <button data-testid="byok" onClick={onOpenAISettings}>byok</button>
    ) : null,
}))

function setup(overrides = {}) {
  const props = {
    rateLimitBanner: null,
    onRateLimitRetry: vi.fn(),
    onRateLimitDismiss: vi.fn(),
    sessionExpired: false,
    onSessionLogin: vi.fn(),
    onSessionDismiss: vi.fn(),
    isAuthenticated: false,
    onOpenAISettings: vi.fn(),
    ...overrides,
  }
  render(<HeaderBanners {...props} />)
  return props
}

beforeEach(() => vi.clearAllMocks())

describe('HeaderBanners — rate-limit notice', () => {
  it('is absent when rateLimitBanner is null', () => {
    setup({ rateLimitBanner: null })
    expect(screen.queryByTestId('rate-limit')).toBeNull()
  })

  it('renders the banner variant with retryAt and wires retry + dismiss when set', () => {
    const props = setup({ rateLimitBanner: { retryAt: 12345 } })
    const el = screen.getByTestId('rate-limit')
    expect(el).toHaveAttribute('data-variant', 'banner')
    expect(el).toHaveAttribute('data-retry-at', '12345')
    fireEvent.click(screen.getByText('rl-retry'))
    fireEvent.click(screen.getByText('rl-dismiss'))
    expect(props.onRateLimitRetry).toHaveBeenCalledTimes(1)
    expect(props.onRateLimitDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('HeaderBanners — session-expired banner', () => {
  it('is hidden when sessionExpired is false', () => {
    setup({ sessionExpired: false })
    expect(screen.queryByTestId('session-banner')).toBeNull()
  })

  it('shows and wires login + dismiss when sessionExpired is true', () => {
    const props = setup({ sessionExpired: true })
    expect(screen.getByTestId('session-banner')).toBeInTheDocument()
    fireEvent.click(screen.getByText('sb-login'))
    fireEvent.click(screen.getByText('sb-dismiss'))
    expect(props.onSessionLogin).toHaveBeenCalledTimes(1)
    expect(props.onSessionDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('HeaderBanners — BYOK upgrade banner', () => {
  it('is gated off when unauthenticated', () => {
    setup({ isAuthenticated: false })
    expect(screen.queryByTestId('byok')).toBeNull()
  })

  it('renders and wires the AI-settings open when authenticated', () => {
    const props = setup({ isAuthenticated: true })
    fireEvent.click(screen.getByTestId('byok'))
    expect(props.onOpenAISettings).toHaveBeenCalledTimes(1)
  })
})
