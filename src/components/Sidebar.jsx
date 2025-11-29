import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { ArrowRightLeft, Lock, Unlock, History, Zap, CheckCircle, XCircle, Loader2, Archive, Trash2, Cloud, Sparkles, MoreHorizontal } from 'lucide-react'

const ACTION_LABELS = {
    visibility: 'Change Visibility',
    transfer: 'Transfer',
    mirror: 'Mirror',
    archive: 'Archive',
    delete: 'Delete',
    create: 'Create',
    'import-azure': 'Azure Import'
}

export function Sidebar({
    selectedCount,
    isPerforming,
    performAction,
    message,
    results,
    onArchive,
    onDelete,
    selectedRepos = [],
    onTransfer,
    orgs = [],
    onAzureImport,
    activity = []
}) {
    const hasSelection = selectedCount > 0

    return (
        <aside className="space-y-6 sticky top-24 min-w-0">
            {/* Quick Actions Panel */}
            <Card className="overflow-hidden border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                    <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-500" />
                        Actions
                    </h3>
                </div>

                <div className="p-4 space-y-4">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">
                        {hasSelection
                            ? `${selectedCount} Selected`
                            : 'Selection Required'
                        }
                    </div>

                    {!hasSelection ? (
                        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-center">
                            <div className="w-8 h-8 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-2">
                                <MoreHorizontal className="w-4 h-4 text-slate-400" />
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Select repositories to perform bulk actions
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {/* Visibility Group */}
                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    disabled={isPerforming}
                                    onClick={() => performAction('visibility', { makePublic: false })}
                                    className="w-full justify-center"
                                    variant="warning"
                                    size="sm"
                                    title="Make private"
                                >
                                    <Lock className="w-3.5 h-3.5 mr-1.5" />
                                    Private
                                </Button>
                                <Button
                                    disabled={isPerforming}
                                    onClick={() => performAction('visibility', { makePublic: true })}
                                    className="w-full justify-center"
                                    variant="success"
                                    size="sm"
                                    title="Make public"
                                >
                                    <Unlock className="w-3.5 h-3.5 mr-1.5" />
                                    Public
                                </Button>
                            </div>

                            {/* Transfer Group */}
                            <Button
                                disabled={isPerforming}
                                onClick={onTransfer}
                                className="w-full justify-start"
                                variant="info"
                                size="sm"
                            >
                                <ArrowRightLeft className="w-3.5 h-3.5 mr-2" />
                                Transfer / Mirror
                            </Button>

                            {/* Destructive Group */}
                            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-2">
                                <Button
                                    disabled={isPerforming}
                                    onClick={() => onArchive?.(selectedRepos, true)}
                                    className="w-full justify-center"
                                    variant="secondary"
                                    size="sm"
                                >
                                    <Archive className="w-3.5 h-3.5 mr-1.5" />
                                    Archive
                                </Button>
                                <Button
                                    disabled={isPerforming}
                                    onClick={() => onDelete?.(selectedRepos)}
                                    className="w-full justify-center"
                                    variant="danger"
                                    size="sm"
                                >
                                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                                    Delete
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </Card>

            {/* Import / Tools */}
            <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
                <div className="p-5">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                            <Cloud className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h3 className="font-bold text-sm">DevOps Migration</h3>
                            <p className="text-xs text-indigo-100">Import from Azure</p>
                        </div>
                    </div>
                    <Button
                        onClick={onAzureImport}
                        disabled={isPerforming}
                        className="w-full justify-center bg-white/10 hover:bg-white/20 text-white border-white/20 hover:border-white/30 transition-all"
                        size="sm"
                    >
                        Start Import
                        <Sparkles className="w-3.5 h-3.5 ml-2 text-amber-300" />
                    </Button>
                </div>
            </Card>

            {/* Activity Log */}
            <Card className="overflow-hidden border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm flex flex-col max-h-[300px]">
                <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 flex items-center justify-between sticky top-0">
                    <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <History className="w-4 h-4 text-slate-400" />
                        Action History
                    </h3>
                    {isPerforming && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />}
                </div>

                <div className="flex-1 overflow-y-auto p-0 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700">
                    {results.length === 0 ? (
                        <div className="text-xs text-slate-400 text-center py-8">
                            No recent actions
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                            {results.map((r, i) => (
                                <div key={i} className="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <div className="flex items-start gap-2.5">
                                        <div className={`mt-0.5 ${r.success ? 'text-emerald-500' : 'text-red-500'}`}>
                                            {r.success ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                                                {ACTION_LABELS[r.action] || r.action}
                                                {r.count && <span className="text-slate-400 ml-1 font-normal">({r.count})</span>}
                                            </div>
                                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
                                                {r.message}
                                            </div>
                                            <div className="text-[10px] text-slate-400 mt-1">
                                                {new Date(r.at).toLocaleTimeString()}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Status Bar */}
                <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {message || 'Ready'}
                </div>
            </Card>

            {/* Recent Events Feed */}
            <Card className="overflow-hidden border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm flex flex-col max-h-[400px]">
                <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 flex items-center justify-between sticky top-0">
                    <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <History className="w-4 h-4 text-blue-400" />
                        Recent Activity
                    </h3>
                </div>

                <div className="flex-1 overflow-y-auto p-0 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700">
                    {(() => {
                        console.log('Sidebar rendering activity:', activity);
                        if (!Array.isArray(activity) || activity.length === 0) {
                            return (
                                <div className="text-xs text-slate-400 text-center py-8">
                                    No recent activity found
                                </div>
                            )
                        }
                        return (
                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                {activity.map((event) => {
                                    if (!event) return null
                                    return (
                                        <div key={event.id} className="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                                            <div className="flex items-start gap-3">
                                                <div className="mt-1">
                                                    {event.type === 'PushEvent' && <div className="w-2 h-2 rounded-full bg-emerald-400 ring-4 ring-emerald-400/20" />}
                                                    {event.type === 'PullRequestEvent' && <div className="w-2 h-2 rounded-full bg-purple-400 ring-4 ring-purple-400/20" />}
                                                    {event.type === 'IssuesEvent' && <div className="w-2 h-2 rounded-full bg-amber-400 ring-4 ring-amber-400/20" />}
                                                    {event.type === 'CreateEvent' && <div className="w-2 h-2 rounded-full bg-blue-400 ring-4 ring-blue-400/20" />}
                                                    {!['PushEvent', 'PullRequestEvent', 'IssuesEvent', 'CreateEvent'].includes(event.type) && (
                                                        <div className="w-2 h-2 rounded-full bg-slate-400 ring-4 ring-slate-400/20" />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
                                                        {event.repo?.name || 'Unknown Repo'}
                                                    </div>
                                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
                                                        {event.type === 'PushEvent' && `Pushed ${event.payload?.size || 0} commit(s)`}
                                                        {event.type === 'PullRequestEvent' && `${event.payload?.action} PR #${event.payload?.number}`}
                                                        {event.type === 'IssuesEvent' && `${event.payload?.action} issue #${event.payload?.issue?.number}`}
                                                        {event.type === 'CreateEvent' && `Created ${event.payload?.ref_type} ${event.payload?.ref || ''}`}
                                                        {!['PushEvent', 'PullRequestEvent', 'IssuesEvent', 'CreateEvent'].includes(event.type) && event.type?.replace('Event', '')}
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
                                                        <span>{event.created_at ? new Date(event.created_at).toLocaleDateString() : ''}</span>
                                                        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-blue-500">View</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )
                    })()}
                </div>
            </Card>
        </aside>
    )
}
