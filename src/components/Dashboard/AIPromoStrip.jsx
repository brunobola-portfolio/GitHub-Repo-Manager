import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, MessageCircle, ArrowRight, X } from 'lucide-react'
import { useAIPromoVisibility } from '../../hooks/useAIPromoVisibility'

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
        window.dispatchEvent(new CustomEvent('ai-assistant:open'))
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
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
            >
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-3 bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-800/40 rounded-2xl">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0">
                            <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 ds-font-display truncate">
                                {copy.title}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                {copy.body}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                            type="button"
                            onClick={handleAssistant}
                            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:border-indigo-300 dark:hover:border-indigo-500/40 transition-colors"
                        >
                            <MessageCircle className="w-3.5 h-3.5" />
                            Open Assistant
                        </button>
                        <button
                            type="button"
                            onClick={handleInsights}
                            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                        >
                            Get Insights
                            <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={handleDismiss}
                            aria-label="Dismiss AI promotion"
                            title="Hide for now"
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </motion.aside>
        </AnimatePresence>
    )
}
