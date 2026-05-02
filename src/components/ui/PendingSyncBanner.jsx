// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CloudOff, X } from 'lucide-react'
import { API_BASE_URL } from '../../config'

/**
 * PendingSyncBanner — sticky bottom banner that surfaces gh_outbox rows
 * the worker hasn't been able to deliver yet. Polls every 30s while the
 * user is on the page; auto-hides when the queue empties.
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

        poll()
        const id = setInterval(poll, 30_000)
        return () => { cancelled = true; clearInterval(id) }
    }, [isAuthenticated])

    const visible = isAuthenticated && count > 0 && !dismissed

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 24 }}
                    transition={{ duration: 0.25 }}
                    role="status"
                    aria-live="polite"
                    className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-full bg-amber-500/95 dark:bg-amber-600/95 text-white shadow-2xl backdrop-blur-md max-w-[90vw]"
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
                        className="p-1 rounded-full hover:bg-white/15 transition-colors"
                        aria-label="Dismiss banner"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
