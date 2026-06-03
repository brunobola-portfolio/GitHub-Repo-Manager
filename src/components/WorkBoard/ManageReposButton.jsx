import { useMemo, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Settings2, Search, Pin, PinOff, Bell, BellOff } from 'lucide-react'
import { clsx } from 'clsx'
import { useTrackedRepos } from '../../hooks/useTrackedRepos'
import { useToast } from '../../hooks/useToast'
import { Input } from '../ui/form'

const TOP_N = 10

export function ManageReposButton({ onOpenSettings }) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const hook = useTrackedRepos()
    const { toast } = useToast()

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        const list = q
            ? hook.repos.filter(r => r.repo_full_name.toLowerCase().includes(q))
            : hook.repos.slice()
        list.sort((a, b) => (b.last_activity_at ?? '').localeCompare(a.last_activity_at ?? ''))
        return list.slice(0, TOP_N)
    }, [hook.repos, query])

    const runAction = async (fn, successMessage, repoFullName) => {
        try {
            const result = await fn(repoFullName)
            if (result?.operation_id) {
                toast.success(successMessage, {
                    action: 'Undo',
                    onAction: async () => {
                        await hook.undo(result.operation_id)
                        toast.success('Reverted')
                    },
                })
            } else {
                toast.success(successMessage)
            }
        } catch (e) {
            toast.errorFromException(e, { fallbackTitle: 'Failed' })
        }
    }

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    aria-label="Manage repos"
                    className="flex items-center gap-1.5 p-2 rounded-xl border border-slate-200/60 dark:border-slate-700/50 bg-white/70 dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                    <Settings2 className="w-4 h-4" />
                    <span className="hidden sm:inline text-xs font-medium">Manage</span>
                </button>
            </Popover.Trigger>
            <Popover.Content
                side="bottom"
                align="end"
                sideOffset={6}
                className="z-[var(--ds-z-popover)] w-80 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden"
            >
                <div className="p-2 border-b border-slate-200/60 dark:border-slate-700/60">
                    <Input
                        size="sm"
                        leadingIcon={Search}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search tracked…"
                        aria-label="Search tracked repos"
                    />
                </div>

                <div className="max-h-64 overflow-auto p-1">
                    {filtered.length === 0 ? (
                        <div className="px-3 py-4 text-xs text-slate-500 text-center">
                            {query ? 'No matches.' : 'No tracked repos yet.'}
                        </div>
                    ) : (
                        filtered.map(r => (
                            <ManageRepoRow
                                key={r.repo_full_name}
                                repo={r}
                                onPin={() => runAction(hook.pin, `Pinned ${r.repo_full_name}`, r.repo_full_name)}
                                onUnpin={() => runAction(hook.unpin, `Unpinned ${r.repo_full_name}`, r.repo_full_name)}
                                onMute={() => runAction(hook.mute, `Muted ${r.repo_full_name}`, r.repo_full_name)}
                                onUnmute={() => runAction(hook.unmute, `Unmuted ${r.repo_full_name}`, r.repo_full_name)}
                            />
                        ))
                    )}
                </div>

                <div className="p-2 border-t border-slate-200/60 dark:border-slate-700/60">
                    <button
                        type="button"
                        onClick={() => { setOpen(false); onOpenSettings?.() }}
                        className="w-full text-xs font-medium text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline px-2 py-1"
                    >
                        See all in Settings →
                    </button>
                </div>
            </Popover.Content>
        </Popover.Root>
    )
}

function ManageRepoRow({ repo, onPin, onUnpin, onMute, onUnmute }) {
    return (
        <div
            data-testid="manage-repo-row"
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60"
        >
            {repo.is_pinned
                ? <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                : repo.is_muted
                    ? <span className="w-1.5 h-1.5 rounded-full border border-slate-400 shrink-0" />
                    : <span className="w-1.5 h-1.5 shrink-0" />}
            <span className="flex-1 text-xs font-medium text-slate-700 dark:text-slate-300 truncate">{repo.repo_full_name}</span>
            <IconButton
                active={repo.is_pinned}
                label={repo.is_pinned ? `Unpin ${repo.repo_full_name}` : `Pin ${repo.repo_full_name}`}
                onClick={repo.is_pinned ? onUnpin : onPin}
                Icon={repo.is_pinned ? PinOff : Pin}
            />
            <IconButton
                active={repo.is_muted}
                label={repo.is_muted ? `Unmute ${repo.repo_full_name}` : `Mute ${repo.repo_full_name}`}
                onClick={repo.is_muted ? onUnmute : onMute}
                Icon={repo.is_muted ? Bell : BellOff}
            />
        </div>
    )
}

function IconButton({ active, label, onClick, Icon }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className={clsx(
                'p-1 rounded-md transition-colors',
                active
                    ? 'text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] bg-indigo-50 dark:bg-indigo-900/30'
                    : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50'
            )}
        >
            <Icon className="w-3.5 h-3.5" />
        </button>
    )
}
