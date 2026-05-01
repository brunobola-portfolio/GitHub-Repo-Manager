import { useState, useEffect } from 'react'
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'
import { EmptyState } from './ui/EmptyState'
import {
    History, CheckCircle2, XCircle, Loader2, ExternalLink,
    Clock, ArrowRight, RefreshCw, Cloud, Globe, GitBranch,
    ChevronDown, ChevronRight, RotateCcw, FileText, ListChecks
} from 'lucide-react'
import { SectionSpinner } from './ui/Spinner'
import { migrationApi } from '../api/migration'

const MIGRATION_TABS = [
    { id: 'plans', label: 'Plans', icon: ListChecks },
    { id: 'legacy', label: 'Legacy Jobs', icon: History },
]

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
    const [jobs, setJobs] = useState([])
    const [plans, setPlans] = useState([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('all')
    const [activeTab, setActiveTab] = useState('plans') // 'plans' | 'legacy'
    const [expandedPlan, setExpandedPlan] = useState(null)
    const [loadingPlanIds, setLoadingPlanIds] = useState(() => new Set())

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

    const togglePlanExpanded = async (plan) => {
        const willExpand = expandedPlan !== plan.id
        setExpandedPlan(willExpand ? plan.id : null)
        if (!willExpand) return
        const tasksLoaded = Array.isArray(plan.tasks)
        const expectsTasks = (plan.taskCount || 0) > 0
        if (tasksLoaded || !expectsTasks) return
        setLoadingPlanIds(prev => {
            const next = new Set(prev)
            next.add(plan.id)
            return next
        })
        try {
            const full = await migrationApi.getPlan(plan.id)
            setPlans(prev => prev.map(p => p.id === plan.id ? { ...p, ...full } : p))
        } catch {
            setPlans(prev => prev.map(p => p.id === plan.id ? { ...p, tasks: [] } : p))
        } finally {
            setLoadingPlanIds(prev => {
                const next = new Set(prev)
                next.delete(plan.id)
                return next
            })
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
        if (!isOpen) return
        // eslint-disable-next-line react-hooks/set-state-in-effect -- modal-open data load; setLoading is guarded by isOpen
        if (activeTab === 'plans') loadPlans()
        else loadJobs()
    }, [isOpen, activeTab])

    const filteredJobs = filter === 'all' ? jobs : jobs.filter(j => j.status === filter)

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Migration History"
            icon={History}
            iconGradient="primary"
            size="lg"
            tabs={MIGRATION_TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            tabsLayoutId="migration-tabs"
        >
            <div className="flex items-center justify-end mb-3">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={activeTab === 'plans' ? loadPlans : loadJobs}
                    disabled={loading}
                    aria-label="Refresh migration history"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    <span className="ml-1.5">Refresh</span>
                </Button>
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
                <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar" role="tabpanel" id={`tabpanel-migration-tabs-${activeTab}`} aria-labelledby={`tab-migration-tabs-${activeTab}`}>
                    {loading ? (
                        <SectionSpinner padding="py-12" />
                    ) : activeTab === 'plans' ? (
                        /* Plans view */
                        plans.length === 0 ? (
                            <EmptyState
                                icon={ListChecks}
                                title="No migration plans yet"
                                description="Plans show up here once you start a migration from the wizard."
                                gradient="from-slate-400 to-slate-500"
                            />
                        ) : (
                            plans.map(plan => {
                                const status = STATUS_STYLES[plan.status] || STATUS_STYLES.pending
                                const StatusIcon = status.icon
                                const isExpanded = expandedPlan === plan.id
                                const tasks = plan.tasks || []
                                const taskCount = Array.isArray(plan.tasks) ? plan.tasks.length : (plan.taskCount || 0)
                                const isLoadingTasks = loadingPlanIds.has(plan.id)
                                const isExpandable = taskCount > 0
                                const sourceInfo = plan.source || {}
                                const hasSource = !!(sourceInfo.org && sourceInfo.project)
                                const sourceLabel = hasSource
                                    ? `${sourceInfo.org}/${sourceInfo.project}`
                                    : `Migration #${plan.id}`

                                return (
                                    <div key={plan.id} className="rounded-xl border border-slate-200/60 dark:border-slate-700/50 bg-white/50 dark:bg-slate-800/50 transition-colors">
                                        <div
                                            {...(isExpandable ? {
                                                role: 'button',
                                                tabIndex: 0,
                                                'aria-expanded': isExpanded,
                                                onClick: () => togglePlanExpanded(plan),
                                                onKeyDown: (e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault()
                                                        togglePlanExpanded(plan)
                                                    }
                                                },
                                            } : {})}
                                            className={`w-full p-3 flex items-start gap-3 text-left rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${isExpandable ? 'hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer' : ''}`}
                                        >
                                            <div className={`p-1.5 rounded-lg ${status.bg}`}>
                                                <StatusIcon className={`w-4 h-4 ${status.text} ${plan.status === 'running' || plan.status === 'executing' ? 'animate-spin' : ''}`} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 text-sm">
                                                    <Cloud className="w-3.5 h-3.5 text-slate-400" />
                                                    <span className={`font-medium truncate ${hasSource ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 italic'}`}>
                                                        {sourceLabel}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                    <span className={`capitalize font-medium ${status.text}`}>{plan.status}</span>
                                                    {taskCount > 0 && <span>{taskCount} task{taskCount !== 1 ? 's' : ''}</span>}
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
                                                {isExpandable && (
                                                    isLoadingTasks
                                                        ? <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                                                        : isExpanded
                                                            ? <ChevronDown className="w-4 h-4 text-slate-400" />
                                                            : <ChevronRight className="w-4 h-4 text-slate-400" />
                                                )}
                                            </div>
                                        </div>
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
                            <EmptyState
                                icon={History}
                                title="No legacy jobs"
                                description="Pre-plan migrations from older sessions would show up here."
                                gradient="from-slate-400 to-slate-500"
                            />
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
        </Modal>
    )
}
