import { Sparkles, Wand2, Info, AlertTriangle, ShieldCheck } from 'lucide-react'

const CONFIDENCE_STYLE = {
    high: { dot: 'bg-emerald-500', label: 'HIGH', color: 'text-emerald-700 dark:text-emerald-300' },
    medium: { dot: 'bg-amber-500', label: 'MEDIUM', color: 'text-amber-700 dark:text-amber-300' },
    low: { dot: 'bg-rose-500', label: 'LOW', color: 'text-rose-700 dark:text-rose-300' },
}

function formatBytes(bytes) {
    if (typeof bytes !== 'number') return ''
    if (bytes < 1024) return `${bytes}B`
    return `${(bytes / 1024).toFixed(1)}KB`
}

export function PremiumRationale({ source, rationale, confidence, signalsUsed = [], redactions = [] }) {
    const conf = CONFIDENCE_STYLE[confidence] || CONFIDENCE_STYLE.low
    const isAI = source === 'ai'
    const totalRedactedLines = redactions.reduce((n, r) => n + (r.count || 0), 0)

    return (
        <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-3 space-y-2">
            <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ds-text-micro font-semibold uppercase tracking-wider ${
                    isAI
                        ? 'bg-indigo-500/20 text-[color:var(--ds-accent-brand)] dark:text-indigo-300 border border-indigo-500/30'
                        : 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border border-slate-500/20'
                }`}>
                    {isAI ? <Sparkles className="w-3 h-3" /> : <Wand2 className="w-3 h-3" />}
                    {isAI ? 'AI' : 'Heuristic'}
                </span>
                <span className={`inline-flex items-center gap-1 ds-text-meta font-semibold uppercase tracking-wider ${conf.color}`}>
                    <span className={`w-2 h-2 rounded-full ${conf.dot}`} aria-hidden="true" />
                    Confidence {conf.label}
                </span>
            </div>

            <p className="text-sm text-slate-700 dark:text-slate-200">{rationale}</p>

            {signalsUsed.length > 0 && (
                <div>
                    <p className="ds-text-micro uppercase tracking-wider text-slate-400 mb-1">Signals used</p>
                    <ul className="flex flex-wrap gap-1">
                        {signalsUsed.map((s) => (
                            <li key={s.kind + ':' + s.label} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300">
                                {s.label}{s.bytes ? ` ${formatBytes(s.bytes)}` : ''}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {totalRedactedLines > 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                    {totalRedactedLines} line{totalRedactedLines === 1 ? '' : 's'} redacted from {redactions.map((r) => r.file).join(', ')} (possible secrets)
                </p>
            )}

            {confidence === 'low' && (
                <p className="text-xs text-amber-700 dark:text-amber-300 inline-flex items-start gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    Suggestion quality limited — README is empty or too short. Consider adding more signals or improving the README first.
                </p>
            )}

            {!isAI && (
                <p className="ds-text-meta text-slate-400 inline-flex items-center gap-1">
                    <Info className="w-3 h-3" /> AI not available — used deterministic fallback.
                </p>
            )}
        </section>
    )
}
