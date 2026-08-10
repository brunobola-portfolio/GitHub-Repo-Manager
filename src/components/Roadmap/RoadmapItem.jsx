import { motion } from 'framer-motion'
import { EASE } from '../ui/motion'

const TIER_STYLES = {
  Free: 'bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20',
  Pro: 'bg-brand-500/10 dark:bg-brand-500/15 text-brand-700 dark:text-[color:var(--ds-accent-brand-dark)] border border-brand-500/20',
  'Pro + Enterprise': 'bg-brand-500/10 dark:bg-brand-500/15 text-brand-700 dark:text-brand-400 border border-brand-500/20',
  Enterprise: 'bg-amber-500/10 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20',
  All: 'bg-slate-100 dark:bg-white/[0.07] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/[0.10]',
}

// `tier` is optional by design. Unshipped work carries no tier badge: the
// free-first rebalance means paid tiers sell headroom, API keys and support —
// not feature unlocks — so promising a future feature to a specific tier
// contradicts the pricing model the README states. The only badges that remain
// are on compliance deliverables that genuinely will be Enterprise-only, and on
// shipped items where the badge states what is true today.
export function RoadmapItem({ title, description, tier, index = 0 }) {
  const badgeStyle = TIER_STYLES[tier] || TIER_STYLES.All

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-24px' }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: EASE.emphasized }}
      className="group relative rounded-xl p-4
        bg-white/70 dark:bg-white/[0.04] backdrop-blur-sm
        border border-slate-200/60 dark:border-white/[0.08]
        hover:border-slate-300 dark:hover:border-white/[0.15]
        hover:shadow-lg hover:shadow-slate-200/50 dark:hover:shadow-black/30
        transition-shadow duration-[var(--ds-duration-slow)]"
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-snug">
          {title}
        </h4>
        {tier && (
          <span className={`flex-shrink-0 ds-text-micro font-bold px-2 py-0.5 rounded-full ${badgeStyle}`}>
            {tier}
          </span>
        )}
      </div>
      {description && (
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
          {description}
        </p>
      )}
    </motion.div>
  )
}
