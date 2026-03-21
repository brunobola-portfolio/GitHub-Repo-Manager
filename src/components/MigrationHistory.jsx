import { useState, useEffect } from 'react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import {
    History, CheckCircle2, XCircle, Loader2, ExternalLink,
    Clock, ArrowRight, RefreshCw, Cloud, Globe, GitBranch,
    ChevronDown, ChevronRight, RotateCcw, FileText, ListChecks
} from 'lucide-react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { migrationApi } from '../api/migration'

const SOURCE_ICONS = {
    azure: Cloud,
    url: Globe,
    github: GitBranch
}

const STATUS_STYLES = {
    complete: { bg: 'bg-green-100 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-400', icon: CheckCircle2 },
    completed: { bg: 'bg-green-100 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-400', icon: CheckCircle2 },
    failed: { bg: 'bg-red-100 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-400', icon: XCircle },
    running: { bg: 'bg-blue-100 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-400', icon: Loader2 },
    executing: { bg: 'bg-blue-100 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-400', icon: Loader2 },
    pending: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400', icon: Clock },
    draft: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400', icon: Clock },
    paused: { bg: 'bg-amber-100 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-400', icon: Clock }
}

export function MigrationHistory({ isOpen, onClose }) {
    const modalRef = useFocusTrap(isOpen, onClose)
    const [jobs, setJobs] = useState([])
    const [plans, setPlans] = useState([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('all')
    const [activeTab, setActiveTab] = useState('plans') // 'plans' | 'legacy'
    const [expandedPlan, setExpandedPlan] = useState(null)

    const loadJobs = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/migrations?per_page=50', { credentials: 'include' })
            if (res.status === 401) {
                setJobs([])
                return
            }
            const data = await res.json()
            setJobs(data.migrations || [])
        } catch { /* ignore */ } finally {
            setLoading(false)
        }
    }

    const loadPlans = async () => {
        setLoading(true)
        try {
            const data = await migrationApi.listPlans()
            setPlans(data.plans || [])
        } catch {
            setPlans([])
        } finally {
            setLoading(false)
        }
    }

    const handleRerunPlan = async (plan) => {
        try {
            await migrationApi.createPlan({
                source: plan.source,
                repos: plan.repos,
                workItems: plan.workItems,
                wiki: plan.wiki,
                schedule: plan.schedule
            })
            loadPlans()
        } catch { /* ignore */ }
    }

    const handleExportReport = async (plan) => {
        try {
            const report = await migrationApi.getReport(plan.id)
            const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `migration-report-${plan.id}.json`
            a.click()
            URL.revokeObjectURL(url)
        } catch { /* ignore */ }
    }

    useEffect(() => {
        if (isOpen) {
            if (activeTab === 'plans') loadPlans()
            else loadJobs()
        }
    }, [isOpen, activeTab])

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
                        <Button variant="ghost" size="sm" onClick={activeTab === 'plans' ? loadPlans : loadJobs} disabled={loading}>
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 text-2xl leading-none">&times;</button>
                    </div>
                </div>

                {/* Tab Toggle */}
                <div className="flex items-center gap-1 mb-4 rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 overflow-hidden w-fit">
                    <button onClick={() => setActiveTab('plans')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5
                            ${activeTab === 'plans'
                                ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}>
                        <ListChecks className="w-3.5 h-3.5" />
                        Plans
                    </button>
                    <button onClick={() => setActiveTab('legacy')}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5
                            ${activeTab === 'legacy'
                                ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}>
                        <History className="w-3.5 h-3.5" />
                        Legacy Jobs
                    </button>
                </div>

                {activeTab === 'legacy' && (
                    /* Filter for legacy jobs */
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
                )}

                {/* Content area */}
                <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
                    {loading ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" /></div>
                    ) : activeTab === 'plans' ? (
                        /* Plans view */
                        plans.length === 0 ? (
                            <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                                <ListChecks className="w-10 h-10 mx-auto mb-3 opacity-30" />
                                <p className="text-sm">No migration plans found</p>
                            </div>
                        ) : (
                            plans.map(plan => {
                                const status = STATUS_STYLES[plan.status] || STATUS_STYLES.pending
                                const StatusIcon = status.icon
                                const isExpanded = expandedPlan === plan.id
                                const tasks = plan.tasks || []
                                const taskCount = tasks.length || plan.taskCount || 0
                                const sourceInfo = plan.source || {}

                                return (
                                    <div key={plan.id} className="rounded-xl border border-slate-200/60 dark:border-slate-700/50 bg-white/50 dark:bg-slate-800/50 transition-colors">
                                        <button
                                            onClick={() => setExpandedPlan(isExpanded ? null : plan.id)}
                                            className="w-full p-3 flex items-start gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition-colors"
                                        >
                                            <div className={`p-1.5 rounded-lg ${status.bg}`}>
                                                <StatusIcon className={`w-4 h-4 ${status.text} ${plan.status === 'running' || plan.status === 'executing' ? 'animate-spin' : ''}`} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 text-sm">
                                                    <Cloud className="w-3.5 h-3.5 text-slate-400" />
                                                    <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                                                        {sourceInfo.org || 'Unknown'}/{sourceInfo.project || 'Unknown'}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                    <span className={`capitalize font-medium ${status.text}`}>{plan.status}</span>
                                                    <span>{taskCount} task{taskCount !== 1 ? 's' : ''}</span>
                                                    <span>{plan.createdAt ? new Date(plan.createdAt).toLocaleString() : ''}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                {plan.status === 'failed' && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleRerunPlan(plan) }}
                                                        className="p-1.5 rounded-lg text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                                                        title="Re-run migration"
                                                    >
                                                        <RotateCcw className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {(plan.status === 'complete' || plan.status === 'completed') && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleExportReport(plan) }}
                                                        className="p-1.5 rounded-lg text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                                                        title="Export report"
                                                    >
                                                        <FileText className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                                            </div>
                                        </button>
                                        {isExpanded && tasks.length > 0 && (
                                            <div className="px-3 pb-3 space-y-1.5 border-t border-slate-100 dark:border-slate-700/50 pt-2 ml-10">
                                                {tasks.map((task, idx) => {
                                                    const taskStatus = STATUS_STYLES[task.status] || STATUS_STYLES.pending
                                                    const TaskIcon = taskStatus.icon
                                                    const duration = task.completedAt && task.startedAt
                                                        ? Math.round((new Date(task.completedAt) - new Date(task.startedAt)) / 1000)
                                                        : null
                                                    return (
                                                        <div key={task.id || idx} className="flex items-center gap-2 text-xs">
                                                            <TaskIcon className={`w-3.5 h-3.5 ${taskStatus.text} ${task.status === 'running' ? 'animate-spin' : ''}`} />
                                                            <span className="font-medium text-slate-700 dark:text-slate-300 truncate flex-1">{task.repoName || task.name || `Task ${idx + 1}`}</span>
                                                            <span className={`capitalize ${taskStatus.text}`}>{task.status}</span>
                                                            {task.progressPct > 0 && task.status === 'running' && (
                                                                <span className="text-slate-400">{task.progressPct}%</span>
                                                            )}
                                                            {duration !== null && <span className="text-slate-400">{duration}s</span>}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )
                            })
                        )
                    ) : (
                        /* Legacy jobs view */
                        filteredJobs.length === 0 ? (
                            <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                                <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
                                <p className="text-sm">No migrations found</p>
                            </div>
                        ) : (
                            filteredJobs.map(job => {
                                const status = STATUS_STYLES[job.status] || STATUS_STYLES.pending
                                const StatusIcon = status.icon
                                const SourceIcon = SOURCE_ICONS[job.sourceType] || Globe
                                const meta = (() => { try { return typeof job.metadata === 'string' ? JSON.parse(job.metadata) : (job.metadata || {}) } catch { return {} } })()

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
                        )
                    )}
                </div>
            </Card>
        </div>
    )
}
