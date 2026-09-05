import { motion } from 'framer-motion'
import { EASE, DURATION } from '../ui/motion'
import { Lock, Sparkles, Check, ArrowRight } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

const TIER_COPY = {
    pro: {
        eyebrow: 'Pro feature',
        bg: 'bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)]',
        glow: '',
        ring: 'ring-brand-500/20 dark:ring-brand-400/20',
    },
    enterprise: {
        eyebrow: 'Enterprise feature',
        bg: 'bg-amber-500 dark:bg-amber-400',
        glow: '',
        ring: 'ring-amber-500/20 dark:ring-amber-400/20',
    },
}

function tierName(tier) {
    return tier === 'enterprise' ? 'Enterprise' : 'Pro'
}

/**
 * Renders the "this is gated behind a higher tier" upsell.
 *
 *   <UpgradeRequired tier="pro" feature="Stale PRs"
 *                    benefits={['Find PRs idle 7+ days', 'Triage at-a-glance']} />
 *
 * Variants:
 *   - card   (default) — full-width hero block; ideal as a tab/page replacement
 *   - inline           — compact pill inside a list/empty area
 *   - banner           — top-of-page warning strip with optional dismiss
 */
export function UpgradeRequired({
    tier = 'pro',
    feature,
    benefits,
    variant = 'card',
    pricingHref = '#/pricing',
    onPricingClick,
    onDismiss,
    className,
}) {
    const copy = TIER_COPY[tier] ?? TIER_COPY.pro

    if (variant === 'inline') {
        return (
            <InlineUpgrade tier={tier} feature={feature} copy={copy}
                pricingHref={pricingHref} onPricingClick={onPricingClick}
                className={className} />
        )
    }

    if (variant === 'banner') {
        return (
            <BannerUpgrade tier={tier} feature={feature} copy={copy}
                pricingHref={pricingHref} onPricingClick={onPricingClick}
                onDismiss={onDismiss} className={className} />
        )
    }

    return (
        <CardUpgrade tier={tier} feature={feature} benefits={benefits} copy={copy}
            pricingHref={pricingHref} onPricingClick={onPricingClick}
            className={className} />
    )
}

/* ------------------------------------------------------------------ */
/* Card variant — the headline upsell                                  */
/* ------------------------------------------------------------------ */

function CardUpgrade({ tier, feature, benefits, copy, pricingHref, onPricingClick, className }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.reveal, ease: EASE.emphasized }}
            role="region"
            aria-label={`${tierName(tier)} feature`}
            className={twMerge(
                'relative isolate overflow-hidden',
                'rounded-3xl border border-slate-200 dark:border-slate-700/60',
                'bg-white dark:bg-slate-900',
                'ds-elevation-lg',
                'px-6 py-12 sm:px-10 sm:py-16',
                className
            )}
        >

            <div className="relative flex flex-col items-center text-center max-w-md mx-auto">
                {/* Lock medallion */}
                <motion.div
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.1, duration: DURATION.gentle, ease: EASE.emphasized }}
                    className={twMerge(
                        'relative mb-5 inline-flex items-center justify-center',
                        'w-16 h-16 rounded-2xl',
                        copy.bg,
                        'ds-elevation-md',
                        'ring-1', copy.ring
                    )}
                >
                    <Lock className="w-7 h-7 text-white" strokeWidth={2.4} />
                    <Sparkles className="absolute -top-1 -right-1 w-4 h-4 text-white" />
                </motion.div>

                {/* Eyebrow */}
                <span className={twMerge(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 mb-3',
                    'ds-eyebrow',
                    'rounded-full text-white',
                    copy.bg
                )}>
                    <Sparkles className="w-3 h-3" /> {copy.eyebrow}
                </span>

                <h3 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 mb-2 ds-font-display">
                    {feature ? `Unlock ${feature}` : `Upgrade to ${tierName(tier)}`}
                </h3>

                <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
                    {feature
                        ? `${feature} is part of the ${tierName(tier)} plan.`
                        : `This view requires the ${tierName(tier)} plan.`}{' '}
                    Upgrade to unlock the full toolkit.
                </p>

                {Array.isArray(benefits) && benefits.length > 0 && (
                    <ul className="w-full text-left mb-7 space-y-2">
                        {benefits.map((b, i) => (
                            <motion.li
                                key={i}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.2 + i * 0.05, duration: DURATION.slow }}
                                className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-300"
                            >
                                <span className={twMerge(
                                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white',
                                    copy.bg
                                )}>
                                    <Check className="w-3 h-3" strokeWidth={3} />
                                </span>
                                <span>{b}</span>
                            </motion.li>
                        ))}
                    </ul>
                )}

                <a
                    href={pricingHref}
                    onClick={onPricingClick}
                    className={twMerge(
                        'group inline-flex items-center justify-center gap-2',
                        'px-5 py-2.5 rounded-xl text-sm font-semibold text-white',
                        copy.bg,
                        'ds-elevation-md',
                        'hover:opacity-90 transition-opacity duration-200',
                        'ds-focus-ring'
                    )}
                >
                    View {tierName(tier)} pricing
                    <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </a>
            </div>
        </motion.div>
    )
}

/* ------------------------------------------------------------------ */
/* Inline variant — compact, fits inside cards/lists                   */
/* ------------------------------------------------------------------ */

function InlineUpgrade({ tier, feature, copy, pricingHref, onPricingClick, className }) {
    return (
        <div className={twMerge(
            'flex items-center gap-3 px-4 py-3 rounded-xl',
            'bg-slate-50/80 dark:bg-slate-800/60',
            'border border-slate-200/70 dark:border-slate-700/50',
            className
        )}>
            <span className={twMerge(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ds-elevation-md',
                copy.bg
            )}>
                <Lock className="w-4 h-4 text-white" />
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {feature ?? `${tierName(tier)} feature`}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Available on {tierName(tier)}
                </p>
            </div>
            <a
                href={pricingHref}
                onClick={onPricingClick}
                className="text-xs font-semibold text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:text-brand-500 inline-flex items-center gap-1 ds-focus-ring"
            >
                Upgrade
                <ArrowRight className="w-3 h-3" />
            </a>
        </div>
    )
}

/* ------------------------------------------------------------------ */
/* Banner variant — top-of-page strip                                  */
/* ------------------------------------------------------------------ */

function BannerUpgrade({ tier, feature, copy, pricingHref, onPricingClick, onDismiss, className }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: DURATION.standard }}
            role="status"
            className={twMerge(
                'relative overflow-hidden',
                'rounded-2xl border border-brand-200/60 dark:border-brand-500/30',
                'bg-brand-50/80',
                'dark:bg-brand-500/10',
                'backdrop-blur-md',
                'px-5 py-4',
                'flex flex-col sm:flex-row sm:items-center gap-3',
                className
            )}
        >
            <span className={twMerge(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ds-elevation-md',
                copy.bg
            )}>
                <Sparkles className="w-4 h-4 text-white" />
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {feature ?? `${tierName(tier)} feature`}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                    Available on the {tierName(tier)} plan.
                </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <a
                    href={pricingHref}
                    onClick={onPricingClick}
                    className={twMerge(
                        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white ds-elevation-md',
                        copy.bg,
                        'hover:opacity-90 transition-all ds-focus-ring'
                    )}
                >
                    Upgrade <ArrowRight className="w-3 h-3" />
                </a>
                {onDismiss && (
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2 py-1 ds-focus-ring rounded-md"
                    >
                        Dismiss
                    </button>
                )}
            </div>
        </motion.div>
    )
}

