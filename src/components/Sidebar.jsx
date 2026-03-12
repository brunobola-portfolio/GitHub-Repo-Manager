import { Card } from './ui/Card'
import { Button } from './ui/Button'
import {
    ArrowRightLeft, Lock, Unlock, History, Zap, CheckCircle, XCircle,
    Loader2, Archive, Trash2, Cloud, Sparkles, MoreHorizontal,
    GitCommit, GitPullRequest, CircleDot, Play, Copy, ExternalLink,
    Clock, ChevronRight, Download
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useSelection } from '../contexts/SelectionContext'
import { useModal } from '../contexts/ModalContext'

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
    isPerforming,
    performAction,
    message,
    results,
    onArchive,
    onDelete,
    selectedRepos = [],
    onTransfer,
    activity = []
}) {
    const { selectedIds } = useSelection()
    const { openModal } = useModal()

    const selectedCount = selectedIds.size
    const hasSelection = selectedCount > 0

    return (
        <aside className="space-y-6 min-w-0">
            {/* Quick Actions Panel */}
            <QuickActions
                hasSelection={hasSelection}
                selectedCount={selectedCount}
                isPerforming={isPerforming}
                performAction={performAction}
                onTransfer={onTransfer}
                onArchive={onArchive}
                onDelete={onDelete}
                selectedRepos={selectedRepos}
                onAzureImport={() => openModal('showAzureImport')}
                onImport={() => openModal('showImportWizard')}
            />

            {/* Action History */}
            <ActionHistory
                results={results}
                isPerforming={isPerforming}
                message={message}
            />

            {/* Recent Activity */}
            <ActivityFeed activity={activity} />
        </aside>
    )
}

function QuickActions({
    hasSelection, selectedCount, isPerforming, performAction,
    onTransfer, onArchive, onDelete, selectedRepos, onAzureImport, onImport
}) {
    return (
        <Card hover={true} className="overflow-hidden border border-slate-200/40 dark:border-slate-700/40 shadow-lg shadow-slate-200/30 dark:shadow-black/40 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-2xl">
            <div className="px-5 py-4 border-b border-slate-200/50 dark:border-slate-700/40 bg-gradient-to-r from-slate-50/80 to-white/80 dark:from-slate-800/80 dark:to-slate-900/80 flex items-center justify-between">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/20">
                        <Zap className="w-3.5 h-3.5" />
                    </div>
                    Quick Actions
                </h3>
                {hasSelection && (
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-gradient-to-r from-indigo-100 to-purple-100 dark:from-indigo-900/50 dark:to-purple-900/50 text-indigo-600 dark:text-indigo-300 shadow-sm">
                        {selectedCount} SELECTED
                    </span>
                )}
            </div>

            <div className="p-4 space-y-4">
                {!hasSelection ? (
                    <div className="flex flex-col gap-3">
                        <div className="p-6 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-center group transition-colors hover:border-indigo-300 dark:hover:border-indigo-700">
                            <div className="w-10 h-10 bg-white dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm group-hover:scale-110 transition-transform duration-200">
                                <MoreHorizontal className="w-5 h-5 text-slate-400 group-hover:text-indigo-500" />
                            </div>
                            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                No repositories selected
                            </p>
                            <p className="text-[10px] text-slate-400 mt-1">
                                Select items to perform bulk actions
                            </p>
                        </div>

                        {/* Global Tools */}
                        <div className="grid grid-cols-1 gap-2">
                            <motion.button
                                onClick={onImport}
                                disabled={isPerforming}
                                whileHover={{
                                    scale: 1.03,
                                    boxShadow: "0 20px 25px -5px rgba(99, 102, 241, 0.3), 0 10px 10px -5px rgba(99, 102, 241, 0.2)"
                                }}
                                whileTap={{ scale: 0.98 }}
                                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md hover:shadow-lg transition-all duration-200 group cursor-pointer"
                            >
                                <motion.div
                                    className="p-1.5 bg-white/20 rounded-lg backdrop-blur-sm"
                                    whileHover={{ rotate: 360 }}
                                    transition={{ duration: 0.6 }}
                                >
                                    <Download className="w-4 h-4 text-white" />
                                </motion.div>
                                <div className="text-left">
                                    <div className="text-xs font-bold">Import Repository</div>
                                    <div className="text-[10px] text-indigo-100">Git URL, Azure, GitHub</div>
                                </div>
                                <motion.div
                                    initial={{ x: 0 }}
                                    animate={{ x: [0, 5, 0] }}
                                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                                >
                                    <ChevronRight className="w-4 h-4 ml-auto" />
                                </motion.div>
                            </motion.button>
                            <motion.button
                                onClick={onAzureImport}
                                disabled={isPerforming}
                                whileHover={{
                                    scale: 1.03,
                                    boxShadow: "0 20px 25px -5px rgba(59, 130, 246, 0.3), 0 10px 10px -5px rgba(59, 130, 246, 0.2)"
                                }}
                                whileTap={{ scale: 0.98 }}
                                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white shadow-md hover:shadow-lg transition-all duration-200 group cursor-pointer"
                            >
                                <motion.div
                                    className="p-1.5 bg-white/20 rounded-lg backdrop-blur-sm"
                                    whileHover={{ rotate: 360 }}
                                    transition={{ duration: 0.6 }}
                                >
                                    <Cloud className="w-4 h-4 text-white" />
                                </motion.div>
                                <div className="text-left">
                                    <div className="text-xs font-bold">Azure DevOps</div>
                                    <div className="text-[10px] text-blue-100">Quick import wizard</div>
                                </div>
                                <motion.div
                                    initial={{ x: 0 }}
                                    animate={{ x: [0, 5, 0] }}
                                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                                >
                                    <ChevronRight className="w-4 h-4 ml-auto" />
                                </motion.div>
                            </motion.button>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        {/* Visibility */}
                        <ActionButton
                            icon={Lock}
                            label="Private"
                            onClick={() => performAction('visibility', { makePublic: false })}
                            disabled={isPerforming}
                            variant="warning"
                            className="col-span-1"
                        />
                        <ActionButton
                            icon={Unlock}
                            label="Public"
                            onClick={() => performAction('visibility', { makePublic: true })}
                            disabled={isPerforming}
                            variant="success"
                            className="col-span-1"
                        />

                        {/* Transfer/Mirror */}
                        <ActionButton
                            icon={ArrowRightLeft}
                            label="Transfer"
                            subLabel="or Mirror"
                            onClick={onTransfer}
                            disabled={isPerforming}
                            variant="info"
                            className="col-span-2"
                        />

                        {/* Destructive */}
                        <div className="col-span-2 pt-2 mt-1 border-t border-slate-100 dark:border-slate-800/60 grid grid-cols-2 gap-2">
                            <ActionButton
                                icon={Archive}
                                label="Archive"
                                onClick={() => onArchive?.(selectedRepos, true)}
                                disabled={isPerforming}
                                variant="secondary"
                            />
                            <ActionButton
                                icon={Trash2}
                                label="Delete"
                                onClick={() => onDelete?.(selectedRepos)}
                                disabled={isPerforming}
                                variant="danger"
                            />
                        </div>
                    </div>
                )}
            </div>
        </Card>
    )
}

