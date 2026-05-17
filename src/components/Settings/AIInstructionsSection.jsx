import { useEffect, useMemo, useState } from 'react'
import {
    Sparkles, Save, Undo2, RotateCcw, ChevronDown, ChevronRight,
    AlertTriangle, CheckCircle2, Loader2, Search, Copy, Check, Wand2,
} from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { ConfirmModal } from '../ui/ConfirmModal'
import { Field, Input, Textarea } from '../ui/form'
import { PanelHeader } from '../ui/PanelHeader'
import { EmptyState } from '../ui/EmptyState'
import { useToast } from '../../hooks/useToast'
import { apiCall } from '../../utils/api'

const READONLY_CLASSES = 'w-full px-3.5 py-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-700/70 text-slate-700 dark:text-slate-200 text-sm font-mono leading-relaxed whitespace-pre-wrap break-words overflow-auto'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mirror of server's renderPrompt — replaces every `{var}` token with its
 * supplied value. Uses literal split/join so values containing `{…}` won't
 * be re-expanded into placeholder loops.
 */
function renderPromptClient(template, vars = {}) {
    if (typeof template !== 'string') return ''
    let out = template
    for (const [key, value] of Object.entries(vars || {})) {
        const token = `{${key}}`
        const replacement = value === undefined || value === null ? '' : String(value)
        out = out.split(token).join(replacement)
    }
    return out
}

/**
 * Cheap line-level diff metric — counts lines whose content differs between
 * the two inputs (unequal length counts as a difference). Good enough to drive
 * the "N changes" chip without pulling in a real diff library.
 */
function countLineDifferences(a, b) {
    if (a === b) return 0
    const aLines = (a || '').split('\n')
    const bLines = (b || '').split('\n')
    const max = Math.max(aLines.length, bLines.length)
    let diffs = 0
    for (let i = 0; i < max; i++) {
        if ((aLines[i] || '') !== (bLines[i] || '')) diffs++
    }
    return diffs
}

function CategoryBadge({ category }) {
    if (!category || category === 'General') return null
    return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/40">
            {category}
        </span>
    )
}

function CopyButton({ getText, label = 'Copy' }) {
    const [copied, setCopied] = useState(false)
    const onClick = async () => {
        const text = getText()
        if (!text) return
        try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            // Clipboard API can fail in iframes / insecure contexts. Silent —
            // the user still has the text visible to copy manually.
        }
    }
    return (
        <button
            type="button"
            onClick={onClick}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : label}
        </button>
    )
}

// ---------------------------------------------------------------------------
// Per-prompt editor — Editor / Default / Preview tabs
// ---------------------------------------------------------------------------

// Tab labels are intentionally distinct from the in-panel form `<label>` text
// (e.g. the editor's own "Your prompt" textarea label) so testing-library's
// getByLabelText returns the form control, not the tabpanel's aria-labelledby
// chain that would otherwise collide.
const TABS = [
    { id: 'editor', label: 'Editor' },
    { id: 'default', label: 'Default' },
    { id: 'preview', label: 'Preview' },
]

function TabButton({ active, onClick, children, id, controls }) {
    return (
        <button
            type="button"
            role="tab"
            id={id}
            aria-selected={active}
            aria-controls={controls}
            tabIndex={active ? 0 : -1}
            onClick={onClick}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                active
                    ? 'bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-200'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
        >
            {children}
        </button>
    )
}

