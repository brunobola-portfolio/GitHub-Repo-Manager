import { useState, useEffect, useRef } from 'react'
import { Sparkles, Wand2, Loader2, CheckCircle2, RotateCcw, AlertTriangle } from 'lucide-react'
import { Modal, ModalFooter } from '../ui/Modal'
import { InsightCard } from '../ui/InsightCard'
import { Button } from '../ui/Button'
import { aiApi } from '../../api/ai'
import { reposApi } from '../../api/repos'
import { useToast } from '../../hooks/useToast'

function SkeletonCard({ height = 120 }) {
    return <div data-testid="suggest-skeleton" className="ds-skeleton rounded-xl" style={{ height }} />
}

function SourceBadge({ source }) {
    const isAI = source === 'ai'
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
            isAI
                ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30'
                : 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border border-slate-500/20'
        }`}>
            {isAI ? <Sparkles className="w-3 h-3" /> : <Wand2 className="w-3 h-3" />}
            {isAI ? 'AI' : 'Heuristic'}
        </span>
    )
}

function FieldCard({
    label,
    currentValue,
    proposedValue,
    onChange,
    useField,
    onToggleUse,
    onRestore,
    multiline = false,
    maxLength,
    noChange,
}) {
    if (noChange) {
        return (
            <InsightCard tone="success" hover={false}>
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    {label} already great — no change suggested.
                </div>
            </InsightCard>
        )
    }
    const Tag = multiline ? 'textarea' : 'input'
    const emptyCurrent = !currentValue
    return (
        <InsightCard hover={false}>
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">{label}</h3>
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={useField}
                        onChange={(e) => onToggleUse(e.target.checked)}
                        className="accent-indigo-500"
                        aria-label={`Use this ${label.toLowerCase()}`}
                    />
                    Use this {label.toLowerCase()}
                </label>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
                <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">Current</p>
                    <p className={`text-sm break-words ${emptyCurrent ? 'italic text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}>
                        {emptyCurrent ? '(no description set)' : currentValue}
                    </p>
                </div>
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-[11px] uppercase tracking-wider text-indigo-500">Proposed</p>
                        <button
                            type="button"
                            onClick={onRestore}
                            className="text-[11px] text-slate-500 hover:text-indigo-500 inline-flex items-center gap-1"
                            title="Restore original suggestion"
                        >
                            <RotateCcw className="w-3 h-3" /> Restore
                        </button>
                    </div>
                    <Tag
                        value={proposedValue}
                        onChange={(e) => onChange(e.target.value)}
                        maxLength={maxLength}
                        rows={multiline ? 3 : undefined}
                        disabled={!useField}
                        aria-label={`Proposed ${label.toLowerCase()}`}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-indigo-500/30 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
                    />
                </div>
            </div>
        </InsightCard>
    )
}

