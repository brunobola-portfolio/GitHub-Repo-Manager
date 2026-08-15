/*
 * GitHub Repo Manager
 * Offline banner — fixed bar at the top of the viewport while the
 * browser reports the user is offline.
 *
 * navigator.onLine is a rough signal (it flips on DNS/cable loss but
 * not always when a specific server is unreachable), so the copy is
 * deliberately soft. The retry queue handles the mutation side.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the Apache License 2.0 (SPDX: Apache-2.0). See LICENSE in the project root.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { WifiOff } from 'lucide-react'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'

export function OfflineBanner() {
    const { isOffline } = useOnlineStatus()
    return (
        <AnimatePresence>
            {isOffline && (
                <motion.div
                    initial={{ y: -50, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -50, opacity: 0 }}
                    className="fixed top-0 left-0 right-0 z-[var(--ds-z-ceiling)] bg-amber-500 dark:bg-amber-600 text-white text-sm font-medium py-2 px-4 flex items-center justify-center gap-2 shadow-lg"
                    role="status"
                    aria-live="polite"
                    data-testid="offline-banner"
                >
                    <WifiOff className="w-4 h-4" aria-hidden="true" />
                    <span>You're offline — changes will retry when the connection returns.</span>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

export default OfflineBanner
