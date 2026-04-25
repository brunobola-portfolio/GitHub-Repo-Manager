import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Check, AlertTriangle, Loader2, Info } from 'lucide-react'
import { Button } from '../../ui/Button'

// ---------------------------------------------------------------------------
// Sub-component: TestButton
// ---------------------------------------------------------------------------

export function TestButton({ onTest, disabled, result, countdown, isDirty }) {
    // Disable when dirty — /test hits the DB-stored config, so running it
    // against unsaved form state would produce misleading results (either a
    // false "ok" against an old provider, or a fall-through failure).
    const isDisabled = disabled || countdown > 0 || isDirty

    return (
        <div className="space-y-2">
            <Button variant="soft-primary" onClick={onTest} disabled={isDisabled}>
                {disabled && !countdown ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    <Sparkles className="w-4 h-4" />
                )}
                {countdown > 0
                    ? `Test Connection (${countdown}s)`
                    : 'Test Connection'}
            </Button>

            {isDirty && (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <Info className="w-3.5 h-3.5 shrink-0" />
                    Save your changes first to test the current configuration.
                </p>
            )}

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
