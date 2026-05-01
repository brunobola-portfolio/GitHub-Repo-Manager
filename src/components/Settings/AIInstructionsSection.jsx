import { useEffect, useState } from 'react'
import { Sparkles, Save, Undo2, RotateCcw, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { ConfirmModal } from '../ui/ConfirmModal'
import { useToast } from '../../hooks/useToast'
import { apiCall } from '../../utils/api'

const TEXTAREA_CLASSES = 'w-full px-3 py-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm font-mono leading-relaxed placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50'

function PromptEditor({ entry, onSaved, onReset }) {
    const { toast } = useToast()
    const [expanded, setExpanded] = useState(false)
    // Editing buffer; falls back to the user's current override or '' (which
    // shows the default as placeholder).
    const [draft, setDraft] = useState(entry.userPrompt || '')
    const [saving, setSaving] = useState(false)
    const [resetting, setResetting] = useState(false)
    const [showResetConfirm, setShowResetConfirm] = useState(false)

    useEffect(() => {
        // External changes to the entry (after save) refresh the buffer.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- sync local edit buffer with parent's persisted value
        setDraft(entry.userPrompt || '')
    }, [entry.userPrompt, entry.key])

    const trimmed = draft.trim()
    const isDirty = trimmed !== (entry.userPrompt || '').trim()
    const willCustomize = !entry.hasOverride && trimmed.length > 0
    const canSave = trimmed.length > 0 && trimmed.length <= 8000 && (isDirty || willCustomize)

    const handleSave = async () => {
        if (!canSave) return
        setSaving(true)
        try {
            const result = await apiCall(`/api/ai/prompts/${entry.key}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: trimmed }),
            })
            toast.success(`${entry.title} — saved`)
            onSaved?.(result)
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: 'Failed to save prompt' })
        } finally {
            setSaving(false)
        }
    }

    const handleReset = async () => {
        setResetting(true)
        try {
            await apiCall(`/api/ai/prompts/${entry.key}`, { method: 'DELETE' })
            toast.success(`${entry.title} — reverted to default`)
            setDraft('')
            onReset?.(entry.key)
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: 'Failed to reset prompt' })
        } finally {
            setResetting(false)
            setShowResetConfirm(false)
        }
    }

    const fillFromDefault = () => setDraft(entry.defaultPrompt)

    return (
        <Card className="p-5 space-y-3">
            <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                aria-expanded={expanded}
                className="w-full flex items-start gap-3 text-left -m-1 p-1 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
            >
                <div className="mt-0.5">
                    {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">{entry.title}</h4>
                        {entry.hasOverride ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-700/40">
                                <CheckCircle2 className="w-3 h-3" /> Customized
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Default
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{entry.description}</p>
                </div>
            </button>

            {expanded && (
                <div className="space-y-3 pt-2 border-t border-slate-200/60 dark:border-slate-700/50">
                    {entry.variables?.length > 0 && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                            Variables you can use:&nbsp;
                            {entry.variables.map((v, i) => (
                                <span key={v}>
                                    <code className="font-mono px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">{`{${v}}`}</code>
                                    {i < entry.variables.length - 1 ? ', ' : ''}
                                </span>
                            ))}
                        </div>
                    )}

                    <div>
                        <label htmlFor={`prompt-editor-${entry.key}`} className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">Your prompt</label>
                        <textarea
                            id={`prompt-editor-${entry.key}`}
                            rows={Math.min(20, Math.max(8, (draft.match(/\n/g)?.length ?? 0) + 4))}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            placeholder={entry.defaultPrompt}
                            disabled={saving || resetting}
                            className={TEXTAREA_CLASSES}
                            maxLength={8000}
                        />
                        <div className="flex items-center justify-between mt-1.5">
                            <p className="text-[11px] text-slate-400">
                                {draft.length}/8000 chars
                                {!entry.hasOverride && draft.length === 0 && ' · placeholder shows the default prompt'}
                            </p>
                            <button
                                type="button"
                                onClick={fillFromDefault}
                                className="text-[11px] text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300"
                            >
                                Copy default into editor
                            </button>
                        </div>
                    </div>

                    {trimmed.length > 8000 && (
                        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
                            <AlertTriangle className="w-3.5 h-3.5" /> Prompt is too long — trim to 8000 characters or fewer.
                        </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                        <div>
                            {entry.hasOverride && (
                                <Button variant="ghost" size="sm" onClick={() => setShowResetConfirm(true)} disabled={saving || resetting}>
                                    {resetting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RotateCcw className="w-3.5 h-3.5 mr-1" />}
                                    Reset to default
                                </Button>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {isDirty && entry.hasOverride && (
                                <Button variant="ghost" size="sm" onClick={() => setDraft(entry.userPrompt || '')} disabled={saving}>
                                    <Undo2 className="w-3.5 h-3.5 mr-1" /> Discard
                                </Button>
                            )}
                            <Button size="sm" onClick={handleSave} disabled={!canSave || saving || resetting}>
                                {saving ? <Spinner size="sm" className="mr-1" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                                Save override
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={showResetConfirm}
                onClose={() => setShowResetConfirm(false)}
                onConfirm={handleReset}
                title="Reset prompt to default?"
                message={`Your custom "${entry.title}" prompt will be deleted and the AI will use the built-in default again. This cannot be undone.`}
                confirmText="Reset to default"
                variant="warning"
            />
        </Card>
    )
}

export function AIInstructionsSection() {
    const { toast } = useToast()
    const [prompts, setPrompts] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    const load = async () => {
        setLoading(true)
        setError(null)
        try {
            const data = await apiCall('/api/ai/prompts')
            setPrompts(Array.isArray(data?.prompts) ? data.prompts : [])
        } catch (err) {
            setError(err)
            toast.errorFromException(err, { fallbackTitle: 'Failed to load prompts' })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleSaved = (saved) => {
        setPrompts(prev => prev.map(p => p.key === saved.key
            ? { ...p, hasOverride: !!saved.hasOverride, userPrompt: saved.prompt, updatedAt: new Date().toISOString() }
            : p))
    }

    const handleReset = (key) => {
        setPrompts(prev => prev.map(p => p.key === key
            ? { ...p, hasOverride: false, userPrompt: null, updatedAt: null }
            : p))
    }

    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-indigo-500/15 to-purple-500/15">
                    <Sparkles className="w-5 h-5 text-indigo-500" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Custom AI Instructions</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl mt-0.5">
                        Override the system prompts for individual AI features. Your customization replaces the default text the model receives. Tone, formatting, and language all become yours to control. The structural parts that the app needs (action whitelist, JSON schemas) are always preserved automatically.
                    </p>
                </div>
            </div>

            {loading ? (
                <Card className="p-8"><div className="flex justify-center"><Spinner size="lg" /></div></Card>
            ) : error ? (
                <Card className="p-5 border-red-200 dark:border-red-900/50">
                    <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                        <AlertTriangle className="w-4 h-4 mt-0.5" />
                        <div className="flex-1">
                            <p className="mb-2">Could not load prompt registry.</p>
                            <Button variant="ghost" size="sm" onClick={load}>Retry</Button>
                        </div>
                    </div>
                </Card>
            ) : prompts.length === 0 ? (
                <Card className="p-8 text-center">
                    <p className="text-sm text-slate-500 dark:text-slate-400">No customizable prompts available.</p>
                </Card>
            ) : (
                prompts.map(p => (
                    <PromptEditor key={p.key} entry={p} onSaved={handleSaved} onReset={handleReset} />
                ))
            )}
        </div>
    )
}
