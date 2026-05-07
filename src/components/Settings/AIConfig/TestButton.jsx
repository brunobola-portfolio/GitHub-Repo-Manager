import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Check, AlertTriangle, Loader2, Info, Lightbulb } from 'lucide-react'
import { Button } from '../../ui/Button'

// ---------------------------------------------------------------------------
// Sub-component: TestButton
// ---------------------------------------------------------------------------

const ERROR_PALETTE = {
    container:
        'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/50 text-red-800 dark:text-red-200',
    chip:
        'bg-red-100/80 dark:bg-red-900/40 text-red-700 dark:text-red-200 border-red-200/70 dark:border-red-700/40',
    hint:
        'bg-white/60 dark:bg-red-950/30 border-red-200/70 dark:border-red-800/40 text-red-900 dark:text-red-100',
}

function ErrorChip({ children }) {
    return (
        <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${ERROR_PALETTE.chip}`}
        >
            {children}
        </span>
    )
}

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
                {result && (result.ok
                    ? <SuccessCard key="ok" result={result} />
                    : <FailureCard key="err" result={result} />)}
            </AnimatePresence>
        </div>
    )
}

function SuccessCard({ result }) {
    const meta = [
        result.providerName,
        result.modelUsed,
        result.latencyMs != null ? `${result.latencyMs} ms` : null,
        result.dimensions != null ? `${result.dimensions} dims` : null,
    ].filter(Boolean).join(' · ')

    return (
        <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm border bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/50 text-emerald-800 dark:text-emerald-200"
        >
            <Check className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
                Connected{meta ? ` — ${meta}` : ''}
            </span>
        </motion.div>
    )
}

function FailureCard({ result }) {
    // Backwards compat: legacy responses only carry { ok: false, error }.
    const title = result.title || 'Provider call failed'
    const message = result.message || result.error || 'Unknown error'
    const hint = result.hint || null

    const showRaw = result.upstreamRaw && result.upstreamRaw !== message
    const chips = [
        result.code ? { key: 'code', label: result.code } : null,
        result.httpStatus ? { key: 'http', label: `HTTP ${result.httpStatus}` } : null,
        result.providerName ? { key: 'provider', label: result.providerName } : null,
        result.upstreamProvider ? { key: 'upstream', label: `via ${result.upstreamProvider}` } : null,
        result.errorType ? { key: 'type', label: result.errorType } : null,
    ].filter(Boolean)

    return (
        <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className={`flex items-start gap-2.5 px-3.5 py-3 rounded-xl text-sm border ${ERROR_PALETTE.container}`}
        >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-2">
                <div className="space-y-1">
                    <p className="font-semibold leading-tight">{title}</p>
                    <p className="text-[13px] leading-relaxed break-words">{message}</p>
                </div>

                {chips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {chips.map((c) => (
                            <ErrorChip key={c.key}>{c.label}</ErrorChip>
                        ))}
                    </div>
                )}

                {hint && (
                    <div className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border text-[12px] leading-relaxed ${ERROR_PALETTE.hint}`}>
                        <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>{hint}</span>
                    </div>
                )}

                {showRaw && (
                    <details className="text-[11px] opacity-80">
                        <summary className="cursor-pointer select-none hover:opacity-100">
                            Upstream details
                        </summary>
                        <pre className="mt-1.5 px-2.5 py-2 rounded-md bg-black/5 dark:bg-black/30 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug">
                            {result.upstreamRaw}
                        </pre>
                    </details>
                )}
            </div>
        </motion.div>
    )
}
