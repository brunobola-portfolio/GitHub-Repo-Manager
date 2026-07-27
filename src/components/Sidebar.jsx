import { memo } from 'react'
import { Card } from './ui/Card'
import { formatRelativeTime } from '../utils/format'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import { RowIconBadge } from './ui/RowIconBadge'
import {
    ArrowRightLeft, Lock, Unlock, History, Zap, CheckCircle, XCircle,
    Archive, Trash2, MoreHorizontal,
    GitCommit, GitPullRequest, CircleDot, Play, ExternalLink,
    Clock, ChevronRight, Download
} from 'lucide-react'
import { useSelection } from '../hooks/useSelection'
import { useModal } from '../hooks/useModal'
import { useRepoActionContext } from '../actions/repoActionContext'
import { runAction } from '../actions/runAction'
import { repoActions } from '../actions/repoActions'

const ACTION_LABELS = {
    visibility: 'Change Visibility',
    transfer: 'Transfer',
    mirror: 'Mirror',
    archive: 'Archive',
    delete: 'Delete',
    create: 'Create',
    'import-azure': 'Azure Import'
}

function SidebarBase({
    isPerforming,
    message,
    results,
    selectedRepos = [],
    activity = []
}) {
    const { selectedIds } = useSelection()
    const { openModal } = useModal()

    const selectedCount = selectedIds.size
    const hasSelection = selectedCount > 0

    return (
        <aside className="flex flex-col gap-6 min-w-0 h-full">
            {/* Quick Actions Panel */}
            <QuickActions
                hasSelection={hasSelection}
                selectedCount={selectedCount}
                isPerforming={isPerforming}
                selectedRepos={selectedRepos}
                onImport={() => openModal('showMigrationWizard')}
            />

            {/* Action History */}
            <ActionHistory
                results={results}
                isPerforming={isPerforming}
                message={message}
            />

            {/* Recent Activity — flex-1 so its bottom aligns pixel-perfect
                with the OrgPanel's footer on the left (both panels share the
                same sticky maxHeight). */}
            <ActivityList activity={activity} />
        </aside>
    )
}

function QuickActions({
    hasSelection, selectedCount, isPerforming, selectedRepos, onImport
}) {
    return (
        <Card hover={true} className="flex-shrink-0 overflow-hidden border border-slate-200 dark:border-slate-700/60 shadow-sm rounded-2xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700/60 flex items-center justify-between">
                <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2.5">
                    <RowIconBadge icon={Zap} tone="amber" />
                    Quick Actions
                </h3>
                {hasSelection && (
                    <span className="ds-text-micro font-medium px-2.5 py-1 rounded-full bg-[color:var(--ds-surface-muted)] dark:bg-[color:var(--ds-surface-muted-dark)] text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]">
                        {selectedCount} SELECTED
                    </span>
                )}
            </div>

            <div className="p-4 space-y-4">
                {!hasSelection ? (
                    <div className="flex flex-col gap-3">
                        <div className="p-6 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-center group transition-colors hover:border-indigo-300 dark:hover:border-indigo-700">
                            <div className="w-10 h-10 bg-white dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
                                <MoreHorizontal className="w-5 h-5 text-slate-400 group-hover:text-indigo-500" />
                            </div>
                            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                No repositories selected
                            </p>
                            <p className="ds-text-micro text-slate-500 dark:text-slate-400 mt-1">
                                Select items to perform bulk actions
                            </p>
                        </div>

                        {/* Global Tools */}
                        <div className="grid grid-cols-1 gap-2">
                            <button
                                type="button"
                                onClick={onImport}
                                disabled={isPerforming}
                                className="flex items-center gap-3 p-3 rounded-xl bg-[color:var(--ds-accent-brand)] text-white shadow-sm hover:opacity-90 transition-colors duration-150 group cursor-pointer"
                            >
                                <div className="p-1.5 bg-white/20 rounded-lg">
                                    <Download className="w-4 h-4 text-white" />
                                </div>
                                <div className="text-left">
                                    <div className="text-xs font-semibold">Import Repository</div>
                                    <div className="ds-text-micro text-white/90">Git URL, Azure, GitHub</div>
                                </div>
                                <ChevronRight className="w-4 h-4 ml-auto" />
                            </button>
                        </div>
                    </div>
                ) : (
                    <QuickActionButtons
                        isPerforming={isPerforming}
                        selectedRepos={selectedRepos}
                    />
                )}
            </div>
        </Card>
    )
}

