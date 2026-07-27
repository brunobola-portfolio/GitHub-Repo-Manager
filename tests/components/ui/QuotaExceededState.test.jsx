import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuotaExceededState } from '@/components/ui/QuotaExceededState'
import { onAppEvent, APP_EVENTS } from '../../../src/utils/appEvents'

describe('QuotaExceededState', () => {
  beforeEach(() => {
    window.location.hash = ''
  })

  it('renders feature, used/limit, and reset date', () => {
    render(
      <QuotaExceededState
        feature="AI queries"
        currentTier="free"
        used={100}
        limit={100}
        resetAt="2026-05-01T00:00:00Z"
        upgradeTo="pro"
      />,
    )
    expect(screen.getByText(/AI queries/)).toBeInTheDocument()
    expect(screen.getByText(/100 \/ 100/)).toBeInTheDocument()
    expect(screen.getByText(/2026-05-01/)).toBeInTheDocument()
  })

  it('exposes data-testid for e2e selectors', () => {
    render(<QuotaExceededState feature="x" upgradeTo={null} />)
    expect(screen.getByTestId('quota-exceeded')).toBeInTheDocument()
  })

  it('shows upgrade CTA when upgradeTo is pro and emits app:navigate-pricing', () => {
    // Replaces the legacy window.location.hash mutation: the CTA now fires
    // a CustomEvent that App.jsx routes via setActiveView('pricing'), which
    // preserves browser history + works with deep-linkable URLs.
    const fn = vi.fn()
    const off = onAppEvent(APP_EVENTS.NAVIGATE_PRICING, fn)
    render(<QuotaExceededState feature="x" currentTier="free" upgradeTo="pro" />)
    fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0][0].detail).toEqual({ focus: 'pro' })
    off()
  })

  it('omits upgrade CTA when upgradeTo is null', () => {
    render(<QuotaExceededState feature="x" currentTier="enterprise" upgradeTo={null} />)
    expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument()
  })

  it('links to AI settings and dispatches the open-settings event', () => {
    const fn = vi.fn()
    const off = onAppEvent(APP_EVENTS.OPEN_SETTINGS, fn)
    render(<QuotaExceededState feature="x" />)
    fireEvent.click(screen.getByRole('button', { name: /manage your ai provider key/i }))
    expect(fn).toHaveBeenCalled()
    off()
  })

  // These caps are limits on the software and apply per tier no matter whose
  // provider key is used. Offering BYOK as the way past the wall pointed users
  // at a workaround the enforcement layer does not honour.
  it('does not present BYOK as a way around the quota', () => {
    render(<QuotaExceededState feature="x" />)
    expect(screen.getByText(/these monthly allowances still apply/i)).toBeInTheDocument()
  })
})