function ActionButton({ icon: IconComp, label, subLabel, onClick, disabled, variant = 'secondary', className = '' }) {
    const variants = {
        secondary: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700',
        primary: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40',
        success: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40',
        warning: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40',
        danger: 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40',
        info: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40',
    }

    return (
        <motion.button
            onClick={onClick}
            disabled={disabled}
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className={`
                flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold
                transition-all duration-200 relative overflow-hidden
                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                ${variants[variant]}
                ${className}
            `}
        >
            {/* Background animado no hover */}
            <motion.div
                className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0"
                initial={{ x: '-100%' }}
                whileHover={{ x: '100%' }}
                transition={{ duration: 0.6 }}
            />
            <IconComp className="w-3.5 h-3.5 relative z-10" />
            <div className="flex flex-col items-start leading-none relative z-10">
                <span>{label}</span>
                {subLabel && <span className="text-[9px] opacity-70 font-normal mt-0.5">{subLabel}</span>}
            </div>
        </motion.button>
    )
}

function ActionHistory({ results, isPerforming, message }) {
    return (
        <Card hover={true} className="overflow-hidden border border-slate-200/40 dark:border-slate-700/40 shadow-lg shadow-slate-200/30 dark:shadow-black/40 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-2xl flex flex-col max-h-[300px]">
            <div className="px-5 py-3.5 border-b border-slate-200/50 dark:border-slate-700/40 bg-gradient-to-r from-slate-50/80 to-white/80 dark:from-slate-800/80 dark:to-slate-900/80 flex items-center justify-between sticky top-0">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-slate-400 to-slate-500 dark:from-slate-500 dark:to-slate-600 text-white shadow-md shadow-slate-400/20">
                        <History className="w-3.5 h-3.5" />
                    </div>
                    Action History
                </h3>
                {isPerforming && (
                    <div className="flex items-center gap-2 text-xs text-indigo-500 font-medium animate-pulse">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Processing...
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-0 custom-scrollbar">
                {results.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                        <History className="w-8 h-8 mb-2 opacity-20" />
                        <span className="text-xs">No recent actions</span>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                        {results.map((r, i) => (
                            <div key={i} className="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                                <div className="flex items-start gap-3">
                                    <div className={`mt-0.5 p-1 rounded-full ${r.success ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}`}>
                                        {r.success ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                                                {ACTION_LABELS[r.action] || r.action}
                                            </div>
                                            <span className="text-[10px] text-slate-400">
                                                {new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
                                            {r.message}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Status Bar */}
            <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800/60 text-[11px] text-slate-500 dark:text-slate-400 truncate flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${isPerforming ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                {message || 'Ready'}
            </div>
        </Card>
    )
}

function ActivityFeed({ activity }) {
    return (
        <Card hover={true} className="overflow-hidden border border-slate-200/40 dark:border-slate-700/40 shadow-lg shadow-slate-200/30 dark:shadow-black/40 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl rounded-2xl flex flex-col max-h-[400px]">
            <div className="px-5 py-3.5 border-b border-slate-200/50 dark:border-slate-700/40 bg-gradient-to-r from-slate-50/80 to-white/80 dark:from-slate-800/80 dark:to-slate-900/80 flex items-center justify-between sticky top-0">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-md shadow-blue-500/20">
                        <Clock className="w-3.5 h-3.5" />
                    </div>
                    Recent Activity
                </h3>
            </div>

            <div className="flex-1 overflow-y-auto p-0 custom-scrollbar">
                {(!Array.isArray(activity) || activity.length === 0) ? (
                    <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                        <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                            <Clock className="w-5 h-5 opacity-40" />
                        </div>
                        <span className="text-xs">No recent activity found</span>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                        {activity.map((event) => {
                            if (!event) return null
                            const EventIcon = getEventIcon(event.type)
                            const timeAgo = getTimeAgo(new Date(event.created_at))

                            return (
                                <div key={event.id} className="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                                    <div className="flex items-start gap-3">
                                        <div className="mt-1">
                                            {EventIcon}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate hover:text-indigo-500 cursor-pointer">
                                                    {event.repo?.name || 'Unknown Repo'}
                                                </div>
                                                <span className="text-[10px] text-slate-400 whitespace-nowrap">{timeAgo}</span>
                                            </div>
                                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight line-clamp-2">
                                                {getEventDescription(event)}
                                            </div>
                                            <div className="mt-1.5 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                                                    aria-label="View activity details"
                                                    onClick={() => {
                                                        const repoName = event.repo?.name
                                                        if (repoName) window.open(`https://github.com/${repoName}`, '_blank', 'noopener')
                                                    }}
                                                >
                                                    View Details <ExternalLink className="w-2.5 h-2.5" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </Card>
    )
}

// Helper functions for Activity Feed
function getEventIcon(type) {
    switch (type) {
        case 'PushEvent':
            return <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"><GitCommit className="w-3.5 h-3.5" /></div>
        case 'PullRequestEvent':
            return <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"><GitPullRequest className="w-3.5 h-3.5" /></div>
        case 'IssuesEvent':
            return <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"><CircleDot className="w-3.5 h-3.5" /></div>
        case 'CreateEvent':
            return <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"><Play className="w-3.5 h-3.5" /></div>
        default:
            return <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"><Clock className="w-3.5 h-3.5" /></div>
    }
}

function getEventDescription(event) {
    const p = event.payload || {}
    switch (event.type) {
        case 'PushEvent':
            return `Pushed ${p.size || 0} commit(s)${p.ref ? ` to ${p.ref.replace('refs/heads/', '')}` : ''}`
        case 'PullRequestEvent':
            return `${p.action || 'Updated'} PR${p.number != null ? ` #${p.number}` : ''}${p.pull_request?.title ? `: ${p.pull_request.title}` : ''}`
        case 'IssuesEvent':
            return `${p.action || 'Updated'} issue${p.issue?.number != null ? ` #${p.issue.number}` : ''}${p.issue?.title ? `: ${p.issue.title}` : ''}`
        case 'CreateEvent':
            return `Created ${p.ref_type || 'resource'}${p.ref ? ` ${p.ref}` : ''}`
        case 'WatchEvent':
            return 'Starred repository'
        case 'ForkEvent':
            return 'Forked repository'
        default:
            return event.type?.replace('Event', '') || 'Activity'
    }
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000)
    let interval = seconds / 31536000
    if (interval > 1) return Math.floor(interval) + "y ago"
    interval = seconds / 2592000
    if (interval > 1) return Math.floor(interval) + "mo ago"
    interval = seconds / 86400
    if (interval > 1) return Math.floor(interval) + "d ago"
    interval = seconds / 3600
    if (interval > 1) return Math.floor(interval) + "h ago"
    interval = seconds / 60
    if (interval > 1) return Math.floor(interval) + "m ago"
    return Math.floor(seconds) + "s ago"
}
