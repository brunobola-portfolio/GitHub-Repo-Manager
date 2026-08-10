import { motion, useReducedMotion } from 'framer-motion'
import { Sparkles, Key, ArrowRight, X } from 'lucide-react'
import { useState } from 'react'
import { BANNER_VARIANTS, BANNER_REDUCED_VARIANTS } from './bannerMotion'
import { openAISettings } from '../../utils/appEvents'
import { Button } from '../ui/Button'

/**
 * AINotConfiguredBanner — premium inline banner shown on AI surfaces when
 * the server has no Gemini provider configured. The UI shows degraded
 * results (no scores, no recommendations) plus a CTA to open Settings → AI.
 *
 * Variants:
 *   - "inline" (default): compact banner for placement at the top of
 *     AI-heavy panels/modals.
 *   - "compact": one-line pill for tight spots (e.g. sidebars, toolbars).
 *
 * Dismissible is session-scoped via local state only — the banner
 * reappears next time the component mounts so the user is never left
 * wondering why data looks degraded.
 */
export function AINotConfiguredBanner({
    variant = 'inline',
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

    if (variant === 'compact') {
        return (
            <motion.div
                initial="hidden"
                animate="visible"
                exit="exit"
                variants={variants}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-200 ring-1 ring-inset ring-brand-200/60 dark:ring-brand-800/60 ${className}`}
                role="status"
            >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Preview data — AI not configured</span>
                <button
                    type="button"
                    onClick={openAISettings}
                    className="inline-flex items-center gap-0.5 text-[color:var(--ds-accent-brand)] dark:text-brand-300 hover:underline"
                >
                    Configure <ArrowRight className="w-3 h-3" aria-hidden="true" />
                </button>
            </motion.div>
        )
    }

    return (
        <motion.div
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={variants}
            role="status"
            aria-live="polite"
            className={`relative overflow-hidden rounded-xl p-4 ring-1 ring-inset ring-brand-500/20 bg-brand-500/[0.06] dark:bg-brand-500/[0.10] ${className}`}
        >
            <div className="flex items-start gap-3">
                <div className="shrink-0 w-10 h-10 rounded-xl bg-brand-500/20 dark:bg-brand-500/30 ring-1 ring-inset ring-brand-500/30 flex items-center justify-center">
                    <Key className="w-5 h-5 text-[color:var(--ds-accent-brand)] dark:text-brand-300" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-slate-900 dark:text-slate-100">AI not configured</h4>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full ds-text-micro font-semibold uppercase tracking-wide bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-200 ring-1 ring-inset ring-brand-200 dark:ring-brand-800">
                            <Sparkles className="w-2.5 h-2.5" aria-hidden="true" /> Preview
                        </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        You're seeing placeholder insights. Add an AI provider key to unlock real analysis, suggestions and README enhancement.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={openAISettings}
                        >
                            <Key className="w-3.5 h-3.5" aria-hidden="true" />
                            Configure AI
                            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                        </Button>
                        <a
                            href="https://aistudio.google.com/app/apikey"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-[color:var(--ds-accent-brand)] dark:text-brand-300 hover:underline"
                        >
                            Get a free Gemini key
                        </a>
                    </div>
                </div>
                {dismissible && (
                    <button
                        type="button"
                        onClick={handleDismiss}
                        aria-label="Dismiss AI configuration notice"
                        className="shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700/60 transition-colors ds-focus-ring"
                    >
                        <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                )}
            </div>
        </motion.div>
    )
}
