import { Sparkles, Cloud, KeyRound, ShieldAlert, CheckCircle2, Clock, AlertTriangle } from 'lucide-react'
import { PROVIDER_LABELS, PROVIDER_DEFAULTS } from '../../../utils/providerCapabilities'
import { useAIStatus } from '../../../hooks/useAIStatus'

function formatRelativeTime(iso) {
    if (!iso) return null
    const then = typeof iso === 'string' ? Date.parse(iso.endsWith('Z') ? iso : iso + 'Z') : Number(iso)
    if (!Number.isFinite(then)) return null
    const diffSec = Math.round((Date.now() - then) / 1000)
    if (diffSec < 0) return 'just now'
    if (diffSec < 45) return 'just now'
    if (diffSec < 90) return '1 minute ago'
    const diffMin = Math.round(diffSec / 60)
    if (diffMin < 60) return `${diffMin} minutes ago`
    const diffHr = Math.round(diffMin / 60)
    if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`
    const diffDay = Math.round(diffHr / 24)
    if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`
    return new Date(then).toLocaleDateString()
}

/**
 * CurrentConfigSummary — editorial summary card shown in the desktop right
 * rail. Surfaces, at a glance, what the user has configured right now: the
 * chosen provider, effective model id, whether a BYOK key is stored, any
 * embedding override, and the number of per-feature overrides.
 *
 * Hidden on mobile — the form column already shows the same info inline.
 */
export function CurrentConfigSummary({ form }) {
    const provider = form.completionProvider
    const hasKey = form.hasCompletionKey || (form.completionApiKey && form.completionApiKey.length > 0)
    const effectiveModel = form.completionModel || (provider ? PROVIDER_DEFAULTS[provider]?.modelPlaceholder : '') || null
    const overrideCount = Object.values(form.featureOverrides || {}).filter(Boolean).length
    const savedAgo = formatRelativeTime(form.updatedAt)
    const { keyHealth } = useAIStatus()

    return (
        <div className="rounded-2xl p-[1px] bg-gradient-to-br from-indigo-500/30 via-purple-500/20 to-pink-500/10 dark:from-indigo-500/40 dark:via-purple-500/30 dark:to-pink-500/20">
            <div className="rounded-2xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-4 space-y-4">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500" aria-hidden="true" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-300">
                        Current configuration
                    </span>
                </div>

                {!provider ? (
                    <div className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
                        <span>No provider selected — pick one to start.</span>
                    </div>
                ) : (
                    <>
                        <SummaryRow
                            label="Provider"
                            icon={Cloud}
                            value={PROVIDER_LABELS[provider]}
                            accent={hasKey ? 'emerald' : 'amber'}
                            hint={hasKey ? 'Key stored' : 'No key yet'}
                        />
                        {hasKey && keyHealth && keyHealth !== 'unknown' && (
                            <SummaryRow
                                label="Key health"
                                icon={keyHealth === 'ok' ? CheckCircle2 : AlertTriangle}
                                value={
                                    keyHealth === 'ok' ? 'Verified' :
                                    keyHealth === 'invalid' ? 'Rejected' :
                                    keyHealth === 'unreachable' ? 'Unreachable' :
                                    'Unknown'
                                }
                                accent={keyHealth === 'ok' ? 'emerald' : 'amber'}
                            />
                        )}
                        <SummaryRow
                            label="Model"
                            icon={Sparkles}
                            value={effectiveModel || '—'}
                            mono
                        />
                        {form.embeddingProvider && (
                            <SummaryRow
                                label="Embedding"
                                icon={KeyRound}
                                value={PROVIDER_LABELS[form.embeddingProvider]}
                                hint={form.embeddingModel || '—'}
                            />
                        )}
                        {overrideCount > 0 && (
                            <SummaryRow
                                label="Per-feature"
                                icon={CheckCircle2}
                                value={`${overrideCount} override${overrideCount === 1 ? '' : 's'}`}
                                accent="indigo"
                            />
                        )}
                        {form.serverFallbackAvailable && !hasKey && (
                            <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 ring-1 ring-inset ring-amber-200/60 dark:ring-amber-800/50 rounded-lg px-2 py-1.5">
                                Falling back to server key.
                            </div>
                        )}
                        {savedAgo && (
                            <div className="flex items-center gap-1.5 pt-2 -mb-1 border-t border-slate-200/70 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-400">
                                <Clock className="w-3 h-3" aria-hidden="true" />
                                <span>Saved {savedAgo}</span>
                                <span className="ml-auto inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                    <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                                    Persisted
                                </span>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

function SummaryRow({ label, icon: Icon, value, hint, mono = false, accent }) {
    const accentColor = {
        emerald: 'text-emerald-600 dark:text-emerald-400',
        amber: 'text-amber-600 dark:text-amber-400',
        indigo: 'text-indigo-600 dark:text-indigo-400',
    }[accent] || 'text-slate-700 dark:text-slate-200'

    return (
        <div className="flex items-start gap-3">
            <div className="w-7 h-7 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800/80 ring-1 ring-inset ring-slate-200/60 dark:ring-slate-700 flex items-center justify-center">
                <Icon className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">{label}</div>
                <div className={`text-sm font-semibold ${accentColor} ${mono ? 'font-mono text-xs' : ''} truncate`} title={typeof value === 'string' ? value : undefined}>
                    {value}
                </div>
                {hint && <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{hint}</div>}
            </div>
        </div>
    )
}
