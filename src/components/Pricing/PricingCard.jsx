import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, X, Zap, Crown, ChevronDown } from 'lucide-react'
import { TRANSITION } from '../ui/motion'

// Free's feature list runs ~3x longer than Pro's (the next-longest) — with the
// grid's items-stretch that used to force ~450px of dead space above
// Pro/Enterprise's CTA. Collapsing anything past Pro's bullet count keeps
// first-paint card heights close across all three without touching any
// feature-list content (the pricing matrix is honesty-gated verbatim).
const COLLAPSE_THRESHOLD = 9

function FeatureRow({ label, included, highlighted, enterprise }) {
  const isIncluded = included !== false && included !== null
  return (
    <>
      <span
        className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center
          ${isIncluded
            ? highlighted
              ? 'bg-indigo-500/20 text-indigo-400'
              : enterprise
                ? 'bg-amber-500/10 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
                : 'bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
            : 'bg-slate-100 dark:bg-white/[0.05] text-slate-300 dark:text-slate-600'
          }`}
      >
        {isIncluded
          ? <Check className="w-3 h-3" strokeWidth={2.5} />
          : <X className="w-3 h-3" strokeWidth={2.5} />
        }
      </span>
      <span
        className={`text-sm leading-snug
          ${isIncluded
            ? highlighted
              ? 'text-slate-200'
              : 'text-slate-700 dark:text-slate-200'
            : 'text-slate-500 dark:text-slate-400'
          }`}
      >
        {typeof included === 'string' || typeof included === 'number'
          ? <><strong className={highlighted ? 'text-white' : enterprise ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900 dark:text-slate-100'}>{included}</strong> {label}</>
          : label
        }
      </span>
    </>
  )
}

// Only the currencies Stripe accounts here realistically bill in; anything
// else falls back to the ISO code, which is unambiguous even if less pretty.
const CURRENCY_SYMBOLS = { usd: '$', eur: '€', gbp: '£' }

function money(amount, currency) {
  const code = (currency || 'usd').toLowerCase()
  const symbol = CURRENCY_SYMBOLS[code]
  return symbol ? `${symbol}${amount}` : `${amount} ${code.toUpperCase()}`
}

export function PricingCard({
  tier,
  price,
  customPrice,
  originalPrice,
  period,
  // Resolved from the operator's Stripe price. Defaults to USD so a
  // self-hosted install with billing off renders exactly as it always did.
  currency = 'usd',
  // The real yearly total from Stripe, when there is one. Without it the card
  // falls back to price * 12, which is only correct for the fixed-discount
  // path.
  yearlyBilledTotal,
  features = [],
  highlighted = false,
  enterprise = false,
  ctaText = 'Get started',
  ctaAction,
}) {
  const [expanded, setExpanded] = useState(false)
  const shouldCollapse = features.length > COLLAPSE_THRESHOLD
  const visibleFeatures = shouldCollapse ? features.slice(0, COLLAPSE_THRESHOLD) : features
  const extraFeatures = shouldCollapse ? features.slice(COLLAPSE_THRESHOLD) : []
  const showStrike = originalPrice != null && originalPrice !== price && price > 0
  // State the real saving rather than a hardcoded 20%: with a Stripe yearly
  // price the discount is whatever the operator configured, and claiming a
  // number the checkout does not honour is the defect this card had.
  const savingsPct = originalPrice > 0 && yearlyBilledTotal != null
    ? Math.round((1 - yearlyBilledTotal / (originalPrice * 12)) * 100)
    : null
  const savingsLabel = savingsPct != null
    ? (savingsPct > 0 ? ` · Save ${savingsPct}%` : '')
    : ' · Save 20%'

  return (
    <div className="relative flex flex-col h-full">
      {/* Brand-indigo ring accent for highlighted (Pro) card */}
      {highlighted && (
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none ring-2 ring-[color:var(--ds-accent-brand)] dark:ring-[color:var(--ds-accent-brand-dark)]"
          aria-hidden="true"
        />
      )}

      {/* Subtle gold ring for Enterprise — token-driven like the highlighted
          (Pro) ring above, instead of an inline raw-hex gradient. */}
      {enterprise && (
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none ring-2 ring-[color:var(--ds-accent-enterprise)] dark:ring-[color:var(--ds-accent-enterprise-dark)]"
          aria-hidden="true"
        />
      )}

      {/* Badge — absolute on the outer wrapper (no overflow-hidden here) */}
      {highlighted && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-20">
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-[color:var(--ds-badge-brand-text)] bg-[color:var(--ds-badge-brand-fill)] shadow-md">
            <Zap className="w-3 h-3" />
            Most Popular
          </span>
        </div>
      )}

      {enterprise && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-20">
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-[color:var(--ds-badge-enterprise-text)] bg-[color:var(--ds-badge-enterprise-fill)] dark:bg-[color:var(--ds-badge-enterprise-fill-dark)] shadow-lg">
            <Crown className="w-3 h-3" />
            Enterprise
          </span>
        </div>
      )}

      {/* Card body */}
      <div
        className={`relative flex flex-col h-full rounded-2xl p-7 overflow-hidden transition-colors duration-200
          ${highlighted
            ? 'bg-slate-900 dark:bg-slate-900 border border-transparent shadow-[var(--ds-shadow-lg)]'
            : enterprise
              ? 'bg-white dark:bg-slate-950 border border-transparent shadow-xl shadow-amber-500/10 hover:shadow-amber-500/30'
              : 'bg-white/60 dark:bg-white/[0.04] backdrop-blur-md border border-slate-200/60 dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-slate-600'
          }`}
      >
        {/* All content */}
        <div className="relative z-[1] flex flex-col h-full">

          {/* Tier name */}
          <div className="mb-5 pt-2">
            <span
              className={`text-xs font-bold uppercase tracking-widest
                ${highlighted
                  ? 'text-indigo-400'
                  : enterprise
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
            >
              {tier}
            </span>
          </div>

          {/* Price */}
          <div className="flex items-end gap-2 mb-1">
            {showStrike && (
              <span className="text-2xl font-bold line-through text-slate-500 dark:text-slate-400 ds-font-display leading-none mb-0.5">
                ${originalPrice}
              </span>
            )}
            <span
              className={`text-5xl font-bold ds-font-display leading-none
                ${highlighted
                  ? 'text-white'
                  : enterprise
                    ? 'text-slate-800 dark:text-white'
                    : 'text-slate-800 dark:text-white'
                }`}
            >
              {customPrice != null ? customPrice : price === 0 ? 'Free' : money(price, currency)}
            </span>
            {price > 0 && (
              /* The yearly price is the discounted MONTHLY rate, so the unit
                 here is always "month". Rendering "/year" next to it stated
                 $15/year for a $180/year plan — a 12x understatement, on the
                 largest element of the page, contradicting its own caption. */
              <span className={`text-sm font-medium mb-1 ${highlighted ? 'text-slate-300' : 'text-slate-500 dark:text-slate-400'}`}>
                /month
              </span>
            )}
          </div>

          {customPrice != null && (
            <p className={`text-sm mb-6 ${highlighted ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400'}`}>
              Volume pricing — contact us
            </p>
          )}
          {customPrice == null && price === 0 && (
            <p className={`text-sm mb-6 ${highlighted ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400'}`}>
              No credit card required
            </p>
          )}
          {customPrice == null && price > 0 && (
            <p className={`text-sm mb-6 ${highlighted ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400'}`}>
              {period === 'year'
                ? `Billed ${money(yearlyBilledTotal ?? price * 12, currency)}/year${savingsLabel}`
                : 'Billed monthly'
              }
            </p>
          )}

          {/* Feature list */}
          <ul className={`flex flex-col gap-3 flex-1 ${shouldCollapse ? 'mb-4' : 'mb-8'}`}>
            {visibleFeatures.map(({ label, included }) => (
              <li key={label} className="flex items-start gap-3">
                <FeatureRow label={label} included={included} highlighted={highlighted} enterprise={enterprise} />
              </li>
            ))}
            {shouldCollapse && expanded && extraFeatures.map(({ label, included }) => (
              // Enter-only reveal (no exit animation): collapsing removes these
              // nodes immediately, which keeps the toggle deterministic and
              // avoids AnimatePresence leaving exiting nodes mounted mid-transition.
              <motion.li
                key={label}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                transition={TRANSITION.standard}
                className="flex items-start gap-3 overflow-hidden"
              >
                <FeatureRow label={label} included={included} highlighted={highlighted} enterprise={enterprise} />
              </motion.li>
            ))}
          </ul>

          {/* "Show all N features" toggle — only Free's list is long enough to
              need it (see COLLAPSE_THRESHOLD above). Real button + aria-expanded
              so it's keyboard-operable and announced correctly by AT. */}
          {shouldCollapse && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
              className={`w-full flex items-center justify-center gap-1.5 mb-4 py-1 text-xs font-semibold rounded-lg transition-colors duration-200 ds-focus-ring
                ${highlighted
                  ? 'text-indigo-300 hover:text-indigo-200'
                  : enterprise
                    ? 'text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300'
                    : 'text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline'
                }`}
            >
              {expanded ? 'Show fewer features' : `Show all ${features.length} features`}
              <motion.span
                animate={{ rotate: expanded ? 180 : 0 }}
                transition={TRANSITION.fast}
                className="inline-flex"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </motion.span>
            </button>
          )}

          {/* CTA button — each tier uses its own visual treatment but they
              all share ds-focus-ring so keyboard navigation feels intentional
              across the three cards. */}
          {highlighted ? (
            <button
              type="button"
              onClick={ctaAction}
              aria-label={`${ctaText} — ${tier} plan`}
              className="w-full py-3.5 rounded-xl font-bold text-sm text-white
                bg-[color:var(--ds-cta)] hover:bg-[color:var(--ds-cta-hover)]
                shadow-md transition-colors duration-200 ds-focus-ring"
            >
              {ctaText}
            </button>
          ) : enterprise ? (
            <button
              type="button"
              onClick={ctaAction}
              aria-label={`${ctaText} — ${tier} plan`}
              className="w-full py-3.5 rounded-xl font-bold text-sm
                border border-amber-400/40 dark:border-amber-500/30
                text-amber-700 dark:text-amber-300
                hover:border-amber-400 dark:hover:border-amber-500/60
                hover:bg-amber-50/50 dark:hover:bg-amber-500/[0.08]
                transition-colors duration-200 ds-focus-ring"
            >
              {ctaText}
            </button>
          ) : (
            <button
              type="button"
              onClick={ctaAction}
              aria-label={`${ctaText} — ${tier} plan`}
              className="w-full py-3.5 rounded-xl font-semibold text-sm
                border border-slate-200 dark:border-white/[0.12]
                text-slate-700 dark:text-slate-200
                hover:border-indigo-400 dark:hover:border-indigo-500/60
                hover:text-indigo-600 dark:hover:text-indigo-400
                hover:bg-indigo-50/50 dark:hover:bg-indigo-500/[0.08]
                transition-colors duration-200 ds-focus-ring"
            >
              {ctaText}
            </button>
          )}
        </div>  {/* closes the z-[1] wrapper */}
      </div>  {/* closes the card body */}
    </div>
  )
}
