import { motion } from 'framer-motion'
import { Check, X, Zap, Crown } from 'lucide-react'

export function PricingCard({
  tier,
  price,
  originalPrice,
  period,
  features = [],
  highlighted = false,
  enterprise = false,
  ctaText = 'Get started',
  ctaAction,
}) {
  const showStrike = originalPrice != null && originalPrice !== price && price > 0

  return (
    <motion.div
      whileHover={{ scale: highlighted ? 1.03 : 1.02, y: -4 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="relative flex flex-col h-full"
    >
      {/* Gradient border wrapper for highlighted (Pro) card */}
      {highlighted && (
        <>
          <div
            className="absolute inset-0 rounded-2xl p-px"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6, #06b6d4)' }}
          >
            <div className="absolute inset-0 rounded-2xl bg-slate-900" />
          </div>
          <div
            className="absolute -inset-1 rounded-3xl opacity-40 blur-xl pointer-events-none"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6, #06b6d4)' }}
          />
        </>
      )}

      {/* Subtle gold border for Enterprise */}
      {enterprise && (
        <div
          className="absolute inset-0 rounded-2xl p-px"
          style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706, #eab308)' }}
        >
          <div className="absolute inset-0 rounded-2xl bg-white dark:bg-slate-950" />
        </div>
      )}

      {/* Badge — absolute on the outer wrapper (no overflow-hidden here) */}
      {highlighted && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-20">
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-white bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-500 shadow-lg shadow-indigo-500/30">
            <Zap className="w-3 h-3" />
            Most Popular
          </span>
        </div>
      )}

      {enterprise && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-20">
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-white bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 shadow-lg shadow-amber-500/30">
            <Crown className="w-3 h-3" />
            Enterprise
          </span>
        </div>
      )}

      {/* Card body */}
      <div
        className={`relative flex flex-col h-full rounded-2xl p-7 ds-card-shimmer
          ${highlighted
            ? 'bg-slate-900 dark:bg-slate-900 border border-transparent shadow-2xl shadow-indigo-500/25'
            : enterprise
              ? 'bg-white dark:bg-slate-950 border border-transparent shadow-xl shadow-amber-500/10'
              : 'bg-white/60 dark:bg-white/[0.04] backdrop-blur-xl border border-slate-200/60 dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/[0.15] transition-colors duration-300'
          }`}
      >
        {/* Tier name */}
        <div className="mb-5 pt-2">
          <span
            className={`text-xs font-bold uppercase tracking-widest
              ${highlighted
                ? 'text-indigo-400'
                : enterprise
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
          >
            {tier}
          </span>
        </div>

        {/* Price */}
        <div className="flex items-end gap-2 mb-1">
          {showStrike && (
            <span className="text-2xl font-bold line-through text-slate-400 dark:text-slate-500 ds-font-display leading-none mb-0.5">
              ${originalPrice}
            </span>
          )}
          <span
            className={`text-5xl font-extrabold ds-font-display leading-none
              ${highlighted
                ? 'text-white'
                : enterprise
                  ? 'text-slate-800 dark:text-white'
                  : 'text-slate-800 dark:text-white'
              }`}
          >
            {price === 0 ? 'Free' : `$${price}`}
          </span>
          {price > 0 && (
            <span className={`text-sm font-medium mb-1 ${highlighted ? 'text-slate-400' : 'text-slate-400 dark:text-slate-500'}`}>
              /{period}
            </span>
          )}
        </div>

        {price === 0 && (
          <p className={`text-sm mb-6 ${highlighted ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400'}`}>
            No credit card required
          </p>
        )}
        {price > 0 && (
          <p className={`text-sm mb-6 ${highlighted ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400'}`}>
            {period === 'year'
              ? `$${price * 12}/year \u00b7 Save 20%`
              : 'Billed monthly'
            }
          </p>
        )}

        {/* Feature list */}
        <ul className="flex flex-col gap-3 flex-1 mb-8">
          {features.map(({ label, included }) => {
            const isIncluded = included !== false && included !== null
            return (
              <li key={label} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center
                    ${isIncluded
                      ? highlighted
                        ? 'bg-indigo-500/20 text-indigo-400'
                        : enterprise
                          ? 'bg-amber-500/10 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400'
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
                      : 'text-slate-400 dark:text-slate-500'
                    }`}
                >
                  {typeof included === 'string' || typeof included === 'number'
                    ? <><strong className={highlighted ? 'text-white' : enterprise ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900 dark:text-white'}>{included}</strong> {label}</>
                    : label
                  }
                </span>
              </li>
            )
          })}
        </ul>

        {/* CTA button */}
        {highlighted ? (
          <button
            onClick={ctaAction}
            className="w-full py-3.5 rounded-xl font-bold text-sm text-white
              bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 bg-[length:200%_100%]
              hover:bg-right shadow-lg shadow-indigo-500/30
              hover:shadow-xl hover:shadow-indigo-500/40
              active:scale-95 transition-all duration-500 ds-btn-shimmer"
          >
            {ctaText}
          </button>
        ) : enterprise ? (
          <button
            onClick={ctaAction}
            className="w-full py-3.5 rounded-xl font-bold text-sm
              border border-amber-400/40 dark:border-amber-500/30
              text-amber-700 dark:text-amber-300
              hover:border-amber-400 dark:hover:border-amber-500/60
              hover:bg-amber-50/50 dark:hover:bg-amber-500/[0.08]
              active:scale-95 transition-all duration-300"
          >
            {ctaText}
          </button>
        ) : (
          <button
            onClick={ctaAction}
            className="w-full py-3.5 rounded-xl font-semibold text-sm
              border border-slate-200 dark:border-white/[0.12]
              text-slate-700 dark:text-slate-200
              hover:border-indigo-400 dark:hover:border-indigo-500/60
              hover:text-indigo-600 dark:hover:text-indigo-400
              hover:bg-indigo-50/50 dark:hover:bg-indigo-500/[0.08]
              active:scale-95 transition-all duration-300"
          >
            {ctaText}
          </button>
        )}
      </div>
    </motion.div>
  )
}
