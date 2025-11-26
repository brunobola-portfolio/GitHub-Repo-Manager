import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { ArrowRightLeft, Lock, Unlock, Copy, History, Zap, CheckCircle, XCircle, Loader2, AlertTriangle, Archive, Trash2 } from 'lucide-react'

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
    org,
    onArchive,
    onDelete,
    selectedRepos = [],
    onTransfer,
    orgs = []
}) {
    const hasSelection = selectedCount > 0
    const hasOrgs = orgs.length > 0

    return (
        <aside className="space-y-6 sticky top-24">
            <Card className="p-4 space-y-4">
                <div>
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                        Quick Actions
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        {hasSelection
                            ? `${selectedCount} repo${selectedCount > 1 ? 's' : ''} selected`
                            : 'Select repositories to perform actions'
                        }
                    </p>
                </div>

                <div className="space-y-2">
                    {/* Visibility */}
                    <div className="grid grid-cols-2 gap-2">
                        <Button
                            disabled={isPerforming || !hasSelection}
                            onClick={() => performAction('visibility', { makePublic: false })}
                            className="w-full justify-center"
                            variant="warning"
                            size="sm"
                            title="Make selected repositories private"
                        >
                            <Lock className="w-4 h-4 mr-1" />
                            Private
                        </Button>
                        <Button
                            disabled={isPerforming || !hasSelection}
                            onClick={() => performAction('visibility', { makePublic: true })}
                            className="w-full justify-center"
                            variant="success"
                            size="sm"
                            title="Make selected repositories public"
                        >
                            <Unlock className="w-4 h-4 mr-1" />
                            Public
                        </Button>
                    </div>

                    {/* Transfer & Mirror - Opens Modal */}
                    <Button
                        disabled={isPerforming || !hasSelection}
                        onClick={onTransfer}
                        className="w-full justify-start"
                        variant="info"
                        title={!hasOrgs ? 'Create an organization first' : 'Transfer or mirror to organization'}
                    >
                        <ArrowRightLeft className="w-4 h-4 mr-2" />
                        Transfer / Mirror
                        {!hasOrgs && <span className="ml-auto text-xs opacity-75">No orgs</span>}
                    </Button>

                    {/* Archive */}
                    <Button
                        disabled={isPerforming || !hasSelection}
                        onClick={() => onArchive?.(selectedRepos, true)}
                        className="w-full justify-start"
                        variant="secondary"
                        title="Archive selected repositories"
                    >
                        <Archive className="w-4 h-4 mr-2" />
                        Archive
                    </Button>

                    {/* Delete - Danger Zone */}
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                        <Button
                            disabled={isPerforming || !hasSelection}
                            onClick={() => onDelete?.(selectedRepos)}
                            className="w-full justify-start"
                            variant="danger"
                            title="Permanently delete selected repositories"
                        >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete Forever
                        </Button>
                    </div>
                </div>

                {!hasSelection && (
                    <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-lg text-xs">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        Select repositories from the list to enable actions
                    </div>
                )}
            </Card>

            <Card className="p-4">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-3">
                    <History className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                    Activity
                </h3>
                <div className="space-y-3">
                    {/* Current Status */}
                    <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
                        isPerforming
                            ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-800'
                            : message
                                ? 'bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-600'
                                : 'bg-slate-50 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                    }`}>
                        {isPerforming && <Loader2 className="w-4 h-4 animate-spin" />}
                        {message || 'Ready for action'}
                    </div>

                    {/* History */}
                    <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                        {results.length === 0 && (
                            <div className="text-xs text-slate-400 dark:text-slate-500 text-center py-4">
                                No activity yet
                            </div>
                        )}
                        {results.map((r, i) => (
                            <div
                                key={i}
                                className={`text-xs p-2 rounded border ${
                                    r.success
                                        ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-100 dark:border-emerald-800'
                                        : 'bg-red-50 dark:bg-red-900/30 border-red-100 dark:border-red-800'
                                }`}
                            >
                                <div className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                                    {r.success
                                        ? <CheckCircle className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
                                        : <XCircle className="w-3 h-3 text-red-500 dark:text-red-400" />
                                    }
                                    {ACTION_LABELS[r.action] || r.action}
                                    {r.count && <span className="text-slate-400 dark:text-slate-500">({r.count})</span>}
                                </div>
                                <div className="text-slate-500 dark:text-slate-400 mt-0.5 pl-4">{r.message}</div>
                                <div className="text-slate-400 dark:text-slate-500 mt-1 pl-4 text-[10px]">
                                    {new Date(r.at).toLocaleTimeString()}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </Card>
        </aside>
    )
}
