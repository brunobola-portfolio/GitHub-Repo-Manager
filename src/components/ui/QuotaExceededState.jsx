import { Gauge, ArrowRight, Key } from 'lucide-react'
import { motion } from 'framer-motion'
import { openAISettings, navigateToPricing } from '../../utils/appEvents'

const TIER_LABEL = { pro: 'Pro', enterprise: 'Enterprise', free: 'Free' }

/**
 * QuotaExceededState — uniform CTA when a user hits a tier-bound quota.
 *
 * Two modes:
 *   - Inline: rendered inside a panel/modal (default).
 *   - Modal:  rendered globally via window event 'app:show-quota-exceeded'.
 *
 * Props mirror the fields the backend emits via quotaErrorPayload():
 *   { feature, currentTier, used, limit, resetAt, upgradeTo, onClose }
 */
export function QuotaExceededState({
  feature,
  currentTier,
  used,
  limit,
  resetAt,
  upgradeTo,
  onClose,
}) {
  const resetDate = resetAt ? new Date(resetAt).toISOString().slice(0, 10) : null
  const upgradeLabel = upgradeTo && TIER_LABEL[upgradeTo]
  const tierLabel = TIER_LABEL[currentTier] || currentTier
  return (
    <motion.div
      data-testid="quota-exceeded"
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="ds-card-shimmer p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 max-w-lg mx-auto text-center"
    >
      <div className="w-16 h-16 mb-5 mx-auto rounded-2xl bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center">
        <Gauge className="w-8 h-8 text-white" strokeWidth={2.5} />
      </div>
      <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">Quota reached</h3>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
        You&apos;ve used your monthly <strong>{feature}</strong> allowance
        {tierLabel ? <> on the <strong>{tierLabel}</strong> tier</> : null}.
      </p>
      {(typeof used === 'number' && typeof limit === 'number') && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 text-xs font-medium mb-2">
          <span>{used} / {limit} used</span>
        </div>
      )}
      {resetDate && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">Quota resets on {resetDate}.</p>
      )}
      {upgradeLabel && (
        <button
          type="button"
          onClick={() => { navigateToPricing(upgradeTo); onClose?.() }}
          className="ds-border-glow inline-flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:shadow-lg transition-all"
        >
          Upgrade to {upgradeLabel} <ArrowRight className="w-4 h-4" />
        </button>
      )}
      <div className="mt-5 pt-5 border-t border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => { openAISettings(); onClose?.() }}
          className="inline-flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          <Key className="w-4 h-4" /> Configure your own AI key (BYOK)
        </button>
      </div>
    </motion.div>
  )
}
