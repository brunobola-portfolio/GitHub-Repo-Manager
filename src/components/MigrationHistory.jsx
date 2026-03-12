import { useState, useEffect } from 'react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import {
    History, CheckCircle2, XCircle, Loader2, ExternalLink,
    Clock, ArrowRight, RefreshCw, Cloud, Globe, GitBranch
} from 'lucide-react'
import { useFocusTrap } from '../hooks/useFocusTrap'

const SOURCE_ICONS = {
    azure: Cloud,
    url: Globe,
    github: GitBranch
}

const STATUS_STYLES = {
    complete: { bg: 'bg-green-100 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-400', icon: CheckCircle2 },
    failed: { bg: 'bg-red-100 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-400', icon: XCircle },
    running: { bg: 'bg-blue-100 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-400', icon: Loader2 },
    pending: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400', icon: Clock }
}

export function MigrationHistory({ isOpen, onClose }) {
    const modalRef = useFocusTrap(isOpen, onClose)
    const [jobs, setJobs] = useState([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('all')

    const loadJobs = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/migrations?per_page=50', { credentials: 'include' })
            if (res.status === 401) {
                setJobs([])
                return
            }
            const data = await res.json()
            setJobs(data.jobs || [])
        } catch { /* ignore */ } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (isOpen) loadJobs()
    }, [isOpen])

    if (!isOpen) return null

    const filteredJobs = filter === 'all' ? jobs : jobs.filter(j => j.status === filter)

    return (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
            <Card ref={modalRef} className="w-full max-w-2xl p-6 max-h-[85vh] flex flex-col" role="dialog" aria-modal="true" aria-labelledby="migration-history-title">
                <div className="flex items-center justify-between mb-4">
                    <h2 id="migration-history-title" className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                        <History className="w-6 h-6 text-indigo-500" />
                        Migration History
                    </h2>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={loadJobs} disabled={loading}>
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 text-2xl leading-none">&times;</button>
                    </div>
                </div>

                {/* Filter */}
                <div className="flex items-center gap-1 mb-4 rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 overflow-hidden w-fit">
                    {['all', 'complete', 'running', 'failed'].map(f => (
                        <button key={f} onClick={() => setFilter(f)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize
                                ${filter === f
                                    ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                                }`}>
                            {f}
                        </button>
                    ))}
                </div>

                {/* Jobs list */}
                <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
                    {loading ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" /></div>
                    ) : filteredJobs.length === 0 ? (
                        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                            <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
                            <p className="text-sm">No migrations found</p>
                        </div>
                    ) : (
                        filteredJobs.map(job => {
                            const status = STATUS_STYLES[job.status] || STATUS_STYLES.pending
                            const StatusIcon = status.icon
                            const SourceIcon = SOURCE_ICONS[job.sourceType] || Globe
                            const meta = job.metadata ? (typeof job.metadata === 'string' ? JSON.parse(job.metadata) : job.metadata) : null

                            return (
                                <div key={job.id} className="p-3 rounded-xl border border-slate-200/60 dark:border-slate-700/50 bg-white/50 dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                                    <div className="flex items-start gap-3">
                                        <div className={`p-1.5 rounded-lg ${status.bg}`}>
                                            <StatusIcon className={`w-4 h-4 ${status.text} ${job.status === 'running' ? 'animate-spin' : ''}`} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 text-sm">
                                                <SourceIcon className="w-3.5 h-3.5 text-slate-400" />
                                                <span className="font-medium text-slate-900 dark:text-slate-100 truncate">{job.sourceName}</span>
                                                <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                                                <span className="font-medium text-slate-900 dark:text-slate-100 truncate">{job.targetFullName || `${job.targetOwner || 'personal'}/${job.targetRepo}`}</span>
                                            </div>
                                            <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                <span className={`capitalize font-medium ${status.text}`}>{job.status}</span>
                                                <span>{job.startedAt ? new Date(job.startedAt).toLocaleString() : ''}</span>
                                                {job.completedAt && job.startedAt && (
                                                    <span>{Math.round((new Date(job.completedAt) - new Date(job.startedAt)) / 1000)}s</span>
                                                )}
                                                {meta?.branchCount && <span>{meta.branchCount} branch(es)</span>}
                                            </div>
                                            {job.status === 'running' && job.progressPct > 0 && (
                                                <div className="mt-2 w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5">
                                                    <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${job.progressPct}%` }} />
                                                </div>
                                            )}
                                            {job.errorMessage && (
                                                <p className="text-xs text-red-500 dark:text-red-400 mt-1 truncate">{job.errorMessage}</p>
                                            )}
                                        </div>
                                        {meta?.repoUrl && job.status === 'complete' && (
                                            <a href={meta.repoUrl} target="_blank" rel="noopener noreferrer"
                                                className="text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 shrink-0">
                                                <ExternalLink className="w-4 h-4" />
                                            </a>
                                        )}
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>
            </Card>
        </div>
    )
}
