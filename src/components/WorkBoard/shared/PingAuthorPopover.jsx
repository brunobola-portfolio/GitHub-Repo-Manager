import { useState } from 'react'
import { motion } from 'framer-motion'
import { MessageSquare } from 'lucide-react'
import * as Popover from '@radix-ui/react-popover'
import { clsx } from 'clsx'
import { Spinner } from '../../ui/Spinner'
import { Textarea } from '../../ui/form'
import { getCsrfToken } from '../../../utils/api'

// Module-level cache shared across every PingAuthorPopover instance
// (and across the two tabs that mount them). Entries live 30 minutes.
// Identity is the cacheKey passed in by the caller — usually
// `${repoFullName}/${itemType}/${itemNumber}`.
const _suggestCache = new Map()
const TTL_MS = 30 * 60 * 1000

/**
 * PingAuthorPopover — shared "Ping author" chip + AI-draft popover.
 *
 * Used by MyReviewsTab and StalePRsTab (and any future Work Board tab
 * that needs the same "ping the author with an AI-suggested comment"
 * flow). Before extracting this, both tabs carried ~120 LOC of
 * identical ChipStrip + popover markup, which made consistency
 * impossible to enforce.
 *
 * Props
 *  - cacheKey:       unique id for the cached AI suggestion
 *  - requestPayload: body sent to /api/v1/work-board/suggest-action
 *                    when there is no cached suggestion yet
 *  - onPing:         called with the (possibly edited) message body
 *                    when the user clicks Send
 *  - disabled:       hide the chip entirely (AI not available)
 */
export function PingAuthorPopover({ cacheKey, requestPayload, onPing, disabled = false }) {
    const [pingState, setPingState] = useState('idle')
    const [pingBody, setPingBody] = useState('')
    const [popoverOpen, setPopoverOpen] = useState(false)
    const [editing, setEditing] = useState(false)

    if (disabled) return null

    async function handlePing() {
        if (pingState === 'ready') {
            setPopoverOpen(true)
            return
        }

        const cached = _suggestCache.get(cacheKey)
        if (cached && Date.now() < cached.expiresAt) {
            const ping = cached.suggestions?.find(s => s.action === 'comment')
            setPingBody(ping?.body || '')
            setPingState('ready')
            setPopoverOpen(true)
            return
        }

        setPingState('loading')
        try {
            const csrf = await getCsrfToken()
            const res = await fetch('/api/v1/work-board/suggest-action', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: JSON.stringify(requestPayload),
            })
            if (!res.ok) throw new Error('suggest-action failed')
            const { suggestions } = await res.json()
            _suggestCache.set(cacheKey, { suggestions, expiresAt: Date.now() + TTL_MS })
            const ping = suggestions?.find(s => s.action === 'comment')
            setPingBody(ping?.body || '')
            setPingState('ready')
            setPopoverOpen(true)
        } catch {
            setPingState('error')
        }
    }

    return (
        <Popover.Root open={popoverOpen} onOpenChange={setPopoverOpen}>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    onClick={handlePing}
                    className={clsx(
                        'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                        pingState === 'error'
                            ? 'border-rose-500/50 text-rose-600 dark:text-rose-400'
                            : 'border-indigo-500/50 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/10',
                    )}
                >
                    {pingState === 'loading'
                        ? <Spinner size="xs" />
                        : <MessageSquare className="w-3 h-3" />}
                    {pingState === 'error' ? 'Try again' : 'Ping author'}
                </button>
            </Popover.Trigger>
            <Popover.Content
                side="bottom"
                align="start"
                avoidCollisions
                className="z-[var(--ds-z-popover)] w-72 rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900 p-3 shadow-xl"
            >
                <p className="mb-2 ds-text-meta text-slate-500 dark:text-slate-400">AI draft — edit before sending</p>
                <Textarea
                    defaultValue={pingBody}
                    onChange={e => setPingBody(e.target.value)}
                    rows={3}
                    aria-label="AI draft comment"
                />
                <div className="mt-2 flex gap-2 justify-end">
                    <button
                        type="button"
                        onClick={() => setPopoverOpen(false)}
                        className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                    >
                        Cancel
                    </button>
                    {!editing && (
                        <button
                            type="button"
                            onClick={() => setEditing(true)}
                            className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                        >
                            Edit first
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => { setPopoverOpen(false); onPing?.(pingBody) }}
                        className="px-3 py-1 text-xs bg-[color:var(--ds-accent-brand)] hover:bg-indigo-500 text-white rounded-lg"
                    >
                        Send
                    </button>
                </div>
                <Popover.Arrow className="fill-white dark:fill-slate-900" />
            </Popover.Content>
        </Popover.Root>
    )
}

/**
 * AnimatedChipStrip — the row-level container that wraps the
 * PingAuthorPopover + Snooze + View-on-GitHub chips. Extracted as a
 * convenience so MyReviewsTab / StalePRsTab don't repeat the same
 * height-collapse motion + flex layout.
 */
export function AnimatedChipStrip({ children }) {
    return (
        <motion.div
            className="flex items-center gap-2 px-3 pb-2 pt-0"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
        >
            {children}
        </motion.div>
    )
}
