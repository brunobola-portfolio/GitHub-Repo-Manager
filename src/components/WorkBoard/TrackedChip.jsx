import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Pin, PinOff, Bell, BellOff, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useTrackedRepos } from '../../hooks/useTrackedRepos'
import { useToast } from '../../hooks/useToast'

export function TrackedChip({ repoFullName }) {
    const [open, setOpen] = useState(false)
    const hook = useTrackedRepos()
    const { toast } = useToast()
    const tracked = hook.repos.find(r => r.repo_full_name === repoFullName)

    const runAction = async (fn, successMessage) => {
        setOpen(false)
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

    if (!tracked) {
        return (
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation()
                    runAction(hook.track, `Added ${repoFullName}`)
                }}
                aria-label={`Track ${repoFullName}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 ds-text-meta font-medium rounded-full border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
                + Track
            </button>
        )
    }

    const isPinned = tracked.is_pinned === 1
    const isMuted = tracked.is_muted === 1
    const chipLabel = isMuted ? 'Muted' : 'Tracked'

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`${chipLabel} ${repoFullName}`}
                    className={clsx(
                        'inline-flex items-center gap-1 px-2 py-0.5 ds-text-meta font-medium rounded-full border transition-colors',
                        isMuted
                            ? 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400'
                            : 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-700/50 text-indigo-700 dark:text-indigo-300'
                    )}
                >
                    <span className={clsx('w-1.5 h-1.5 rounded-full', isMuted ? 'border border-slate-400' : 'bg-indigo-500')} />
                    {chipLabel}
                </button>
            </Popover.Trigger>
            <Popover.Content
                side="bottom"
                align="start"
                sideOffset={6}
                onClick={(e) => e.stopPropagation()}
                className="z-[var(--ds-z-popover)] min-w-[180px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1 shadow-xl"
            >
                {isPinned
                    ? <ChipMenuItem icon={<PinOff className="w-3.5 h-3.5" />} label="Unpin" onClick={() => runAction(hook.unpin, `Unpinned ${repoFullName}`)} />
                    : <ChipMenuItem icon={<Pin className="w-3.5 h-3.5" />} label="Pin" onClick={() => runAction(hook.pin, `Pinned ${repoFullName}`)} />}
                {isMuted
                    ? <ChipMenuItem icon={<Bell className="w-3.5 h-3.5" />} label="Unmute" onClick={() => runAction(hook.unmute, `Unmuted ${repoFullName}`)} />
                    : <ChipMenuItem icon={<BellOff className="w-3.5 h-3.5" />} label="Mute" onClick={() => runAction(hook.mute, `Muted ${repoFullName}`)} />}
                <div className="h-px bg-slate-200 dark:bg-slate-700 my-1" />
                <ChipMenuItem
                    icon={<X className="w-3.5 h-3.5 text-rose-500" />}
                    label="Stop tracking"
                    onClick={() => runAction(hook.untrack, `Stopped tracking ${repoFullName}`)}
                    destructive
                />
            </Popover.Content>
        </Popover.Root>
    )
}

function ChipMenuItem({ icon, label, onClick, destructive = false }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={clsx(
                'flex w-full items-center gap-2 px-2.5 py-1.5 text-sm rounded-lg transition-colors text-left',
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