export default function SuggestNameDescriptionModal({ isOpen, repo, onClose, onApplied }) {
    const { toast } = useToast()
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [applying, setApplying] = useState(false)

    // Editable proposed values + per-field toggle + acknowledged-rename
    const [nameValue, setNameValue] = useState('')
    const [descValue, setDescValue] = useState('')
    const [useName, setUseName] = useState(true)
    const [useDesc, setUseDesc] = useState(true)
    const [ackRename, setAckRename] = useState(false)

    const abortRef = useRef(null)

    const startFetch = async () => {
        abortRef.current?.abort()
        const ctrl = new AbortController()
        abortRef.current = ctrl
        setLoading(true)
        setError(null)
        try {
            const result = await aiApi.suggestNameDescription(repo.id)
            if (ctrl.signal.aborted) return
            setData(result)
            setNameValue(result.proposed.name)
            setDescValue(result.proposed.description)
            setUseName(!result.noChange.name)
            setUseDesc(!result.noChange.description)
            setAckRename(false)
        } catch (e) {
            if (ctrl.signal.aborted) return
            setError(e)
        } finally {
            if (!ctrl.signal.aborted) setLoading(false)
        }
    }

    /* eslint-disable react-hooks/set-state-in-effect -- mount-time fetch + reset on repo change */
    useEffect(() => {
        if (!isOpen || !repo) {
            setData(null); setError(null); setLoading(false)
            return
        }
        startFetch()
        return () => abortRef.current?.abort()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, repo?.id])
    /* eslint-enable react-hooks/set-state-in-effect */

    const nameWillChange = useName && data && nameValue !== data.current.name
    const descWillChange = useDesc && data && descValue !== data.current.description
    const applyDisabled =
        applying ||
        loading ||
        !data ||
        (!nameWillChange && !descWillChange) ||
        (nameWillChange && !ackRename)

    const handleApply = async () => {
        if (!data || applyDisabled) return
        const payload = {}
        if (nameWillChange) payload.name = nameValue.trim()
        if (descWillChange) payload.description = descValue.trim()
        setApplying(true)
        try {
            const updated = await reposApi.updateRepo(repo.owner.login, repo.name, payload)
            toast.success('Repository updated')
            onApplied?.(updated)
            onClose?.()
        } catch (e) {
            toast.errorFromException(e, { fallbackTitle: 'Failed to apply changes' })
        } finally {
            setApplying(false)
        }
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Suggest Name & Description"
            subtitle={repo?.full_name}
            icon={Sparkles}
            iconGradient="primary"
            size="2xl"
            mobileVariant="sheet"
            isBusy={loading || applying}
            footer={
                <ModalFooter align="between">
                    <Button variant="ghost" onClick={startFetch} disabled={loading || applying}>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                        Regenerate
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={onClose}>Cancel</Button>
                        <button
                            type="button"
                            onClick={handleApply}
                            disabled={applyDisabled}
                            className="ds-btn-shimmer px-6 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium rounded-lg hover:from-indigo-400 hover:to-purple-500 transition-all shadow-lg shadow-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {applying ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
                            Apply changes
                        </button>
                    </div>
                </ModalFooter>
            }
        >
            <div aria-live="polite" className="sr-only">
                {loading ? 'Generating suggestion…' : data ? 'Suggestion ready.' : ''}
            </div>

            {data && (
                <div className="flex justify-end mb-3">
                    <SourceBadge source={data.source} />
                </div>
            )}

            {loading && (
                <div className="grid gap-4">
                    <SkeletonCard height={130} />
                    <SkeletonCard height={150} />
                    <SkeletonCard height={60} />
                </div>
            )}

            {error && !loading && (
                <InsightCard tone="danger" hover={false}>
                    <p className="text-red-600 dark:text-red-400 text-sm mb-2">Failed to generate a suggestion.</p>
                    <Button variant="ghost" onClick={startFetch}>Retry</Button>
                </InsightCard>
            )}

            {data && !loading && (
                <div className="grid gap-4">
                    <FieldCard
                        label="Name"
                        currentValue={data.current.name}
                        proposedValue={nameValue}
                        onChange={setNameValue}
                        useField={useName}
                        onToggleUse={setUseName}
                        onRestore={() => setNameValue(data.proposed.name)}
                        maxLength={100}
                        noChange={data.noChange.name}
                    />

                    {nameWillChange && (
                        <InsightCard tone="warning" hover={false}>
                            <label className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={ackRename}
                                    onChange={(e) => setAckRename(e.target.checked)}
                                    className="mt-0.5 accent-amber-500"
                                />
                                <span className="flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                    I understand renaming changes the repo URL and existing clone remotes.
                                </span>
                            </label>
                        </InsightCard>
                    )}

                    <FieldCard
                        label="Description"
                        currentValue={data.current.description}
                        proposedValue={descValue}
                        onChange={setDescValue}
                        useField={useDesc}
                        onToggleUse={setUseDesc}
                        onRestore={() => setDescValue(data.proposed.description)}
                        multiline
                        maxLength={500}
                        noChange={data.noChange.description}
                    />

                    <InsightCard tone="ai" hover={false}>
                        <div className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                            <Wand2 className="w-4 h-4 mt-0.5 text-indigo-500 shrink-0" />
                            {data.rationale}
                        </div>
                    </InsightCard>
                </div>
            )}
        </Modal>
    )
}
