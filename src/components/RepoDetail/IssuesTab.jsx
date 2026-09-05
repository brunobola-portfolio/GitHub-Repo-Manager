import { useState, useEffect, useMemo, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { SectionPanel } from '../ui/SectionPanel'
import { CircleDot, Plus, Loader2, CheckCircle2, XCircle, MessageSquare, ExternalLink, RefreshCw } from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { Field, Input, Textarea } from '../ui/form'
import { IssueDetailPanel } from './IssueDetailPanel'
import { useTabData } from '../../hooks/useTabData'
import { useToast } from '../../hooks/useToast'
import { useFocusedRow } from '../../hooks/useFocusedRow'
import { issueActions } from '../../actions/issueActions'
import { emitAppEvent, onAppEvent, APP_EVENTS } from '../../utils/appEvents'
import { formatRelativeTime, formatDateTime } from '../../utils/format'
import { issueLabelChipStyle } from '../../utils/issueLabelColors'
import { TabLoadError } from './TabLoadError'

export function IssuesTab({ api, repoFullName }) {
    const { toast } = useToast()
    const [filter, setFilter] = useState('open')
    const { data, loading, error, reload: loadIssues } = useTabData(
        async () => {
            const result = await api.fetchIssues({ state: filter })
            const items = result.data || result || []
            // Filter out pull requests (GitHub API returns PRs as issues too)
            return items.filter(i => !i.pull_request)
        },
        [api, filter],
    )
    const issues = useMemo(() => data || [], [data])

    // Hoist the issue list to App.jsx via a window CustomEvent so the
    // command palette's "Issue actions" group can enumerate them.
    useEffect(() => {
        if (!Array.isArray(issues)) return
        emitAppEvent(APP_EVENTS.REPO_DETAIL_ISSUES_LOADED, issues)
    }, [issues])

    const [showCreate, setShowCreate] = useState(false)
    const [creating, setCreating] = useState(false)
    const [message, setMessage] = useState(null)
    const [form, setForm] = useState({ title: '', body: '' })
    const [selectedIssue, setSelectedIssue] = useState(null)

    const { focusedIndex } = useFocusedRow(selectedIssue ? [] : issues, {
        onOpen: (issue) => issue && setSelectedIssue(issue),
    })
    const rowRefs = useRef([])
    useEffect(() => {
        const node = rowRefs.current[focusedIndex]
        if (node?.scrollIntoView) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, [focusedIndex])

    // Bridge events from the command palette via App.jsx. The palette emits
    // `app:open-issue-detail` (App.jsx routes to `repo-detail:select-issue`)
    // and `app:plan-issue-with-ai` (routed to `repo-detail:plan-issue`); we
    // open the detail panel and let it auto-focus the planner / comment
    // composer based on the bridge payload.
    useEffect(() => {
        const onSelect = (ev) => {
            const issue = ev.detail?.issue
            if (issue && typeof issue.number === 'number') setSelectedIssue(issue)
        }
        const onPlan = (ev) => {
            const issue = ev.detail
            if (issue && typeof issue.number === 'number') setSelectedIssue(issue)
        }
        const offs = [
            onAppEvent(APP_EVENTS.REPO_DETAIL_SELECT_ISSUE, onSelect),
            onAppEvent(APP_EVENTS.REPO_DETAIL_PLAN_ISSUE, onPlan),
        ]
        return () => offs.forEach(off => off())
    }, [])

    const handleCreate = async () => {
        if (!form.title) return
        setCreating(true)
        setMessage(null)
        try {
            await api.createIssue(form)
            setMessage({ type: 'success', text: `Issue "${form.title}" created` })
            toast.success('Issue created')
            setForm({ title: '', body: '' })
            setShowCreate(false)
            loadIssues()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
            toast.errorFromException(e, { fallbackTitle: 'Failed to create issue' })
        } finally {
            setCreating(false)
        }
    }

    // Adopted from src/actions/issueActions.js (Phase 3 / item 16). The
    // registry owns the API call + toast in one place; we skip the
    // close_issue.confirm gate here because the existing UX has been
    // confirmless and adding a modal would be a behaviour change. Callers
    // that want the gate (e.g. command palette) can opt in.
    const runIssueAction = async (action, issue) => {
        try {
            await action.run(issue, { api, toast, refresh: loadIssues })
            setMessage({ type: 'success', text: `Issue #${issue.number} ${action.id === 'close_issue' ? 'closed' : 'reopened'}` })
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
            toast.errorFromException(e, { fallbackTitle: `${action.id} failed` })
        }
    }
    const handleClose = (issue) => runIssueAction(issueActions.close_issue, issue)
    const handleReopen = (issue) => runIssueAction(issueActions.reopen_issue, issue)

    // Show detail panel when an issue is selected
    if (selectedIssue) {
        return (
            <AnimatePresence mode="wait">
                <IssueDetailPanel
                    key={selectedIssue.number}
                    issue={selectedIssue}
                    api={api}
                    repoFullName={repoFullName}
                    onClose={() => setSelectedIssue(null)}
                    onUpdate={() => { setSelectedIssue(null); loadIssues() }}
                />
            </AnimatePresence>
        )
    }

    return (
        <SectionPanel
            icon={CircleDot}
            title="Issues"
            subtitle="Track and triage issues for this repository"
            actions={
                <>
                    <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                        {['open', 'closed', 'all'].map(f => (
                            <button key={f} onClick={() => setFilter(f)}
                                className={`px-3 py-1.5 text-xs font-medium transition-colors capitalize
                                    ${filter === f
                                        ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300'
                                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                                    } ds-focus-ring rounded`}>
                                {f}
                            </button>
                        ))}
                    </div>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={loadIssues}
                        disabled={loading}
                        aria-label="Refresh issues"
                        title="Refresh issues"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
                        <Plus className="w-4 h-4 mr-1" /> New Issue
                    </Button>
                </>
            }
        >
        <div className="space-y-4">
            {message && (
                <div className={`flex items-center gap-2 p-2 rounded-lg text-sm ${
                    message.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400'
                }`}>
                    {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    {message.text}
                </div>
            )}

            {showCreate && (
                <Card className="p-4 space-y-3">
                    <Field label="Title" required htmlFor="issue-title">
                        <Input id="issue-title" type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                            placeholder="Issue title" aria-label="Issue title" aria-required="true" />
                    </Field>
                    <Field label="Description" htmlFor="issue-body">
                        <Textarea id="issue-body" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                            rows={4} placeholder="Describe the issue..." aria-label="Issue description" />
                    </Field>
                    <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
                        <Button size="sm" onClick={handleCreate} disabled={!form.title || creating}>
                            {creating ? <Spinner size="sm" className="mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                            Submit
                        </Button>
                    </div>
                </Card>
            )}

            {loading ? (
                <div className="flex justify-center py-12"><Spinner size="lg" /></div>
            ) : error ? (
                <TabLoadError error={error} onRetry={loadIssues} resourceLabel="issues" />
            ) : (
                <div className="space-y-2">
                    {issues.map((issue, idx) => (
                        <Card
                            key={issue.id}
                            ref={(node) => { rowRefs.current[idx] = node }}
                            className={`relative p-3 cursor-pointer transition-colors ${
                                idx === focusedIndex
                                    ? 'border-brand-400 dark:border-brand-600 bg-brand-50/40 dark:bg-brand-900/15 ring-1 ring-brand-300 dark:ring-brand-700/60'
                                    : 'hover:border-brand-300 dark:hover:border-brand-600'
                            }`}
                        >
                            <div className="flex items-start gap-3">
                                <div className={`mt-0.5 ${issue.state === 'open' ? 'text-emerald-500' : 'text-brand-500'}`}>
                                    <CircleDot className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        {/* Title is the row's primary control; its
                                            `after` overlay stretches over the whole
                                            Card so the entire row still opens on click,
                                            while the View link + action button sit above
                                            it via z-10. Replaces the former role="button"
                                            Card (nested-interactive). */}
                                        <button
                                            type="button"
                                            onClick={() => setSelectedIssue(issue)}
                                            aria-label={`Open issue #${issue.number}: ${issue.title}`}
                                            className="font-medium text-sm text-slate-900 dark:text-slate-100 text-left rounded-sm ds-focus-ring after:absolute after:inset-0 after:content-['']"
                                        >
                                            {issue.title}
                                        </button>
                                        <span className="text-xs text-slate-500 dark:text-slate-400">#{issue.number}</span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                        {issue.labels?.map(l => (
                                            <span key={l.name} className="text-xs px-1.5 py-0.5 rounded-full font-medium text-[color:var(--lbl-fg)] dark:text-[color:var(--lbl-fg-dark)]"
                                                style={issueLabelChipStyle(l.color)}>
                                                {l.name}
                                            </span>
                                        ))}
                                    </div>
                                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                                        <span>{issue.user?.login}</span>
                                        <span title={formatDateTime(issue.created_at)}>{formatRelativeTime(issue.created_at)}</span>
                                        {issue.comments > 0 && (
                                            <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {issue.comments}</span>
                                        )}
                                        {issue.html_url && (
                                            <a href={issue.html_url} target="_blank" rel="noopener noreferrer"
                                                onClick={e => e.stopPropagation()}
                                                className="relative z-10 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline flex items-center gap-1">
                                                View <ExternalLink className="w-3 h-3" />
                                            </a>
                                        )}
                                    </div>
                                </div>
                                <div role="presentation" className="relative z-10" onClick={e => e.stopPropagation()}>
                                    {issue.state === 'open' ? (
                                        <Button variant="ghost" size="sm" onClick={() => handleClose(issue)} className="text-brand-600 dark:text-brand-400 text-xs shrink-0">
                                            Close
                                        </Button>
                                    ) : (
                                        <Button variant="ghost" size="sm" onClick={() => handleReopen(issue)} className="text-emerald-700 dark:text-emerald-400 text-xs shrink-0">
                                            Reopen
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </Card>
                    ))}
                    {issues.length === 0 && (
                        <EmptyState
                            icon={CircleDot}
                            title="No open issues"
                            description="This repository has no open issues right now."
                        />
                    )}
                </div>
            )}
        </div>
        </SectionPanel>
    )
}
