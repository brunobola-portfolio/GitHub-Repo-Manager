import { useState, useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { ConfirmModal } from '../ui/ConfirmModal'
import { GitPullRequest, Plus, Loader2, CheckCircle2, XCircle, GitMerge, ExternalLink, ChevronDown } from 'lucide-react'
import { PRDetailPanel } from './PRDetailPanel'

export function PullRequestsTab({ owner, repo, api, onStartReview }) {
    const [pulls, setPulls] = useState([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('open')
    const [showCreate, setShowCreate] = useState(false)
    const [creating, setCreating] = useState(false)
    const [message, setMessage] = useState(null)
    const [form, setForm] = useState({ title: '', body: '', head: '', base: 'main', draft: false })
    const [selectedPR, setSelectedPR] = useState(null)
    const [branches, setBranches] = useState([])
    const [confirmAction, setConfirmAction] = useState(null)

    const loadPulls = async () => {
        setLoading(true)
        try {
            const data = await api.fetchPulls({ state: filter })
            setPulls(data.data || data || [])
        } catch { /* ignore */ } finally {
            setLoading(false)
        }
    }

    useEffect(() => { loadPulls() }, [owner, repo, filter]) // eslint-disable-line react-hooks/exhaustive-deps

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
            setForm({ title: '', body: '', head: '', base: 'main', draft: false })
            setShowCreate(false)
            loadPulls()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
        } finally {
            setCreating(false)
        }
    }

    const handleMerge = (pr) => {
        setConfirmAction({
            title: 'Merge Pull Request',
            message: `Merge PR #${pr.number} "${pr.title}"?`,
            confirmText: 'Merge',
            variant: 'warning',
            onConfirm: async () => {
                try {
                    await api.mergePull(pr.number)
                    setMessage({ type: 'success', text: `PR #${pr.number} merged` })
                    loadPulls()
                } catch (e) {
                    setMessage({ type: 'error', text: e.message })
                }
            }
        })
    }

    const handleClose = async (pr) => {
        try {
            await api.updatePull(pr.number, { state: 'closed' })
            setMessage({ type: 'success', text: `PR #${pr.number} closed` })
            loadPulls()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
        }
    }

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
                />
            </AnimatePresence>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <GitPullRequest className="w-5 h-5 text-indigo-500" />
                    Pull Requests
                </h3>
                <div className="flex items-center gap-2">
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
                    <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
                        <Plus className="w-4 h-4 mr-1" /> New PR
                    </Button>
                </div>
            </div>

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
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Title *</label>
                        <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                            placeholder="PR title"
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Head Branch *</label>
                            {branches.length > 0 ? (
                                <div className="relative">
                                    <select
                                        value={form.head}
                                        onChange={e => setForm(f => ({ ...f, head: e.target.value }))}
                                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm appearance-none pr-8"
                                    >
                                        <option value="">Select branch...</option>
                                        {branches.map(b => (
                                            <option key={b.name} value={b.name}>{b.name}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                                </div>
                            ) : (
                                <input type="text" value={form.head} onChange={e => setForm(f => ({ ...f, head: e.target.value }))}
                                    placeholder="feature-branch"
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
                            )}
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Base Branch *</label>
                            {branches.length > 0 ? (
                                <div className="relative">
                                    <select
                                        value={form.base}
                                        onChange={e => setForm(f => ({ ...f, base: e.target.value }))}
                                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm appearance-none pr-8"
                                    >
                                        <option value="">Select branch...</option>
                                        {branches.map(b => (
                                            <option key={b.name} value={b.name}>{b.name}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                                </div>
                            ) : (
                                <input type="text" value={form.base} onChange={e => setForm(f => ({ ...f, base: e.target.value }))}
                                    placeholder="main"
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
                            )}
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
                        <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                            rows={3} placeholder="Describe the changes..."
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm resize-none" />
                    </div>
                    <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={form.draft}
                                onChange={e => setForm(f => ({ ...f, draft: e.target.checked }))}
                                className="rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                            />
                            Create as draft
                        </label>
                        <div className="flex gap-2">
                            <Button size="sm" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
                            <Button size="sm" onClick={handleCreate} disabled={!form.title || !form.head || !form.base || creating}>
                                {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                                {form.draft ? 'Create Draft PR' : 'Create PR'}
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" /></div>
            ) : (
                <div className="space-y-2">
                    {pulls.map(pr => (
                        <Card key={pr.id} className="p-3 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-600 transition-colors" onClick={() => setSelectedPR(pr)}>
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5">{getPrIcon(pr)}</div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{pr.title}</span>
                                        <span className="text-xs text-slate-400">#{pr.number}</span>
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
                                                className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                                                View <ExternalLink className="w-3 h-3" />
                                            </a>
                                        )}
                                    </div>
                                </div>
                                {pr.state === 'open' && (
                                    <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
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
                        <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-8">No {filter !== 'all' ? filter : ''} pull requests</p>
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
    )
}
