import { useState } from 'react'
import { InsightCard } from '../../ui/InsightCard'
import { ConfirmModal } from '../../ui/ConfirmModal'
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react'

export function DangerZoneCard({ onResetDiscovery, onClearAll }) {
    const [confirm, setConfirm] = useState(null)
    const [loading, setLoading] = useState(false)

    const handleConfirm = async () => {
        setLoading(true)
        try {
            if (confirm === 'reset') await onResetDiscovery()
            else if (confirm === 'clear') await onClearAll()
            setConfirm(null)
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <InsightCard tone="danger" hover={false}>
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-500" />
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Danger zone</p>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                        <button
                            type="button"
                            onClick={() => setConfirm('reset')}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors ds-focus-ring"
                        >
                            <RotateCcw className="w-4 h-4" />
                            Reset discovery
                        </button>
                        <button
                            type="button"
                            onClick={() => setConfirm('clear')}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors ds-focus-ring"
                        >
                            <Trash2 className="w-4 h-4" />
                            Clear all data
                        </button>
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Reset clears non-pinned rows and re-runs discovery from scratch.
                        Clear All removes every tracked repository and its history.
                    </p>
                </div>
            </InsightCard>

            <ConfirmModal
                isOpen={confirm === 'reset'}
                onClose={() => setConfirm(null)}
                onConfirm={handleConfirm}
                title="Reset discovery?"
                message="This removes all non-pinned tracked repositories and runs discovery from scratch. Pinned and muted rows are kept."
                confirmText="Reset"
                cancelText="Cancel"
                variant="danger"
                isLoading={loading}
            />
            <ConfirmModal
                isOpen={confirm === 'clear'}
                onClose={() => setConfirm(null)}
                onConfirm={handleConfirm}
                title="Clear all Work Board data?"
                message="This removes every tracked repository (including pinned and muted) and all undo history. Cannot be undone."
                confirmText="Clear everything"
                cancelText="Cancel"
                variant="danger"
                isLoading={loading}
            />
        </>
    )
}
