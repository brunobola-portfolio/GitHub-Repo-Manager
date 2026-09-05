// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CloudOff, X } from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { DURATION } from './motion'

/**
 * PendingSyncBanner — sticky bottom banner that surfaces gh_outbox rows
 * the worker hasn't been able to deliver yet. Polls every 30s while the
 * tab is visible; auto-hides when the queue empties.
 *
 * Mounted in App.jsx alongside the toast container so it overlays every
 * view. Dismissable per session (the X button hides it until reload —
 * the queue itself isn't cleared, just the banner).
 */
export function PendingSyncBanner({ isAuthenticated }) {
    const [count, setCount] = useState(0)
    const [dismissed, setDismissed] = useState(false)

    useEffect(() => {
        if (!isAuthenticated) return
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') return
        let cancelled = false

        const poll = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/v1/outbox/pending`, { credentials: 'include' })
                if (!res.ok || cancelled) return
                const json = await res.json()
                if (!cancelled) setCount(json.count || 0)
            } catch {
                // silent — outbox endpoint failing shouldn't surface as a bug
            }
        }

        // This banner is mounted for the whole session (Header), so an
        // ungated 30s poll kept hitting the server for every backgrounded tab.
        // Same stop/start shape as useSystemHealth / useWorkBoard: pause while
        // hidden, re-poll immediately on return so the count is never stale.
        let intervalId = null
        const startInterval = () => {
            if (!intervalId) {
                intervalId = setInterval(() => { if (!document.hidden) poll() }, 30_000)
            }
        }
        const stopInterval = () => {
            if (intervalId) {
                clearInterval(intervalId)
                intervalId = null
            }
        }
        const onVisibility = () => {
            if (document.hidden) stopInterval()
            else { poll(); startInterval() }
        }

        poll()
        startInterval()
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
            cancelled = true
            stopInterval()
            document.removeEventListener('visibilitychange', onVisibility)
        }
    }, [isAuthenticated])

    const visible = isAuthenticated && count > 0 && !dismissed

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 24 }}
                    transition={{ duration: DURATION.standard }}
                    role="status"
                    aria-live="polite"
                    className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[var(--ds-z-popover)] flex items-center gap-3 px-4 py-2.5 rounded-full bg-amber-500/95 dark:bg-amber-600/95 text-white shadow-lg backdrop-blur-md max-w-[90vw]"
                >
                    <CloudOff className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                    <div className="text-sm font-medium">
                        <span className="hidden sm:inline">Pending sync · </span>
                        <span>
                            {count === 1
                                ? '1 change waiting to reach GitHub'
                                : `${count} changes waiting to reach GitHub`}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setDismissed(true)}
                        className="p-1 rounded-full hover:bg-white/15 transition-colors ds-focus-ring"
                        aria-label="Dismiss banner"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
