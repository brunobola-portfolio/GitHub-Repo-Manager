import { motion, AnimatePresence } from 'framer-motion'
import { Pin, BellOff, X } from 'lucide-react'

export function BulkActionsBar({ selectedCount, onAction, onClear }) {
    return (
        <AnimatePresence>
            {selectedCount > 0 && (
                <motion.div
                    initial={{ y: 40, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 40, opacity: 0 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="sticky bottom-0 z-10 flex items-center justify-between gap-3 px-4 py-3 rounded-b-2xl bg-brand-500 text-white ds-elevation-lg"
                    role="region"
                    aria-label="Bulk actions"
                >
                    <span className="text-sm font-medium">{selectedCount} selected</span>
                    <div className="flex items-center gap-2">
                        <BarButton icon={<Pin className="w-3.5 h-3.5" />} label="Pin" onClick={() => onAction('pin')} />
                        <BarButton icon={<BellOff className="w-3.5 h-3.5" />} label="Mute" onClick={() => onAction('mute')} />
                        <BarButton icon={<X className="w-3.5 h-3.5" />} label="Remove" onClick={() => onAction('untrack')} destructive />
                        <button
                            type="button"
                            onClick={onClear}
                            className="px-2 py-1 text-xs text-white hover:text-white ds-focus-ring rounded"
                            aria-label="Clear selection"
                        >
                            Clear
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

function BarButton({ icon, label, onClick, destructive = false }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={
                destructive
                    ? 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg ds-focus-ring bg-rose-600 hover:bg-rose-700 transition-colors'
                    : 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg ds-focus-ring bg-white/20 hover:bg-white/30 transition-colors'
            }
        >
            {icon}
            {label}
        </button>
    )
}
