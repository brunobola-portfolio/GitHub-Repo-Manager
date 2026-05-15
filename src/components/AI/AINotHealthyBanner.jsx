import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, KeyRound, ArrowRight, X } from 'lucide-react'
import { useState } from 'react'
import { BANNER_VARIANTS, BANNER_REDUCED_VARIANTS } from './bannerMotion'
import { openAISettings } from '../../utils/appEvents'

/**
 * AINotHealthyBanner — shown when an AI provider IS configured but the
 * configured key was rejected (401/403) or otherwise fails the health probe.
 *
 * Distinct from AINotConfiguredBanner because the failure mode is different:
 * the user already configured something, so the CTA is "verify your key" not
 * "configure a key". Tonally amber → emphasises *attention needed*, not
 * setup-required.
 */
export function AINotHealthyBanner({
    state = 'invalid',
    dismissible = false,
    onDismiss,
    className = '',
}) {
    const reduced = useReducedMotion()
    const variants = reduced ? BANNER_REDUCED_VARIANTS : BANNER_VARIANTS
    const [dismissed, setDismissed] = useState(false)

    if (dismissed) return null

    const handleDismiss = () => {
        setDismissed(true)
        onDismiss?.()
    }

    const titleByState = {
        invalid: 'AI key rejected',
        unreachable: 'AI provider unreachable',
        unknown: 'AI key status unknown',
    }
    const descriptionByState = {
        invalid: 'Your provider replied with an authentication error. Check the key in Settings — it may be expired, revoked, or wrong.',
        unreachable: 'We couldn\'t reach your AI provider. Network or provider outage — try again or check provider status.',
        unknown: 'Your AI provider hasn\'t responded yet. AI features may misbehave until the next health check.',
    }
    const title = titleByState[state] || titleByState.invalid
    const description = descriptionByState[state] || descriptionByState.invalid

    return (
        <motion.div
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={variants}
            role="alert"
            aria-live="polite"
            className={`relative overflow-hidden rounded-xl p-4 ring-1 ring-inset ring-amber-500/30 bg-amber-500/[0.08] dark:bg-amber-500/[0.12] ${className}`}
        >
            <div className="flex items-start gap-3">
                <div className="shrink-0 w-10 h-10 rounded-xl bg-amber-500/25 dark:bg-amber-500/35 ring-1 ring-inset ring-amber-500/40 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-300" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-200 ring-1 ring-inset ring-amber-200 dark:ring-amber-800">
                            Action needed
                        </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {description}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={openAISettings}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 dark:bg-amber-500 hover:bg-amber-700 dark:hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors shadow-md"
                        >
                            <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                            Verify in Settings
                            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                    </div>
                </div>
                {dismissible && (
                    <button
                        type="button"
                        onClick={handleDismiss}
                        aria-label="Dismiss AI key health notice"
                        className="shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors"
                    >
                        <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                )}
            </div>
        </motion.div>
    )
}
