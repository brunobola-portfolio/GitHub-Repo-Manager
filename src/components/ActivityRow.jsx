import { RowIconBadge } from './ui/RowIconBadge'
import { formatRelativeTime } from '../utils/format'
import {
    GitCommit, GitPullRequest, CircleDot, Play, ExternalLink, Clock,
} from 'lucide-react'

// Extracted from the old repos-view right rail (Sidebar.jsx), removed
// 2026-09-05 along with the rest of that rail: Quick Actions and Import
// duplicated header buttons/palette commands, and Action History was empty
// for a new user. ActivityRow is the one part of that rail with real
// content, so it moved to its own module and became the dashboard's
// "Recent Activity" section (DashboardPremium.jsx) instead of disappearing
// with the rest of the rail.
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
                        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate hover:text-brand-500 cursor-pointer">
                            {event.repo?.name || 'Unknown Repo'}
                        </div>
                        <span className="ds-text-micro text-slate-500 dark:text-slate-400 whitespace-nowrap">{timeAgo}</span>
                    </div>
                    <div className="ds-text-meta text-slate-500 dark:text-slate-400 mt-0.5 leading-tight line-clamp-2">
                        {getEventDescription(event)}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
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
