import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { MoreHorizontal, Pin, PinOff, Bell, BellOff, X, ExternalLink, Copy, Eye } from 'lucide-react'
import { clsx } from 'clsx'
import { useTrackedRepos } from '../../hooks/useTrackedRepos'
import { useToast } from '../../hooks/useToast'

/**
 * Per-row action menu for the Work Board page. Mirrors the RepoCard
 * "menu do repo" pattern: in-app navigation first, GitHub-direct
 * demoted to a secondary "Open on GitHub" entry, then repo-level state
 * (pin / mute / untrack) below the divider. Per-item actions (snooze,
 * draft comment) stay in the existing ChipStrip components.
 *
 * @param {object} props
 * @param {string} props.repoFullName    — owner/repo
 * @param {string} props.itemUrl         — github.com URL for the row item
 * @param {'pr'|'issue'} [props.itemType] — when present, surfaces a primary
 *        "Open in app" action that navigates to the in-app PR/Issue detail.
 * @param {number} [props.itemNumber]    — required when itemType is set.
 */
export function WorkBoardRowMenu({ repoFullName, itemUrl, itemType, itemNumber }) {
    const [open, setOpen] = useState(false)
    const hook = useTrackedRepos()
    const { toast } = useToast()

    const tracked = hook.repos.find(r => r.repo_full_name === repoFullName)
    const isPinned = tracked?.is_pinned === 1
    const isMuted = tracked?.is_muted === 1

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

    const handlePin = () => runAction(hook.pin, `Pinned ${repoFullName}`)
    const handleUnpin = () => runAction(hook.unpin, `Unpinned ${repoFullName}`)
    const handleMute = () => runAction(hook.mute, `Muted ${repoFullName}`)
    const handleUnmute = () => runAction(hook.unmute, `Unmuted ${repoFullName}`)
    const handleUntrack = () => runAction(hook.untrack, `Stopped tracking ${repoFullName}`)

    const handleCopy = () => {
        setOpen(false)
        navigator.clipboard?.writeText(itemUrl)
        toast.success('Link copied')
    }

    const handleOpenGitHub = () => {
        setOpen(false)
        window.open(itemUrl, '_blank', 'noopener')
    }

    const handleOpenInApp = () => {
        setOpen(false)
        if (!itemType || !Number.isFinite(itemNumber)) return
        const eventName = itemType === 'pr' ? 'app:open-repo-pr' : 'app:open-repo-issue'
        window.dispatchEvent(new CustomEvent(eventName, { detail: { repoFullName, number: itemNumber } }))
    }

    const stopBubble = (e) => {
        e.stopPropagation()
    }

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    aria-label="More actions"
                    onClick={stopBubble}
                    onMouseDown={stopBubble}
                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 focus-within:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                >
                    <MoreHorizontal className="w-4 h-4 text-slate-500" />
                </button>
            </Popover.Trigger>
            <Popover.Content
                side="bottom"
                align="end"
                sideOffset={4}
                onClick={(e) => e.stopPropagation()}
                className="z-50 min-w-[220px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1 shadow-xl"
            >
                {itemType && Number.isFinite(itemNumber) && (
                    <MenuItem
                        icon={<Eye className="w-3.5 h-3.5" />}
                        label={itemType === 'pr' ? 'Open PR in app' : 'Open issue in app'}
                        onClick={handleOpenInApp}
                    />
                )}
                <MenuItem icon={<Copy className="w-3.5 h-3.5" />} label="Copy link" onClick={handleCopy} />
                <MenuItem icon={<ExternalLink className="w-3.5 h-3.5" />} label="Open on GitHub" onClick={handleOpenGitHub} />
                <Separator />
                {isPinned
                    ? <MenuItem icon={<PinOff className="w-3.5 h-3.5" />} label={`Unpin ${repoFullName}`} onClick={handleUnpin} />
                    : <MenuItem icon={<Pin className="w-3.5 h-3.5" />} label={`Pin ${repoFullName}`} onClick={handlePin} />}
                {isMuted
                    ? <MenuItem icon={<Bell className="w-3.5 h-3.5" />} label={`Unmute ${repoFullName}`} onClick={handleUnmute} />
                    : <MenuItem icon={<BellOff className="w-3.5 h-3.5" />} label={`Mute ${repoFullName}`} onClick={handleMute} />}
                <Separator />
                <MenuItem
                    icon={<X className="w-3.5 h-3.5 text-rose-500" />}
                    label={`Stop tracking ${repoFullName}`}
                    onClick={handleUntrack}
                    destructive
                />
            </Popover.Content>
        </Popover.Root>
    )
}

function MenuItem({ icon, label, onClick, destructive = false }) {
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

function Separator() {
    return <div className="h-px bg-slate-200 dark:bg-slate-700 my-1" />
}
