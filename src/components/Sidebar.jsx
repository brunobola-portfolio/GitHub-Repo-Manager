import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { ArrowRightLeft, Lock, Unlock, Copy, History, Zap, CheckCircle, XCircle, Loader2, AlertTriangle, Archive, Trash2, Cloud, Sparkles } from 'lucide-react'

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
	    onAzureImport
	}) {
    const hasSelection = selectedCount > 0
    const hasOrgs = orgs.length > 0

    return (
        <aside className="space-y-4 sticky top-24">
            {/* Migrate from DevOps - Featured Action */}
            <Card className="p-5 bg-gradient-to-br from-sky-50 via-indigo-50 to-purple-50 dark:from-sky-900/40 dark:via-indigo-900/40 dark:to-purple-900/40 border-2 border-indigo-200 dark:border-indigo-600/60 shadow-lg shadow-indigo-100/50 dark:shadow-indigo-900/30">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2.5 bg-gradient-to-br from-sky-500 to-indigo-600 rounded-xl shadow-md">
                        <Cloud className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                            Migrate from DevOps
                            <Sparkles className="w-4 h-4 text-amber-500" />
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-300">Import repos from Azure DevOps</p>
                    </div>
                </div>
                <Button
                    onClick={onAzureImport}
                    disabled={isPerforming}
                    className="w-full justify-center bg-gradient-to-r from-sky-500 via-indigo-500 to-purple-500 hover:from-sky-600 hover:via-indigo-600 hover:to-purple-600 text-white font-semibold shadow-md hover:shadow-lg transition-all border-0"
                    size="md"
                    title="Import repositories from Azure DevOps to GitHub"
                >
                    <Cloud className="w-4 h-4 mr-2" />
                    Start Migration
                </Button>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 text-center leading-relaxed">
                    Seamlessly migrate your Azure DevOps repos to GitHub
                </p>
            </Card>

            {/* Quick Actions */}
            <Card className="p-5 space-y-4">
                <div>
                    <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <Zap className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
                        Quick Actions
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300 mt-1.5">
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
                    <div className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50 text-amber-800 dark:text-amber-200 rounded-lg text-sm">
                        <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" />
                        <span>Select repositories from the list to enable actions</span>
                    </div>
                )}
            </Card>

            <Card className="p-5">
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-4">
                    <History className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                    Activity
                </h3>
                <div className="space-y-3">
                    {/* Current Status */}
                    <div className={`p-3.5 rounded-lg text-sm font-medium flex items-center gap-2.5 ${
                        isPerforming
                            ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700'
                            : message
                                ? 'bg-slate-50 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600'
                                : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600'
                    }`}>
                        {isPerforming && <Loader2 className="w-4 h-4 animate-spin" />}
                        {message || 'Ready for action'}
                    </div>

                    {/* History */}
                    <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                        {results.length === 0 && (
                            <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
                                No activity yet
                            </div>
                        )}
                        {results.map((r, i) => (
                            <div
                                key={i}
                                className={`text-sm p-3 rounded-lg border ${
                                    r.success
                                        ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-700'
                                        : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700'
                                }`}
                            >
                                <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
                                    {r.success
                                        ? <CheckCircle className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                                        : <XCircle className="w-4 h-4 text-red-500 dark:text-red-400" />
                                    }
                                    {ACTION_LABELS[r.action] || r.action}
                                    {r.count && <span className="text-slate-500 dark:text-slate-400 font-normal">({r.count})</span>}
                                </div>
                                <div className="text-slate-600 dark:text-slate-400 mt-1 pl-6">{r.message}</div>
                                <div className="text-slate-500 dark:text-slate-500 mt-1.5 pl-6 text-xs">
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
