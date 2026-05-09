import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Wand2, Loader2, CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import { Modal, ModalFooter } from '../ui/Modal'
import { InsightCard } from '../ui/InsightCard'
import { Button } from '../ui/Button'
import { aiApi } from '../../api/ai'
import { reposApi } from '../../api/repos'
import { useToast } from '../../hooks/useToast'
import { useAIStatus } from '../../hooks/useAIStatus'
import { ContextPicker } from './ContextPicker'
import { PremiumRationale } from './PremiumRationale'
import { FileTreePicker } from './FileTreePicker'
import { useContextPrefs } from '../../hooks/useContextPrefs'

function SourceBadge({ source }) {
    if (!source) return null
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

/**
 * Field block with three rendering modes:
 *
 * - `manual`     — no AI suggestion yet; show a single editable input.
 *                  This is the entry state and the always-available
 *                  fallback when AI is unavailable / errors out.
 * - `suggestion` — AI proposed a different value; show Current vs Proposed.
 * - `noChange`   — AI inspected and judged the current value already good;
 *                  collapsed to a confirmation card.
 */
function FieldCard({
    label,
    mode,
    currentValue,
    proposedValue,
    onChange,
    useField,
    onToggleUse,
    onRestore,
    multiline = false,
    maxLength,
}) {
    if (mode === 'noChange') {
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

    if (mode === 'manual') {
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
                <Tag
                    value={proposedValue}
                    onChange={(e) => onChange(e.target.value)}
                    maxLength={maxLength}
                    rows={multiline ? 3 : undefined}
                    disabled={!useField}
                    aria-label={`Edit ${label.toLowerCase()}`}
                    placeholder={!proposedValue ? `Enter ${label.toLowerCase()}…` : undefined}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
                />
                <p className="text-[11px] text-slate-400 mt-2">Edit manually, or use “Suggest with AI” below to fill this in.</p>
            </InsightCard>
        )
    }

    // 'suggestion' mode — Current vs Proposed split.
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
                            className="text-[11px] text-slate-500 hover:text-indigo-500"
                            title="Restore original suggestion"
                        >
                            Restore
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
    const aiStatus = useAIStatus()
    const aiOff = !aiStatus.loading && !aiStatus.configured

    const { prefs, setSignal, reset: resetPrefs } = useContextPrefs()
    const [customFiles, setCustomFiles] = useState([])
    const [pickerOpen, setPickerOpen] = useState(false)

    // The repo prop is the single source of truth for "current" values; the
    // form starts in manual mode (proposed = current) so the user can edit
    // straight away without waiting for any AI call.
    const initialName = repo?.name || ''
    const initialDesc = repo?.description || ''

    const [suggestion, setSuggestion] = useState(null) // server response or null
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [applying, setApplying] = useState(false)

    const [nameValue, setNameValue] = useState(initialName)
    const [descValue, setDescValue] = useState(initialDesc)
    const [useName, setUseName] = useState(true)
    const [useDesc, setUseDesc] = useState(true)
    const [ackRename, setAckRename] = useState(false)
    const [confirmingRegenerate, setConfirmingRegenerate] = useState(false)

    const abortRef = useRef(null)

    // Reset every time the modal is opened against a different repo. We keep
    // existing state when isOpen flips false→true with the same repo so an
    // accidental close doesn't drop user edits.
    /* eslint-disable react-hooks/set-state-in-effect -- mount-time reset on open / repo change */
    useEffect(() => {
        if (!isOpen) {
            abortRef.current?.abort()
            return
        }
        setSuggestion(null)
        setError(null)
        setNameValue(initialName)
        setDescValue(initialDesc)
        setUseName(true)
        setUseDesc(true)
        setAckRename(false)
        setConfirmingRegenerate(false)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only the repo identity matters
    }, [isOpen, repo?.id])
    /* eslint-enable react-hooks/set-state-in-effect */

    const fetchSuggestion = async () => {
        if (!repo) return
        abortRef.current?.abort()
        const ctrl = new AbortController()
        abortRef.current = ctrl
        setLoading(true)
        setError(null)
        try {
            const result = await aiApi.suggestNameDescription(repo.id, {
                context: {
                    signals: prefs.signals,
                    customFiles: customFiles.map((f) => f.path),
                },
            })
            if (ctrl.signal.aborted) return
            setSuggestion(result)
            setNameValue(result.proposed.name)
            setDescValue(result.proposed.description)
            setUseName(!result.noChange.name)
            setUseDesc(!result.noChange.description)
            setAckRename(false)
            setConfirmingRegenerate(false)
        } catch (e) {
            if (ctrl.signal.aborted) return
            setError(e)
        } finally {
            if (!ctrl.signal.aborted) setLoading(false)
        }
    }

    const userHasEdits = Boolean(
        suggestion && (
            nameValue !== suggestion.proposed.name
            || descValue !== suggestion.proposed.description
        ),
    )

    // Single button in the footer that triggers either the first AI fetch or
    // a regenerate, with a confirm step when unsaved edits would be lost.
    const onSuggestClick = () => {
        if (userHasEdits && !confirmingRegenerate) {
            setConfirmingRegenerate(true)
            return
        }
        setConfirmingRegenerate(false)
        fetchSuggestion()
    }

    const nameMode = useMemo(() => {
        if (!suggestion) return 'manual'
        if (suggestion.noChange.name) return 'noChange'
        return 'suggestion'
    }, [suggestion])

    const descMode = useMemo(() => {
        if (!suggestion) return 'manual'
        if (suggestion.noChange.description) return 'noChange'
        return 'suggestion'
    }, [suggestion])

    const trimmedName = nameValue.trim()
    const trimmedDesc = descValue.trim()
    const nameWillChange = useName && trimmedName !== initialName.trim() && trimmedName.length > 0
    const descWillChange = useDesc && trimmedDesc !== initialDesc.trim()
    const nothingToApply = !nameWillChange && !descWillChange
    const applyDisabled =
        applying
        || loading
        || nothingToApply
        || (nameWillChange && !ackRename)

    const handleApply = async () => {
        if (applyDisabled) return
        const payload = {}
        if (nameWillChange) payload.name = trimmedName
        if (descWillChange) payload.description = trimmedDesc
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

    const suggestLabel = (() => {
        if (loading) return 'Generating…'
        if (confirmingRegenerate) return 'Discard edits & regenerate?'
        if (suggestion) return 'Regenerate'
        return aiOff ? 'Suggest (heuristic)' : 'Suggest with AI'
    })()

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Suggest Name & Description"
            subtitle={repo?.full_name}
            icon={Sparkles}
            iconGradient="primary"
            size="2xl"
            closeOnBackdrop={false}
            mobileVariant="sheet"
            isBusy={applying}
            footer={
                <ModalFooter align="between">
                    <Button
                        variant={confirmingRegenerate ? 'danger' : 'ghost'}
                        onClick={onSuggestClick}
                        disabled={loading || applying}
                        title={aiOff ? 'AI is not configured — uses a deterministic heuristic instead' : undefined}
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />}
                        {suggestLabel}
                    </Button>
                    <div className="flex gap-2 items-center">
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
                {loading ? 'Generating suggestion…' : suggestion ? 'Suggestion ready.' : ''}
            </div>

            {/* Status row: AI source badge once we have one, OR a soft notice when AI is off. */}
            <div className="flex items-center justify-between gap-3 mb-3 min-h-[1.5rem]">
                {aiOff && !suggestion && !error ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5" />
                        AI not configured. Edit manually or use the heuristic suggester.
                    </p>
                ) : <span />}
                {suggestion && <SourceBadge source={suggestion.source} />}
            </div>

            {error && (
                <InsightCard tone="warning" hover={false}>
                    <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        <div>
                            <p className="mb-1">Could not generate a suggestion. You can still edit and apply changes manually.</p>
                            <Button variant="ghost" size="sm" onClick={fetchSuggestion} disabled={loading}>
                                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                                Retry
                            </Button>
                        </div>
                    </div>
                </InsightCard>
            )}

            <ContextPicker
                mode="single"
                signals={prefs.signals}
                onSignalChange={setSignal}
                customFiles={customFiles}
                onAddCustomFile={() => setPickerOpen(true)}
                onRemoveCustomFile={(p) => setCustomFiles((prev) => prev.filter((f) => f.path !== p))}
                onReset={() => { resetPrefs(); setCustomFiles([]) }}
            />

            <FileTreePicker
                isOpen={pickerOpen}
                owner={repo?.owner?.login}
                repoName={repo?.name}
                branch={repo?.default_branch}
                onPick={(entry) => {
                    if (customFiles.length >= 5) { setPickerOpen(false); return }
                    if (customFiles.find((f) => f.path === entry.path)) { setPickerOpen(false); return }
                    setCustomFiles((prev) => [...prev, entry])
                    setPickerOpen(false)
                }}
                onClose={() => setPickerOpen(false)}
            />

            <div className="grid gap-4 mt-3">
                <FieldCard
                    label="Name"
                    mode={nameMode}
                    currentValue={initialName}
                    proposedValue={nameValue}
                    onChange={setNameValue}
                    useField={useName}
                    onToggleUse={setUseName}
                    onRestore={() => suggestion && setNameValue(suggestion.proposed.name)}
                    maxLength={100}
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
                    mode={descMode}
                    currentValue={initialDesc}
                    proposedValue={descValue}
                    onChange={setDescValue}
                    useField={useDesc}
                    onToggleUse={setUseDesc}
                    onRestore={() => suggestion && setDescValue(suggestion.proposed.description)}
                    multiline
                    maxLength={500}
                />

                {suggestion && (
                    <PremiumRationale
                        source={suggestion.source}
                        rationale={suggestion.rationale}
                        confidence={suggestion.confidence}
                        signalsUsed={suggestion.signalsUsed}
                        redactions={suggestion.redactions}
                    />
                )}
            </div>
        </Modal>
    )
}
