import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Check, AlertTriangle, Loader2 } from 'lucide-react'

// ---------------------------------------------------------------------------
// Sub-component: TestButton
// ---------------------------------------------------------------------------

export function TestButton({ onTest, disabled, result, countdown }) {
    return (
        <div className="space-y-2">
            <button
                onClick={onTest}
                disabled={disabled || countdown > 0}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 border border-indigo-200 dark:border-indigo-700/50 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {disabled && !countdown ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    <Sparkles className="w-4 h-4" />
                )}
                {countdown > 0
                    ? `Test Connection (${countdown}s)`
                    : 'Test Connection'}
            </button>

            <AnimatePresence>
                {result && (
                    <motion.div
                        key="result"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm border ${
                            result.ok
                                ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/50 text-emerald-800 dark:text-emerald-300'
                                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/50 text-red-800 dark:text-red-300'
                        }`}
                    >
                        {result.ok
                            ? <Check className="w-4 h-4 shrink-0 mt-0.5" />
                            : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                        <span>
                            {result.ok
                                ? `Connected! ${result.latencyMs ? `${result.latencyMs}ms` : ''}${result.modelUsed ? ` · ${result.modelUsed}` : ''}`
                                : result.error}
                        </span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