// Shared bulk-action grid — reused by the expanded QuickActions card and the
// collapsed SlimSidebar "Quick Actions" popover so both render the SAME real
// actions (no invented / duplicated buttons). Exported for SlimSidebar.jsx
// (kept as a separate, lazy-loaded module — see App.jsx).
// Every button dispatches through runAction + the shared registry, so these
// get the same confirmation gates, type-to-confirm and honest result toasts as
// the selection bar and the command palette. They previously called
// performAction/onDelete directly with no repo list: the request was skipped,
// nothing threw, and the caller still reported "completed successfully" —
// while Delete reached the bulk endpoint with no confirmation at all.
export function QuickActionButtons({ isPerforming, selectedRepos = [] }) {
    const ctx = useRepoActionContext()
    const count = selectedRepos.length
    const disabled = isPerforming || count === 0
    const dispatch = (actionId) => runAction(actionId, selectedRepos, ctx, repoActions)

    return (
        <div className="grid grid-cols-2 gap-2">
            {count === 0 && (
                <p className="col-span-2 text-xs text-slate-500 dark:text-slate-400">
                    Select one or more repositories to use these actions.
                </p>
            )}

            {/* Visibility */}
            <ActionButton
                icon={Lock}
                label="Private"
                onClick={() => dispatch('make_private_selected')}
                disabled={disabled}
                variant="warning"
                className="col-span-1"
            />
            <ActionButton
                icon={Unlock}
                label="Public"
                onClick={() => dispatch('make_public_selected')}
                disabled={disabled}
                variant="success"
                className="col-span-1"
            />

            {/* Transfer/Mirror */}
            <ActionButton
                icon={ArrowRightLeft}
                label="Transfer"
                subLabel="or Mirror"
                onClick={() => dispatch('transfer_selected')}
                disabled={disabled}
                variant="info"
                className="col-span-2"
            />

            {/* Destructive */}
            <div className="col-span-2 pt-2 mt-1 border-t border-slate-100 dark:border-slate-800/60 grid grid-cols-2 gap-2">
                <ActionButton
                    icon={Archive}
                    label="Archive"
                    onClick={() => dispatch('archive_selected')}
                    disabled={disabled}
                    variant="secondary"
                />
                <ActionButton
                    icon={Trash2}
                    label="Delete"
                    onClick={() => dispatch('delete_selected')}
                    disabled={disabled}
                    variant="danger"
                />
            </div>
        </div>
    )
}

function ActionButton({ icon: IconComp, label, subLabel, onClick, disabled, variant = 'secondary', className = '' }) {
    const variants = {
        secondary: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700',
        primary: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50',
        success: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40',
        warning: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40',
        danger: 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40',
        info: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40',
    }

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`
                flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold
                transition-colors duration-150 ds-focus-ring
                disabled:opacity-50 disabled:cursor-not-allowed
                ${variants[variant]}
                ${className}
            `}
        >
            <IconComp className="w-3.5 h-3.5" />
            <div className="flex flex-col items-start leading-none">
                <span>{label}</span>
                {subLabel && <span className="text-[9px] opacity-70 font-normal mt-0.5">{subLabel}</span>}
            </div>
        </button>
    )
}

