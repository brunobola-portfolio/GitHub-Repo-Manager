import { useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, CheckCircle2, AlertCircle, Lock, RotateCcw, Ban } from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { useAIPolish } from '../../hooks/useAIPolish'

/**
 * Batch table for post-migration AI polish.
 *
 * Phase A scope: description column only. The spec at
 * docs/specs/2026-05-08-post-migration-ai-polish.md describes the full
 * feature — topics, README, wizard step. This component is structured so
 * those columns can be added without refactoring.
 *
 * Data flows in via `repoFullNames`; the hook handles batch fetch + apply.
 * `onAppliedRepo` is forwarded into the apply call so the parent can patch
 * the global repo lists in-place via `patchRepoEverywhere`.
 */
export function PolishReview({ repoFullNames, onAppliedRepo, onRequestClose, onApplyComplete }) {
    const { rows, phase, stats, quotaHit, setProposedDescription, toggleInclude, retryRow, apply } = useAIPolish(repoFullNames)

    const handleApply = useCallback(async () => {
        const result = await apply(onAppliedRepo)
        if (typeof onApplyComplete === 'function') onApplyComplete(result)
    }, [apply, onAppliedRepo, onApplyComplete])

    const applyDisabled = stats.includedReady === 0 || phase === 'applying'

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-500/25 shrink-0">
                        <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Polir descriptions com AI</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {stats.total} repo{stats.total === 1 ? '' : 's'} migrado{stats.total === 1 ? '' : 's'} — sugestões geradas por AI baseadas no README + linguagem.
                        </p>
                    </div>
                </div>
            </div>

            {/* Quota banner */}
            {quotaHit && (
                <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-300/60 dark:border-amber-700/50 bg-amber-50/70 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                        <p className="font-medium">Quota AI esgotada</p>
                        <p className="text-xs opacity-90 mt-0.5">Os repos restantes ficaram sem sugestão. Os já carregados podem ainda ser editados e aplicados manualmente.</p>
                    </div>
                </div>
            )}

            {/* Table */}
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                <div className="grid grid-cols-[40px_1fr_2fr_120px] text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
                    <span aria-hidden="true" />
                    <span>Repo</span>
                    <span>Description</span>
                    <span className="text-right">Status</span>
                </div>

                <AnimatePresence initial={false}>
                    {rows.map((row, idx) => (
                        <motion.div
                            key={row.fullName}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.18, delay: Math.min(idx * 0.03, 0.3) }}
                            className={`grid grid-cols-[40px_1fr_2fr_120px] items-center gap-2 px-3 py-3 border-b border-slate-100 dark:border-slate-800 last:border-b-0 ${row.include ? '' : 'opacity-50'}`}
                        >
                            {/* Include toggle */}
                            <div className="flex items-center justify-center">
                                <input
                                    type="checkbox"
                                    checked={row.include}
                                    onChange={() => toggleInclude(row.fullName)}
                                    disabled={row.status === 'applying' || row.status === 'done'}
                                    aria-label={`Include ${row.fullName}`}
                                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500/40 cursor-pointer"
                                />
                            </div>

                            {/* Repo name */}
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                                    <Lock className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />
                                    <span className="truncate">{row.fullName}</span>
                                </div>
                                {row.currentDescription && (
                                    <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5" title={row.currentDescription}>
                                        Was: {row.currentDescription}
                                    </p>
                                )}
                            </div>

                            {/* Description editor / state */}
                            <div className="min-w-0">
                                {(row.status === 'idle' || row.status === 'resolving' || row.status === 'loading') && (
                                    <div className="h-9 rounded-md ds-skeleton" />
                                )}
                                {(row.status === 'ready' || row.status === 'applying' || row.status === 'done') && (
                                    <input
                                        type="text"
                                        value={row.proposedDescription}
                                        onChange={(e) => setProposedDescription(row.fullName, e.target.value)}
                                        disabled={!row.include || row.status === 'applying' || row.status === 'done'}
                                        placeholder="No suggestion"
                                        aria-label={`Description for ${row.fullName}`}
                                        className="w-full px-2.5 py-1.5 text-sm rounded-md bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
                                    />
                                )}
                                {row.status === 'error' && (
                                    <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400">
                                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                        <span className="truncate flex-1" title={row.error || ''}>{row.error || 'Failed'}</span>
                                        <button
                                            type="button"
                                            onClick={() => retryRow(row.fullName)}
                                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40"
                                        >
                                            <RotateCcw className="w-3 h-3" /> Retry
                                        </button>
                                    </div>
                                )}
                                {row.status === 'quota' && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
                                        <Ban className="w-3 h-3" /> Skipped (quota)
                                    </p>
                                )}
                            </div>

                            {/* Status pill */}
                            <div className="flex justify-end">
                                {row.status === 'resolving' || row.status === 'loading' ? (
                                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                        <Spinner size="xs" />
                                        {row.status === 'resolving' ? 'Resolving' : 'Loading'}
                                    </span>
                                ) : row.status === 'applying' ? (
                                    <span className="inline-flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400">
                                        <Spinner size="xs" /> Applying
                                    </span>
                                ) : row.status === 'done' ? (
                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                        <CheckCircle2 className="w-3.5 h-3.5" /> Applied
                                    </span>
                                ) : row.status === 'ready' ? (
                                    <span className="text-xs text-slate-400 dark:text-slate-500">Ready</span>
                                ) : null}
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            {/* Footer summary + actions */}
            <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    {stats.includedReady} of {stats.total} ready to apply
                    {stats.error > 0 && ` · ${stats.error} failed`}
                    {stats.done > 0 && ` · ${stats.done} applied`}
                </p>
                <div className="flex items-center gap-2">
                    {typeof onRequestClose === 'function' && (
                        <button
                            type="button"
                            onClick={onRequestClose}
                            disabled={phase === 'applying'}
                            className="px-4 py-2 text-sm font-medium rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                        >
                            {phase === 'done' ? 'Close' : 'Cancel'}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleApply}
                        disabled={applyDisabled}
                        className="ds-btn-shimmer inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/25 hover:from-indigo-400 hover:to-purple-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {phase === 'applying' ? <Spinner size="xs" /> : <Sparkles className="w-3.5 h-3.5" />}
                        Apply to {stats.includedReady} repo{stats.includedReady === 1 ? '' : 's'}
                    </button>
                </div>
            </div>
        </div>
    )
}
