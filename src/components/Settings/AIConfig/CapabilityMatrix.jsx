import { Cpu, AlertTriangle } from 'lucide-react'
import {
    PROVIDER_IDS,
    PROVIDER_LABELS,
    PROVIDER_CAPABILITIES,
    FEATURE_LABELS,
} from '../../../utils/providerCapabilities'

// ---------------------------------------------------------------------------
// Premium CapabilityMatrix — compact matrix with a single column-header row
// and dot-only cells. Kept within the right rail (18rem) and still legible
// when the modal reflows to full-width on mobile.
// ---------------------------------------------------------------------------

const FEATURE_KEYS = Object.keys(FEATURE_LABELS)

const DOT_STATE = {
    yes: {
        dot: 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]',
        label: 'Supported',
    },
    depends: {
        dot: 'bg-amber-400 shadow-[0_0_0_3px_rgba(245,158,11,0.12)]',
        label: 'Depends on configuration',
    },
    no: {
        dot: 'bg-slate-300 dark:bg-slate-600',
        label: 'Not supported',
    },
}

export function CapabilityMatrix({ activeProvider }) {
    return (
        <div className="rounded-2xl bg-white/70 dark:bg-slate-900/60 backdrop-blur-md ring-1 ring-inset ring-slate-200/70 dark:ring-slate-800 p-4 space-y-3">
            <div className="flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5 text-brand-500" aria-hidden="true" />
                <span className="ds-text-micro font-semibold uppercase tracking-[0.14em] text-[color:var(--ds-accent-brand)] dark:text-brand-300">
                    Provider Capabilities
                </span>
            </div>

            {/* Feature legend — named once, dots below align to this order */}
            <ul
                aria-hidden="true"
                className="flex flex-wrap gap-x-3 gap-y-1 pb-2 border-b border-slate-200/70 dark:border-slate-800"
            >
                {FEATURE_KEYS.map((fk, i) => (
                    <li
                        key={fk}
                        className="inline-flex items-center gap-1.5 ds-text-micro font-medium text-slate-500 dark:text-slate-400"
                    >
                        <span className="font-mono text-[9px] text-slate-500 dark:text-slate-400 w-3 text-right">{i + 1}</span>
                        {FEATURE_LABELS[fk]}
                    </li>
                ))}
            </ul>

            <ul className="space-y-0.5">
                {PROVIDER_IDS.map((pid) => {
                    const isActive = pid === activeProvider
                    const caps = PROVIDER_CAPABILITIES[pid] || {}
                    return (
                        <li
                            key={pid}
                            className={`relative grid grid-cols-[minmax(0,1fr)_repeat(4,1.25rem)] gap-x-1.5 items-center rounded-lg px-2 py-1.5 transition-colors ${
                                isActive
                                    ? 'bg-brand-50/80 dark:bg-brand-900/20 ring-1 ring-inset ring-brand-500/30'
                                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                            }`}
                        >
                            {isActive && (
                                <span
                                    aria-hidden="true"
                                    className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-brand-500"
                                />
                            )}
                            <div className="flex items-center gap-1.5 min-w-0">
                                <span className={`text-xs font-semibold truncate ${isActive ? 'text-brand-700 dark:text-brand-200' : 'text-slate-700 dark:text-slate-200'}`}>
                                    {PROVIDER_LABELS[pid]}
                                </span>
                                {isActive && (
                                    <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-brand-500 text-white shrink-0">
                                        active
                                    </span>
                                )}
                            </div>
                            {FEATURE_KEYS.map((fk) => {
                                const state = caps[fk] || 'no'
                                const style = DOT_STATE[state] || DOT_STATE.no
                                return (
                                    <span
                                        key={fk}
                                        title={`${FEATURE_LABELS[fk]} — ${style.label}`}
                                        className="flex justify-center"
                                    >
                                        <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
                                        <span className="sr-only">{FEATURE_LABELS[fk]}: {style.label}.</span>
                                    </span>
                                )
                            })}
                        </li>
                    )
                })}
            </ul>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 border-t border-slate-200/70 dark:border-slate-800 ds-text-micro uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <Legend state="yes" label="Supported" />
                <Legend state="depends" label="Depends" />
                <Legend state="no" label="Unavailable" />
            </div>

            {activeProvider && PROVIDER_CAPABILITIES[activeProvider]?.semanticSearch !== 'yes' && (
                <p className="flex items-start gap-1.5 ds-text-meta text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 ring-1 ring-inset ring-amber-200/60 dark:ring-amber-800/50 rounded-lg px-2 py-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>Semantic search needs an embedding provider. Configure one above, or switch to a provider with native embeddings (e.g. Gemini or OpenAI).</span>
                </p>
            )}
        </div>
    )
}

function Legend({ state, label }) {
    const style = DOT_STATE[state]
    return (
        <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={`inline-block w-1.5 h-1.5 rounded-full ${style.dot}`} />
            {label}
        </span>
    )
}
