import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuotaUpgradeButton } from '@/components/ui/QuotaUpgradeButton'
import { TIER_LABEL } from '@/components/ui/quotaShared'
import { onAppEvent, APP_EVENTS } from '@/utils/appEvents'

describe('TIER_LABEL', () => {
  it('maps tier ids to display labels', () => {
    expect(TIER_LABEL).toMatchObject({ free: 'Free', pro: 'Pro', enterprise: 'Enterprise' })
  })
})

describe('QuotaUpgradeButton', () => {
  beforeEach(() => { window.location.hash = '' })

  it('renders nothing when upgradeTo has no known label', () => {
    const { container } = render(<QuotaUpgradeButton upgradeTo={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('labels the CTA with the target tier and fires navigate-pricing on click', () => {
    const fn = vi.fn()
    const off = onAppEvent(APP_EVENTS.NAVIGATE_PRICING, fn)
    render(<QuotaUpgradeButton upgradeTo="pro" />)
    fireEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0][0].detail).toEqual({ focus: 'pro' })
    off()
  })

  it('runs onAfterNavigate after navigating (so the host can close itself)', () => {
    const after = vi.fn()
    render(<QuotaUpgradeButton upgradeTo="enterprise" onAfterNavigate={after} />)
    fireEvent.click(screen.getByRole('button', { name: /upgrade to enterprise/i }))
    expect(after).toHaveBeenCalledTimes(1)
  })
})
