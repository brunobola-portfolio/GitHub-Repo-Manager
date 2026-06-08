import { useState, useEffect, useMemo, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { ConfirmModal } from '../ui/ConfirmModal'
import { EmptyState } from '../ui/EmptyState'
import { SectionPanel } from '../ui/SectionPanel'
import { Select } from '../ui/Select'
import { GitPullRequest, Plus, Loader2, CheckCircle2, XCircle, GitMerge, ExternalLink, RefreshCw } from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { Field, Input, Textarea } from '../ui/form'
import { PRDetailPanel } from './PRDetailPanel'
import { PRRiskBadges } from './PRRiskBadges'
import { prActions } from '../../actions/prActions'
import { useTabData } from '../../hooks/useTabData'
import { useToast } from '../../hooks/useToast'
import { useFocusedRow } from '../../hooks/useFocusedRow'
import { emitAppEvent, onAppEvent, APP_EVENTS } from '../../utils/appEvents'

export function PullRequestsTab({ api, onStartReview, onGenerateDescription }) {
    const { toast } = useToast()
    const [filter, setFilter] = useState('open')
    const { data, loading, reload: loadPulls } = useTabData(
        async () => {
            const result = await api.fetchPulls({ state: filter })
            return result.data || result || []
        },
        [api, filter],
    )
    const pulls = useMemo(() => data || [], [data])

    // Hoist the current PR list to the App via a window CustomEvent so the
    // command palette's "Pull request actions" group can enumerate them.
    // Keeps the tab decoupled from App state — App.jsx listens once.
    useEffect(() => {
        if (!Array.isArray(pulls)) return
        emitAppEvent(APP_EVENTS.REPO_DETAIL_PRS_LOADED, pulls)
    }, [pulls])

    const [showCreate, setShowCreate] = useState(false)
    const [creating, setCreating] = useState(false)
    const [message, setMessage] = useState(null)
    const [form, setForm] = useState({ title: '', body: '', head: '', base: 'main', draft: false })
    const [selectedPR, setSelectedPR] = useState(null)
    const [branches, setBranches] = useState([])
    const [confirmAction, setConfirmAction] = useState(null)

    // Linear-style j/k navigation + Enter to open. Disabled while the detail
    // panel is open so the keys belong to the panel.
    const { focusedIndex } = useFocusedRow(selectedPR ? [] : pulls, {
        onOpen: (pr) => pr && setSelectedPR(pr),
    })
    const rowRefs = useRef([])
    useEffect(() => {
        const node = rowRefs.current[focusedIndex]
        if (node?.scrollIntoView) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, [focusedIndex])

    // Bridge event from the command palette via App.jsx — selects a PR
    // inside this tab so the detail panel renders.
    useEffect(() => {
        const handler = (ev) => {
            const pr = ev.detail
            if (pr && typeof pr.number === 'number') setSelectedPR(pr)
        }
        return onAppEvent(APP_EVENTS.REPO_DETAIL_SELECT_PR, handler)
    }, [])

    // Load branches when create form opens
    useEffect(() => {
        if (showCreate && api.fetchBranches) {
            api.fetchBranches().then(data => {
                const items = Array.isArray(data) ? data : data?.data || data || []
                setBranches(items)
            }).catch(() => {})
        }
    }, [showCreate, api])

    const handleCreate = async () => {
        if (!form.title || !form.head || !form.base) return
        setCreating(true)
        setMessage(null)
        try {
            await api.createPull(form)
            setMessage({ type: 'success', text: `Pull request "${form.title}" created` })
            toast.success(form.draft ? 'Draft pull request created' : 'Pull request created')
            setForm({ title: '', body: '', head: '', base: 'main', draft: false })
            setShowCreate(false)
            loadPulls()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
            toast.errorFromException(e, { fallbackTitle: 'Failed to create pull request' })
        } finally {
            setCreating(false)
        }
    }

    // Adopted from src/actions/prActions.js (Phase 3 / item 16). The
    // registry owns label, confirm shape, and run() side effects in one
    // place; this tab just wires the modal-confirm gate to ctx.
    const runPRAction = (action, pr) => {
        const ctx = {
            api,
            toast,
            refresh: loadPulls,
        }
        const cfg = action.confirm?.(pr)
        if (cfg) {
            setConfirmAction({
                ...cfg,
                onConfirm: async () => {
                    try {
                        await action.run(pr, ctx)
                        setMessage({ type: 'success', text: `${cfg.confirmText || 'Done'} #${pr.number}` })
                    } catch (e) {
                        setMessage({ type: 'error', text: e.message })
                        toast.errorFromException(e, { fallbackTitle: `${cfg.confirmText || action.id} failed` })
                    }
                },
            })
            return
        }
        // No confirm declared — run directly.
        action.run(pr, ctx).catch((e) => {
            setMessage({ type: 'error', text: e.message })
            toast.errorFromException(e, { fallbackTitle: `${action.id} failed` })
        })
    }
    const handleMerge = (pr) => runPRAction(prActions.merge_pr, pr)
    const handleClose = (pr) => runPRAction(prActions.close_pr, pr)

    function getPrIcon(pr) {
        if (pr.merged_at || pr.merged) return <GitMerge className="w-4 h-4 text-purple-500" />
        if (pr.state === 'closed') return <GitPullRequest className="w-4 h-4 text-red-500" />
        return <GitPullRequest className="w-4 h-4 text-green-500" />
    }

    // Show detail panel when a PR is selected
    if (selectedPR) {
        return (
            <AnimatePresence mode="wait">
                <PRDetailPanel
                    key={selectedPR.number}
                    pr={selectedPR}
                    api={api}
                    onClose={() => setSelectedPR(null)}
                    onUpdate={() => { setSelectedPR(null); loadPulls() }}
                    onStartReview={onStartReview}
                    onGenerateDescription={onGenerateDescription}
                />
            </AnimatePresence>
        )
    }

    return (
        <SectionPanel
            icon={GitPullRequest}
            title="Pull Requests"
            subtitle="Review, merge, and create requests for this repository"
            actions={
                <>
                    <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                        {['open', 'closed', 'all'].map(f => (
                            <button key={f} onClick={() => setFilter(f)}
                                className={`px-3 py-1.5 text-xs font-medium transition-colors capitalize
                                    ${filter === f
                                        ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                                    }`}>
                                {f}
                            </button>
                        ))}
                    </div>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={loadPulls}
                        disabled={loading}
                        aria-label="Refresh pull requests"
                        title="Refresh pull requests"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
                        <Plus className="w-4 h-4 mr-1" /> New PR
                    </Button>
                </>
            }
        >
        <div className="space-y-4">
            {message && (
                <div className={`flex items-center gap-2 p-2 rounded-lg text-sm ${
                    message.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                }`}>
                    {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    {message.text}
                </div>
            )}

            {showCreate && (
                <Card className="p-4 space-y-3">
                    <Field label="Title" required htmlFor="pr-title">
                        <Input id="pr-title" type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                            placeholder="PR title" aria-label="Pull request title" aria-required="true" />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label htmlFor="pr-head-branch" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Head Branch *</label>
                            {branches.length > 0 ? (
                                <Select
                                    label="Head branch"
                                    value={form.head}
                                    onChange={v => setForm(f => ({ ...f, head: v }))}
                                    placeholder="Select branch..."
                                    searchable
                                    options={[
                                        { value: '', label: 'Select branch...' },
                                        ...branches.map(b => ({ value: b.name, label: b.name })),
                                    ]}
                                />
                            ) : (
                                <Input id="pr-head-branch" type="text" value={form.head} onChange={e => setForm(f => ({ ...f, head: e.target.value }))}
                                    placeholder="feature-branch" aria-label="Head branch" aria-required="true" />
                            )}
                        </div>
                        <div>
                            <label htmlFor="pr-base-branch" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Base Branch *</label>
                            {branches.length > 0 ? (
                                <Select
                                    label="Base branch"
                                    value={form.base}
                                    onChange={v => setForm(f => ({ ...f, base: v }))}
                                    placeholder="Select branch..."
                                    searchable
                                    options={[
                                        { value: '', label: 'Select branch...' },
                                        ...branches.map(b => ({ value: b.name, label: b.name })),
                                    ]}
                                />
                            ) : (
                                <Input id="pr-base-branch" type="text" value={form.base} onChange={e => setForm(f => ({ ...f, base: e.target.value }))}
                                    placeholder="main" aria-label="Base branch" aria-required="true" />
                            )}
                        </div>
                    </div>
                    <Field label="Description" htmlFor="pr-body">
                        <Textarea id="pr-body" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                            rows={3} placeholder="Describe the changes..." aria-label="Pull request description" />
                    </Field>
                    <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={form.draft}
                                onChange={e => setForm(f => ({ ...f, draft: e.target.checked }))}
                                className="rounded border-slate-300 dark:border-slate-600 text-[color:var(--ds-accent-brand)] focus:ring-indigo-500"
                            />
                            Create as draft
                        </label>
                        <div className="flex gap-2">
                            <Button size="sm" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
                            <Button size="sm" onClick={handleCreate} disabled={!form.title || !form.head || !form.base || creating}>
                                {creating ? <Spinner size="sm" className="mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                                {form.draft ? 'Create Draft PR' : 'Create PR'}
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {loading ? (
                <div className="flex justify-center py-12"><Spinner size="lg" /></div>
            ) : (
                <div className="space-y-2">
                    {pulls.map((pr, idx) => (
                        <Card
                            key={pr.id ?? pr.number}
                            ref={(node) => { rowRefs.current[idx] = node }}
                            role="button"
                            tabIndex={0}
                            aria-label={`Open pull request #${pr.number}: ${pr.title}`}
                            className={`p-3 cursor-pointer transition-colors ds-focus-ring ${
                                idx === focusedIndex
                                    ? 'border-indigo-400 dark:border-indigo-600 bg-indigo-50/40 dark:bg-indigo-900/15 ring-1 ring-indigo-300 dark:ring-indigo-700/60'
                                    : 'hover:border-indigo-300 dark:hover:border-indigo-600'
                            }`}
                            onClick={() => setSelectedPR(pr)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    setSelectedPR(pr)
                                }
                            }}
                        >
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5">{getPrIcon(pr)}</div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{pr.title}</span>
                                        <span className="text-xs text-slate-400">#{pr.number}</span>
                                        <PRRiskBadges pr={pr} className="ml-1" />
                                    </div>
                                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
                                        <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">{pr.head?.ref}</span>
                                        <span>→</span>
                                        <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">{pr.base?.ref}</span>
                                    </div>
                                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                                        <span>{pr.user?.login}</span>
                                        <span>{new Date(pr.created_at).toLocaleDateString()}</span>
                                        {pr.html_url && (
                                            <a href={pr.html_url} target="_blank" rel="noopener noreferrer"
                                                onClick={e => e.stopPropagation()}
                                                className="text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline flex items-center gap-1">
                                                View <ExternalLink className="w-3 h-3" />
                                            </a>
                                        )}
                                    </div>
                                </div>
                                {pr.state === 'open' && (
                                    <div role="presentation" className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                        <Button variant="ghost" size="sm" onClick={() => handleMerge(pr)}
                                            className="text-purple-600 dark:text-purple-400 text-xs">
                                            <GitMerge className="w-3.5 h-3.5 mr-1" /> Merge
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => handleClose(pr)}
                                            className="text-red-500 dark:text-red-400 text-xs">
                                            Close
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </Card>
                    ))}
                    {pulls.length === 0 && (
                        <EmptyState
                            icon={GitPullRequest}
                            title="No open pull requests"
                            description="There are no open pull requests on this repository."
                        />
                    )}
                </div>
            )}

            <ConfirmModal
                isOpen={!!confirmAction}
                onClose={() => setConfirmAction(null)}
                onConfirm={() => { confirmAction?.onConfirm(); setConfirmAction(null) }}
                title={confirmAction?.title}
                message={confirmAction?.message}
                confirmText={confirmAction?.confirmText}
                variant={confirmAction?.variant || 'danger'}
            />
        </div>
        </SectionPanel>
    )
}
