import { useState, useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { CircleDot, Plus, Loader2, CheckCircle2, XCircle, MessageSquare, ExternalLink } from 'lucide-react'
import { IssueDetailPanel } from './IssueDetailPanel'

export function IssuesTab({ owner, repo, api }) {
    const [issues, setIssues] = useState([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('open')
    const [showCreate, setShowCreate] = useState(false)
    const [creating, setCreating] = useState(false)
    const [message, setMessage] = useState(null)
    const [form, setForm] = useState({ title: '', body: '' })
    const [selectedIssue, setSelectedIssue] = useState(null)

    const loadIssues = async () => {
        setLoading(true)
        try {
            const data = await api.fetchIssues({ state: filter })
            const items = data.data || data || []
            // Filter out pull requests (GitHub API returns PRs as issues too)
            setIssues(items.filter(i => !i.pull_request))
        } catch { /* ignore */ } finally {
            setLoading(false)
        }
    }

    useEffect(() => { loadIssues() }, [owner, repo, filter]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleCreate = async () => {
        if (!form.title) return
        setCreating(true)
        setMessage(null)
        try {
            await api.createIssue(form)
            setMessage({ type: 'success', text: `Issue "${form.title}" created` })
            setForm({ title: '', body: '' })
            setShowCreate(false)
            loadIssues()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
        } finally {
            setCreating(false)
        }
    }

    const handleClose = async (issue) => {
        try {
            await api.updateIssue(issue.number, { state: 'closed' })
            setMessage({ type: 'success', text: `Issue #${issue.number} closed` })
            loadIssues()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
        }
    }

    const handleReopen = async (issue) => {
        try {
            await api.updateIssue(issue.number, { state: 'open' })
            setMessage({ type: 'success', text: `Issue #${issue.number} reopened` })
            loadIssues()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
        }
    }

    // Show detail panel when an issue is selected
    if (selectedIssue) {
        return (
            <AnimatePresence mode="wait">
                <IssueDetailPanel
                    key={selectedIssue.number}
                    issue={selectedIssue}
                    api={api}
                    onClose={() => setSelectedIssue(null)}
                    onUpdate={() => { setSelectedIssue(null); loadIssues() }}
                />
            </AnimatePresence>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <CircleDot className="w-5 h-5 text-indigo-500" />
                    Issues
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
                        <Plus className="w-4 h-4 mr-1" /> New Issue
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
                            placeholder="Issue title"
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
                        <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                            rows={4} placeholder="Describe the issue..."
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm resize-none" />
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
                        <Button size="sm" onClick={handleCreate} disabled={!form.title || creating}>
                            {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                            Submit
                        </Button>
                    </div>
                </Card>
            )}

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" /></div>
            ) : (
                <div className="space-y-2">
                    {issues.map(issue => (
                        <Card key={issue.id} className="p-3 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-600 transition-colors" onClick={() => setSelectedIssue(issue)}>
                            <div className="flex items-start gap-3">
                                <div className={`mt-0.5 ${issue.state === 'open' ? 'text-green-500' : 'text-purple-500'}`}>
                                    <CircleDot className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{issue.title}</span>
                                        <span className="text-xs text-slate-400">#{issue.number}</span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                        {issue.labels?.map(l => (
                                            <span key={l.name} className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                                                style={{ backgroundColor: `#${l.color}20`, color: `#${l.color}`, borderColor: `#${l.color}40`, borderWidth: 1 }}>
                                                {l.name}
                                            </span>
                                        ))}
                                    </div>
                                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                                        <span>{issue.user?.login}</span>
                                        <span>{new Date(issue.created_at).toLocaleDateString()}</span>
                                        {issue.comments > 0 && (
                                            <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {issue.comments}</span>
                                        )}
                                        {issue.html_url && (
                                            <a href={issue.html_url} target="_blank" rel="noopener noreferrer"
                                                onClick={e => e.stopPropagation()}
                                                className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                                                View <ExternalLink className="w-3 h-3" />
                                            </a>
                                        )}
                                    </div>
                                </div>
                                <div onClick={e => e.stopPropagation()}>
                                    {issue.state === 'open' ? (
                                        <Button variant="ghost" size="sm" onClick={() => handleClose(issue)} className="text-purple-600 dark:text-purple-400 text-xs shrink-0">
                                            Close
                                        </Button>
                                    ) : (
                                        <Button variant="ghost" size="sm" onClick={() => handleReopen(issue)} className="text-green-600 dark:text-green-400 text-xs shrink-0">
                                            Reopen
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </Card>
                    ))}
                    {issues.length === 0 && (
                        <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-8">No {filter !== 'all' ? filter : ''} issues</p>
                    )}
                </div>
            )}
        </div>
    )
}
