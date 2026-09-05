import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { EASE, DURATION } from '../ui/motion'
import { Sparkles, MessageCircle, ArrowRight, X } from 'lucide-react'
import { useAIPromoVisibility } from '../../hooks/useAIPromoVisibility'
import { emitAppEvent, APP_EVENTS } from '../../utils/appEvents'

const COPY = {
    free: {
        title: 'Try AI insights — free',
        body: 'Run a risk report on any repo. No upgrade required.',
    },
    pro: {
        title: 'AI tools — included in Pro',
        body: 'Ask Assistant or run a risk report on any repo.',
    },
    enterprise: {
        title: 'AI tools — included in Enterprise',
        body: 'Ask Assistant or run a risk report on any repo.',
    },
}

export function AIPromoStrip({ repos, licenseTier = 'free', onOpenInsights }) {
    const [localDismissed, setLocalDismissed] = useState(false)
    const visible = useAIPromoVisibility({ reposCount: repos?.length ?? 0 })
    const copy = COPY[licenseTier] ?? COPY.free

    const shouldRender = visible && !localDismissed

    const handleDismiss = () => {
        try {
            localStorage.setItem('ai-promo-dismissed', 'true')
        } catch {
            /* OK to skip */
        }
        setLocalDismissed(true)
    }

    const handleAssistant = () => {
        emitAppEvent(APP_EVENTS.AI_ASSISTANT_OPEN)
    }

    const handleInsights = () => {
        if (repos && repos[0]) {
            onOpenInsights?.(repos[0])
        }
    }

    // Early return skips the AnimatePresence exit path: jsdom doesn't drive
    // exit animations, so the dismiss test can't observe an unmount otherwise.
    // Trade-off: dismiss is instant rather than collapsing smoothly.
    if (!shouldRender) return null

    return (
        <AnimatePresence>
            <motion.aside
                key="ai-promo-strip"
                aria-label="AI features promotion"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: DURATION.slow, ease: EASE.emphasized }}
                className="overflow-hidden"
            >
                <div className="relative flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-3 bg-brand-50 dark:bg-brand-950/20 border border-brand-200/60 dark:border-brand-800/40 rounded-2xl">
                    {/* pr-9 on mobile reserves room for the absolute dismiss button
                        (top-right) so the title can't slide underneath it. */}
                    <div className="flex items-center gap-3 flex-1 min-w-0 pr-9 sm:pr-0">
                        <div className="w-9 h-9 rounded-xl bg-[color:var(--ds-accent-brand)] flex items-center justify-center flex-shrink-0">
                            <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 ds-font-display truncate">
                                {copy.title}
                            </p>
                            <p className="text-xs text-slate-600 dark:text-slate-400 truncate">
                                {copy.body}
                            </p>
                        </div>
                    </div>
                    {/* Actions: full-width grid on mobile (no edge collision with the
                        FAB), inline auto-width row on sm+. */}
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2 sm:flex-shrink-0">
                        <button
                            type="button"
                            onClick={handleAssistant}
                            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-brand-300 dark:hover:border-brand-500/40 transition-colors whitespace-nowrap ds-focus-ring"
                        >
                            <MessageCircle className="w-3.5 h-3.5" />
                            <span className="sm:hidden">Assistant</span>
                            <span className="hidden sm:inline">Open Assistant</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleInsights}
                            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold ds-brand-solid transition-colors whitespace-nowrap ds-focus-ring"
                        >
                            <span className="sm:hidden">Insights</span>
                            <span className="hidden sm:inline">Get Insights</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    {/* Dismiss — absolute top-right on mobile (keeps the strip to two
                        compact rows); on sm+ it joins the flow as the last item so it
                        sits past the action row instead of overlapping it. */}
                    <button
                        type="button"
                        onClick={handleDismiss}
                        aria-label="Dismiss AI promotion"
                        title="Hide for now"
                        className="absolute top-2 right-2 sm:static sm:flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ds-focus-ring"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </motion.aside>
        </AnimatePresence>
    )
}