// Shared single history row — reused by the expanded ActionHistory panel and
// the collapsed SlimSidebar "Action History" popover. Exported for
// SlimSidebar.jsx (kept as a separate, lazy-loaded module — see App.jsx).
export function ActionHistoryRow({ result: r }) {
    return (
        <div className="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
            <div className="flex items-start gap-3">
                <div className={`mt-0.5 p-1 rounded-full ${r.success ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}`}>
                    {r.success ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                            {ACTION_LABELS[r.action] || r.action}
                        </div>
                        <span className="ds-text-micro text-slate-500 dark:text-slate-400">
                            {new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                    <div className="ds-text-meta text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
                        {r.message}
                    </div>
                    {!r.success && r.details?.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                            {r.details.map((d, j) => (
                                <div key={j} className="ds-text-micro text-red-500/80 dark:text-red-400/70 leading-tight">
                                    {d.field ? `${d.field}: ` : ''}{d.message}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

function ActionHistory({ results, isPerforming, message }) {
    return (
        <Card hover={true} className="flex-shrink-0 overflow-hidden border border-slate-200 dark:border-slate-700/60 shadow-sm rounded-2xl flex flex-col max-h-[300px]">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-700/60 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900">
                <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                        <History className="w-3.5 h-3.5" />
                    </div>
                    Action History
                </h3>
                {isPerforming && (
                    <div className="flex items-center gap-2 text-xs text-indigo-500 font-medium animate-pulse">
                        <Spinner size="sm" tone="primary" />
                        Processing...
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-0 ds-scrollbar">
                {results.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-500 dark:text-slate-400">
                        <History className="w-8 h-8 mb-2 opacity-20" />
                        <span className="text-xs">No recent actions</span>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                        {results.map((r, i) => (
                            <ActionHistoryRow key={i} result={r} />
                        ))}
                    </div>
                )}
            </div>

            {/* Status Bar */}
            <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800/60 ds-text-meta text-slate-500 dark:text-slate-400 truncate flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${
                    isPerforming ? 'bg-amber-400 animate-pulse'
                    : results[0]?.success === false ? 'bg-red-400'
                    : 'bg-emerald-400'
                }`} />
                {message || 'Ready'}
            </div>
        </Card>
    )
}

function ActivityList({ activity }) {
    // Wrap in a Card to match Quick Actions / Action History above so the
    // sidebar reads as one cohesive premium column instead of three loose
    // panels with the activity feed dangling borderless underneath.
    return (
        <Card hover={true} className="flex-1 min-h-0 flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700/60 shadow-sm rounded-2xl">
            <div className="flex-shrink-0 px-5 py-4 border-b border-slate-200 dark:border-slate-700/60 flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                    <Clock className="w-3.5 h-3.5" />
                </div>
                <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-100">Recent Activity</h3>
            </div>
            <ActivityListBody activity={activity} />
        </Card>
    )
}

function ActivityListBody({ activity }) {
    if (!Array.isArray(activity) || activity.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center py-10 text-slate-400">
                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                    <Clock className="w-5 h-5 opacity-40" />
                </div>
                <span className="text-xs">No recent activity found</span>
            </div>
        )
    }

    return (
        <div className="flex-1 min-h-0 divide-y divide-slate-100 dark:divide-slate-800/60 overflow-y-auto ds-scrollbar">
            {activity.map((event) => (
                event ? <ActivityRow key={event.id} event={event} /> : null
            ))}
        </div>
    )
}

// Shared single activity row — reused by the expanded Recent Activity panel and
// the collapsed SlimSidebar "Recent Activity" popover. Exported for
// SlimSidebar.jsx (kept as a separate, lazy-loaded module — see App.jsx).
export function ActivityRow({ event }) {
    const EventIcon = getEventIcon(event.type)
    const timeAgo = formatRelativeTime(event.created_at)

    return (
        <div className="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
            <div className="flex items-start gap-3">
                <div className="mt-1">
                    {EventIcon}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate hover:text-indigo-500 cursor-pointer">
                            {event.repo?.name || 'Unknown Repo'}
                        </div>
                        <span className="ds-text-micro text-slate-500 dark:text-slate-400 whitespace-nowrap">{timeAgo}</span>
                    </div>
                    <div className="ds-text-meta text-slate-500 dark:text-slate-400 mt-0.5 leading-tight line-clamp-2">
                        {getEventDescription(event)}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                            className="ds-text-micro font-medium text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline flex items-center gap-1"
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
}

// Helper functions for Activity Feed
function getEventIcon(type) {
    switch (type) {
        case 'PushEvent':
            return <RowIconBadge icon={GitCommit} tone="emerald" />
        case 'PullRequestEvent':
            return <RowIconBadge icon={GitPullRequest} tone="purple" />
        case 'IssuesEvent':
            return <RowIconBadge icon={CircleDot} tone="amber" />
        case 'CreateEvent':
            return <RowIconBadge icon={Play} tone="blue" />
        default:
            return <RowIconBadge icon={Clock} tone="slate" />
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

// React.memo so identical sidebarProps (already memoised in App.jsx) skip
// re-render when the parent updates for an unrelated reason. Default shallow
// equality is the right fit: every prop is either a primitive or a stable
// reference from the parent's useMemo/useCallback.
export const Sidebar = memo(SidebarBase)
