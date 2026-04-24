import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { MoreHorizontal, Pin, PinOff, Bell, BellOff, X, ExternalLink, Copy } from 'lucide-react'
import { clsx } from 'clsx'

const SIGNAL_LABELS = {
    review_requested: 'review requested',
    authored_pr: 'authored PR',
    assigned_issue: 'assigned issue',
    owned: 'owned',
    recent_commit: 'recent commit',
    pinned: 'pinned',
    webhook: 'webhook',
}

function relativeTime(iso) {
    if (!iso) return ''
    const ms = Date.now() - new Date(iso).getTime()
    const days = Math.floor(ms / 86400000)
    if (days < 1) return 'today'
    if (days === 1) return '1d ago'
    if (days < 30) return `${days}d ago`
    const months = Math.floor(days / 30)
    return `${months}mo ago`
}

export function RepoRow({ repo, onAction, selected = false, onSelectionChange }) {
    const [menuOpen, setMenuOpen] = useState(false)

    const handleMenuAction = (action) => {
        setMenuOpen(false)
        onAction(repo.repo_full_name, action)
    }

    return (
        <div
            className={clsx(
                'group flex items-center gap-3 px-3 py-2 border-b border-slate-200/40 dark:border-slate-700/40 transition-colors',
                'hover:bg-slate-50 dark:hover:bg-slate-800/40',
                repo.is_muted ? 'opacity-60' : '',
                selected ? 'bg-indigo-50 dark:bg-indigo-900/20' : '',
            )}
        >
            {onSelectionChange && (
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={(e) => onSelectionChange(repo.repo_full_name, e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 accent-indigo-500"
                    aria-label={`Select ${repo.repo_full_name}`}
                />
            )}

            {repo.is_pinned ? (
                <span
                    aria-label="pinned"
                    className="w-2 h-2 rounded-full bg-indigo-500 shrink-0"
                    title="Pinned"
                />
            ) : repo.is_muted ? (
                <span
                    aria-label="muted"
                    className="w-2 h-2 rounded-full border border-slate-400 shrink-0"
                    title="Muted"
                />
            ) : (
                <span className="w-2 h-2 shrink-0" />
            )}

            <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-slate-900 dark:text-white truncate">
                    {repo.repo_full_name}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    <span className="capitalize">{SIGNAL_LABELS[repo.source_signal] ?? repo.source_signal}</span>
                    <span>·</span>
                    <span>{relativeTime(repo.last_activity_at)}</span>
                </div>
            </div>

            <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        aria-label="More actions"
                        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 focus-within:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                    >
                        <MoreHorizontal className="w-4 h-4 text-slate-500" />
                    </button>
                </Popover.Trigger>
                <Popover.Content
                    side="bottom"
                    align="end"
                    sideOffset={4}
                    className="z-50 min-w-[180px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1 shadow-xl"
                >
                    <MenuItem
                        icon={<Copy className="w-3.5 h-3.5" />}
                        label="Copy name"
                        onClick={() => { navigator.clipboard?.writeText(repo.repo_full_name); setMenuOpen(false) }}
                    />
                    <MenuItem
                        icon={<ExternalLink className="w-3.5 h-3.5" />}
                        label="Open in GitHub"
                        onClick={() => { window.open(`https://github.com/${repo.repo_full_name}`, '_blank', 'noopener'); setMenuOpen(false) }}
                    />
                    <div className="h-px bg-slate-200 dark:bg-slate-700 my-1" />
                    {repo.is_pinned ? (
                        <MenuItem icon={<PinOff className="w-3.5 h-3.5" />} label="Unpin" onClick={() => handleMenuAction('unpin')} />
                    ) : (
                        <MenuItem icon={<Pin className="w-3.5 h-3.5" />} label="Pin" onClick={() => handleMenuAction('pin')} />
                    )}
                    {repo.is_muted ? (
                        <MenuItem icon={<Bell className="w-3.5 h-3.5" />} label="Unmute" onClick={() => handleMenuAction('unmute')} />
                    ) : (
                        <MenuItem icon={<BellOff className="w-3.5 h-3.5" />} label="Mute" onClick={() => handleMenuAction('mute')} />
                    )}
                    <div className="h-px bg-slate-200 dark:bg-slate-700 my-1" />
                    <MenuItem
                        icon={<X className="w-3.5 h-3.5 text-rose-500" />}
                        label="Stop tracking"
                        onClick={() => handleMenuAction('untrack')}
                        destructive
                    />
                </Popover.Content>
            </Popover.Root>
        </div>
    )
}

function MenuItem({ icon, label, onClick, destructive = false }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={clsx(
                'flex w-full items-center gap-2 px-2.5 py-1.5 text-sm rounded-lg transition-colors',
                destructive
                    ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            )}
        >
            {icon}
            {label}
        </button>
    )
}
