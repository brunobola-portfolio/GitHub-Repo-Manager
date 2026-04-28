import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { HeroChip } from './HeroChip'
import { useRelativeTime } from '../../hooks/useRelativeTime.js'

export function HeroSyncChip({ onSync, lastSyncedAt }) {
    const [syncing, setSyncing] = useState(false)
    const relative = useRelativeTime(lastSyncedAt)

    const handleClick = async () => {
        if (syncing) return
        setSyncing(true)
        try {
            await onSync?.()
        } finally {
            setSyncing(false)
        }
    }

    const label = syncing ? 'A sincronizar…' : relative ? `Sync (${relative})` : 'Sync'
    const ariaLabel = lastSyncedAt
        ? `Sync now, last synced ${relative ?? 'just now'}`
        : 'Sync now'

    return (
        <HeroChip
            icon={RefreshCw}
            label={label}
            onClick={handleClick}
            disabled={syncing}
            busy={syncing}
            aria-label={ariaLabel}
            className="md:hidden"
        />
    )
}
