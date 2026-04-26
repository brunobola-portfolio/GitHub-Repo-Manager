import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuotaExceededState } from '@/components/ui/QuotaExceededState'

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

  it('shows upgrade CTA when upgradeTo is pro and routes to #pricing-pro', () => {
    render(<QuotaExceededState feature="x" currentTier="free" upgradeTo="pro" />)
    fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }))
    expect(window.location.hash).toBe('#pricing-pro')
  })

  it('omits upgrade CTA when upgradeTo is null', () => {
    render(<QuotaExceededState feature="x" currentTier="enterprise" upgradeTo={null} />)
    expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument()
  })

  it('shows BYOK link that dispatches the open-settings event', () => {
    const fn = vi.fn()
    window.addEventListener('app:open-settings', fn)
    render(<QuotaExceededState feature="x" />)
    fireEvent.click(screen.getByRole('button', { name: /configure your own ai key/i }))
    expect(fn).toHaveBeenCalled()
    window.removeEventListener('app:open-settings', fn)
  })
})
