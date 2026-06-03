import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Sparkles, Loader2, X, FileCode, FilePlus, FileX,
    FileEdit, ShieldAlert, FlaskConical, Clock, AlertTriangle,
} from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { AIRunButton } from '../ui/AIRunButton'
import { AIUnavailableBanner } from '../ui/AIUnavailableBanner'
import { AIErrorState } from '../ui/AIErrorState'
import { aiApi } from '../../api/ai'
import { Field, Textarea } from '../ui/form'

const ACTION_META = {
    create: { icon: FilePlus, color: 'text-emerald-600 dark:text-emerald-400', label: 'Create' },
    modify: { icon: FileEdit, color: 'text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]', label: 'Modify' },
    delete: { icon: FileX, color: 'text-rose-600 dark:text-rose-400', label: 'Delete' },
    rename: { icon: FileCode, color: 'text-amber-600 dark:text-amber-400', label: 'Rename' },
}

/**
 * AIIssuePlanner — side panel that asks the AI to produce a structured
 * implementation plan for a given issue. Plan-only mode: does NOT create
 * a branch or PR. Renders inline in the issue detail panel.
 *
 * Props:
 *   repoFullName  : "owner/repo"
 *   issueNumber   : number
 *   onClose       : () => void
 */
export function AIIssuePlanner({ repoFullName, issueNumber, onClose }) {
    const [plan, setPlan] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [extra, setExtra] = useState('')

    const generate = async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await aiApi.planIssue({
                repoFullName,
                issueNumber,
                extraContext: extra.trim() || undefined,
            })
            setPlan(res.plan)
        } catch (err) {
            if (err.status === 403 || err.status === 429) {
                setError({
                    type: 'upgrade',
                    message: err.message,
                    upgradeUrl: err.upgradeUrl || '/pricing',
                })
            } else if (err.code === 'AI_NOT_CONFIGURED' || err.status === 503) {
                setError({
                    type: 'config',
                    message: 'AI is not configured. Add a provider key in Settings → AI Configuration.',
                })
            } else {
                // Generic AI failures route through <AIErrorState> so they
                // share the same vocabulary (formatUserError) + retry CTA
                // pattern as every other AI surface in the app.
                setError({
                    type: 'generic',
                    raw: err,
                })
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <Card className="p-5 border-l-4 border-l-slate-300 dark:border-l-slate-600 bg-white dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI Issue-to-Plan</h4>
                        <p className="ds-text-meta text-slate-500 dark:text-slate-400">
                            Structured plan only — no branches or PRs are created.
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    aria-label="Close AI planner"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {!plan && !loading && (
                <div className="space-y-3">
                    <AIUnavailableBanner />
                    <div>
                        <Field label="Extra context (optional)" htmlFor="ai-issue-planner-extra">
                            <Textarea
                                id="ai-issue-planner-extra"
                                value={extra}
                                onChange={e => setExtra(e.target.value.slice(0, 2000))}
                                rows={3}
                                maxLength={2000}
                                placeholder="e.g. scope to the frontend, avoid DB migrations, reuse existing auth middleware…"
                            />
                        </Field>
                        <span className="block ds-text-micro text-right text-slate-400 mt-0.5">
                            {extra.length}/2000
                        </span>
                    </div>
                    <AIRunButton
                        size="sm"
                        onClick={generate}
                        loading={loading}
                        label="Generate plan"
                        className="w-full"
                    />
                </div>
            )}

            {loading && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                    <Spinner size="lg" />
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Reading issue, scanning repo, drafting plan…
                    </p>
                </div>
            )}

            <AnimatePresence>
                {error && error.type === 'generic' && (
                    <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                    >
                        <AIErrorState
                            error={error.raw}
                            onRetry={generate}
                            variant="card"
                            context="Issue plan"
                        />
                    </motion.div>
                )}
                {error && error.type !== 'generic' && (
                    <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={`p-3 rounded-xl text-sm flex items-start gap-2 ${
                            error.type === 'upgrade'
                                ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/50'
                                : 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50'
                        }`}
                    >
                        {error.type === 'upgrade'
                            ? <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            : <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                        <div className="flex-1">
                            <p>{error.message}</p>
                            {error.type === 'upgrade' && error.upgradeUrl && (
                                <a
                                    href={error.upgradeUrl}
                                    className="mt-1 inline-block text-xs font-semibold underline"
                                >
                                    View plans
                                </a>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {plan && (
                <div className="space-y-4">
                    {plan.title && (
                        <div>
                            <h5 className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-tight">
                                {plan.title}
                            </h5>
                        </div>
                    )}

                    {plan.approach && (
                        <div>
                            <p className="ds-text-meta font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                                Approach
                            </p>
                            <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                                {plan.approach}
                            </p>
                        </div>
                    )}

                    {plan.files?.length > 0 && (
                        <div>
                            <p className="ds-text-meta font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                                Files to touch ({plan.files.length})
                            </p>
                            <div className="space-y-1.5">
                                {plan.files.map((f, i) => {
                                    const meta = ACTION_META[f.action] || ACTION_META.modify
                                    const Icon = meta.icon
                                    return (
                                        <div
                                            key={`${f.path}-${i}`}
                                            className="flex items-start gap-2 p-2 rounded-lg bg-white/70 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40"
                                        >
                                            <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${meta.color}`} />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-baseline gap-2">
                                                    <span className={`ds-text-micro font-bold uppercase ${meta.color}`}>
                                                        {meta.label}
                                                    </span>
                                                    <span className="font-mono ds-text-meta text-slate-800 dark:text-slate-200 truncate">
                                                        {f.path}
                                                    </span>
                                                </div>
                                                {f.notes && (
                                                    <p className="ds-text-meta text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                                                        {f.notes}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {plan.tests && (
                        <div>
                            <p className="ds-text-meta font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1.5">
                                <FlaskConical className="w-3 h-3" /> Tests
                            </p>
                            <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                                {plan.tests}
                            </p>
                        </div>
                    )}

                    {plan.risks && (
                        <div>
                            <p className="ds-text-meta font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1.5">
                                <ShieldAlert className="w-3 h-3" /> Risks
                            </p>
                            <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                                {plan.risks}
                            </p>
                        </div>
                    )}

                    {plan.estimatedHours != null && plan.estimatedHours > 0 && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200/60 dark:border-slate-700/40">
                            <Clock className="w-3.5 h-3.5" />
                            Estimated effort:{' '}
                            <span className="font-semibold text-slate-700 dark:text-slate-300">
                                {plan.estimatedHours}h
                            </span>
                        </div>
                    )}

                    <div className="flex gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={generate}
                            disabled={loading}
                        >
                            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                            Regenerate
                        </Button>
                        <Button variant="ghost" size="sm" onClick={onClose}>
                            Close
                        </Button>
                    </div>
                </div>
            )}
        </Card>
    )
}