function PromptEditor({ entry, onSaved, onReset }) {
    const { toast } = useToast()
    const [expanded, setExpanded] = useState(false)
    const [tab, setTab] = useState('editor')
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

    // Effective text the model would actually receive: user override when set
    // (or being edited), else the default. Used by the Preview tab.
    const effectivePrompt = (trimmed.length > 0 ? trimmed : entry.defaultPrompt) || ''
    const previewText = useMemo(
        () => renderPromptClient(effectivePrompt, entry.sampleVars || {}),
        [effectivePrompt, entry.sampleVars],
    )
    const diffCount = useMemo(
        () => countLineDifferences(effectivePrompt, entry.defaultPrompt || ''),
        [effectivePrompt, entry.defaultPrompt],
    )

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

    const fillFromDefault = () => {
        setDraft(entry.defaultPrompt)
        setTab('editor')
    }

    return (
        <Card className="p-5 space-y-3">
            <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                aria-expanded={expanded}
                className="w-full flex items-start gap-3 text-left -m-1 p-1 rounded-lg ds-focus-ring"
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
                        <CategoryBadge category={entry.category} />
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{entry.description}</p>
                </div>
            </button>

            {expanded && (
                <div className="space-y-3 pt-2 border-t border-slate-200/60 dark:border-slate-700/50">
                    {/* Tab strip */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div role="tablist" aria-label="Prompt views" className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/60">
                            {TABS.map(t => (
                                <TabButton
                                    key={t.id}
                                    id={`prompt-tab-${entry.key}-${t.id}`}
                                    controls={`prompt-tabpanel-${entry.key}-${t.id}`}
                                    active={tab === t.id}
                                    onClick={() => setTab(t.id)}
                                >
                                    {t.label}
                                </TabButton>
                            ))}
                        </div>
                        <div className="flex items-center gap-1">
                            {diffCount > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40">
                                    {diffCount} line{diffCount === 1 ? '' : 's'} differ
                                </span>
                            )}
                            <CopyButton
                                getText={() => {
                                    if (tab === 'default') return entry.defaultPrompt
                                    if (tab === 'preview') return previewText
                                    return draft || entry.defaultPrompt
                                }}
                            />
                        </div>
                    </div>

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

                    {/* Tab panels */}
                    {tab === 'editor' && (
                        <div
                            role="tabpanel"
                            id={`prompt-tabpanel-${entry.key}-editor`}
                            aria-labelledby={`prompt-tab-${entry.key}-editor`}
                        >
                            <Field label="Your prompt" htmlFor={`prompt-editor-${entry.key}`}>
                                <Textarea
                                    id={`prompt-editor-${entry.key}`}
                                    rows={Math.min(20, Math.max(8, (draft.match(/\n/g)?.length ?? 0) + 4))}
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    placeholder={entry.defaultPrompt}
                                    disabled={saving || resetting}
                                    className="font-mono leading-relaxed"
                                    maxLength={8000}
                                />
                            </Field>
                            <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
                                <p className="text-[11px] text-slate-400">
                                    {draft.length}/8000 chars
                                    {!entry.hasOverride && draft.length === 0 && ' · placeholder shows the default prompt'}
                                </p>
                                <button
                                    type="button"
                                    onClick={fillFromDefault}
                                    className="inline-flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300"
                                >
                                    <Wand2 className="w-3 h-3" /> Copy default into editor
                                </button>
                            </div>
                        </div>
                    )}

                    {tab === 'default' && (
                        <div
                            role="tabpanel"
                            id={`prompt-tabpanel-${entry.key}-default`}
                            aria-labelledby={`prompt-tab-${entry.key}-default`}
                        >
                            <p className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                                Built-in default — used when you have no override.
                            </p>
                            <pre className={READONLY_CLASSES} style={{ maxHeight: 480 }}>
                                {entry.defaultPrompt}
                            </pre>
                            <p className="text-[11px] text-slate-400 mt-1.5">
                                {(entry.defaultPrompt || '').length} chars · read-only reference
                            </p>
                        </div>
                    )}

                    {tab === 'preview' && (
                        <div
                            role="tabpanel"
                            id={`prompt-tabpanel-${entry.key}-preview`}
                            aria-labelledby={`prompt-tab-${entry.key}-preview`}
                        >
                            <p className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                                Preview with sample data — exactly what the model would receive.
                            </p>
                            <pre className={READONLY_CLASSES} style={{ maxHeight: 480 }}>
                                {previewText}
                            </pre>
                            <p className="text-[11px] text-slate-400 mt-1.5">
                                {entry.variables?.length
                                    ? `Sample values shown for ${entry.variables.map(v => `{${v}}`).join(', ')}.`
                                    : 'No variables for this prompt — preview matches the prompt verbatim.'}
                            </p>
                        </div>
                    )}

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

// ---------------------------------------------------------------------------
// Section shell — search, stats, list
// ---------------------------------------------------------------------------

export function AIInstructionsSection() {
    const { toast } = useToast()
    const [prompts, setPrompts] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [query, setQuery] = useState('')

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
        let cancelled = false
        const run = async () => {
            setLoading(true)
            setError(null)
            try {
                const data = await apiCall('/api/ai/prompts')
                if (cancelled) return
                setPrompts(Array.isArray(data?.prompts) ? data.prompts : [])
            } catch (err) {
                if (cancelled) return
                setError(err)
                toast.errorFromException(err, { fallbackTitle: 'Failed to load prompts' })
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        run()
        return () => { cancelled = true }
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

    // Lower-case match across title, description, and category. Search is
    // local — the registry has a small bounded set of entries so debouncing
    // would just add jitter for no benefit.
    const filteredPrompts = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return prompts
        return prompts.filter(p =>
            (p.title || '').toLowerCase().includes(q)
            || (p.description || '').toLowerCase().includes(q)
            || (p.category || '').toLowerCase().includes(q)
            || (p.key || '').toLowerCase().includes(q),
        )
    }, [prompts, query])

    const customizedCount = prompts.filter(p => p.hasOverride).length
    const totalCount = prompts.length

    return (
        <div className="space-y-5">
            <PanelHeader
                eyebrowIcon={Sparkles}
                eyebrow="AI Instructions"
                title="Custom AI Instructions"
                description="Override the system prompts for individual AI features. Your customization replaces the default text the model receives. Tone, formatting and language all become yours to control — structural parts (action whitelist, JSON schemas) are always preserved automatically."
            />

            {!loading && !error && totalCount > 0 && (
                <Card className="p-3.5">
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-1 min-w-[180px]">
                            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-900/30">
                                <Sparkles className="w-4 h-4 text-indigo-500 dark:text-indigo-300" />
                            </span>
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-tight">
                                    {customizedCount} of {totalCount} with overrides
                                </p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    {totalCount - customizedCount} feature{totalCount - customizedCount === 1 ? '' : 's'} using built-in defaults
                                </p>
                            </div>
                        </div>
                        <div className="w-full sm:w-auto sm:flex-1 sm:max-w-sm">
                            <Input
                                type="search"
                                size="sm"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search prompts…"
                                aria-label="Search prompts"
                                leadingIcon={Search}
                            />
                        </div>
                    </div>
                </Card>
            )}

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
                <EmptyState
                    icon={Sparkles}
                    title="No customizable prompts available"
                    description="There are no AI features wired up for prompt customization on this build."
                />
            ) : filteredPrompts.length === 0 ? (
                <EmptyState
                    icon={Search}
                    title={`No prompts match "${query}"`}
                    description="Try a different search term."
                    action={{ label: 'Clear search', onClick: () => setQuery('') }}
                />
            ) : (
                filteredPrompts.map(p => (
                    <PromptEditor key={p.key} entry={p} onSaved={handleSaved} onReset={handleReset} />
                ))
            )}
        </div>
    )
}
