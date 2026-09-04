import { ArrowRight } from 'lucide-react'
import { navigateToPricing } from '../../utils/appEvents'
import { Button } from './Button'
import { TIER_LABEL } from './quotaShared'

// QuotaUpgradeButton's `size` maps onto Button's own scale rather than
// shipping a second, competing one (F30) — `lg` reads as a full-card CTA so
// it steps up to Button's `md`; `sm`/`xs` map 1:1. Only the arrow icon size
// (which Button doesn't own) still needs a per-size lookup.
const BUTTON_SIZE = { lg: 'md', sm: 'sm', xs: 'xs' }
const ARROW_SIZE = { lg: 'w-4 h-4', sm: 'w-3.5 h-3.5', xs: 'w-3 h-3' }

/**
 * QuotaUpgradeButton — the shared "Upgrade to {tier}" CTA used by every quota
 * surface (QuotaExceededState, AIQuotaExhaustedCard, AIQuotaMeter). Renders
 * nothing when there is no known upgrade target. Fires the app navigate-pricing
 * event, then an optional `onAfterNavigate` so the host can close its own
 * modal/popover.
 *
 * `size` keeps each call site's prior footprint: lg (full card), sm (inline
 * dashboard card), xs (meter popover).
 */
export function QuotaUpgradeButton({ upgradeTo, size = 'lg', onAfterNavigate }) {
  const label = TIER_LABEL[upgradeTo]
  if (!label) return null
  return (
    <Button
      variant="soft-primary"
      size={BUTTON_SIZE[size] || BUTTON_SIZE.lg}
      onClick={() => { navigateToPricing(upgradeTo); onAfterNavigate?.() }}
    >
      Upgrade to {label} <ArrowRight className={ARROW_SIZE[size] || ARROW_SIZE.lg} aria-hidden="true" />
    </Button>
  )
}
