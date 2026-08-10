import { ArrowRight } from 'lucide-react'
import { navigateToPricing } from '../../utils/appEvents'
import { TIER_LABEL } from './quotaShared'

// Per-size class fragments so each call site keeps its exact visual weight.
const SIZES = {
  lg: { btn: 'gap-2 px-6 py-2.5 rounded-xl font-semibold ds-focus-ring', arrow: 'w-4 h-4' },
  sm: { btn: 'gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-[12px]', arrow: 'w-3.5 h-3.5' },
  xs: { btn: 'gap-1 px-2.5 py-1 rounded-md font-semibold text-[12px]', arrow: 'w-3 h-3' },
}

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
  const s = SIZES[size] || SIZES.lg
  return (
    <button
      type="button"
      onClick={() => { navigateToPricing(upgradeTo); onAfterNavigate?.() }}
      className={`inline-flex items-center ${s.btn} ds-brand-solid transition-colors`}
    >
      Upgrade to {label} <ArrowRight className={s.arrow} aria-hidden="true" />
    </button>
  )
}
