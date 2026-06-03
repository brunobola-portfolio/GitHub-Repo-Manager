import { Keyboard } from 'lucide-react'
import { Modal } from './ui/Modal'
import { useMediaQuery } from '../hooks/useMediaQuery'

export function KeyboardShortcutsHelp({ isOpen, onClose, shortcuts }) {
    // On touch devices these keys aren't reachable — say so instead of listing
    // them as if they work everywhere.
    const isCoarsePointer = useMediaQuery('(pointer: coarse)')
    const grouped = {
        global: shortcuts.filter(s => s.scope === 'global'),
        navigation: shortcuts.filter(s => s.scope === 'navigation'),
        inbox: shortcuts.filter(s => s.scope === 'inbox'),
        repoAction: shortcuts.filter(s => s.scope === 'repo-action'),
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Keyboard Shortcuts"
            icon={Keyboard}
            size="sm"
        >
            {isCoarsePointer && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-3 text-center" role="note">
                    These shortcuts need a physical keyboard — connect one to use them on this device.
                </p>
            )}
            <div className="space-y-4">
                <ShortcutGroup title="General" items={grouped.global} />
                <ShortcutGroup title="Navigation" items={grouped.navigation} />
                <ShortcutGroup title="Live Inbox" items={grouped.inbox} />
                <ShortcutGroup title="Repo Actions" items={grouped.repoAction} />
            </div>

            <p className="text-xs text-slate-400 dark:text-slate-500 mt-4 text-center">
                Press <kbd className="px-1 bg-slate-100 dark:bg-slate-800 rounded text-xs font-mono">Esc</kbd> to close
            </p>
        </Modal>
    )
}

function ShortcutGroup({ title, items }) {
    if (!items.length) return null
    return (
        <div>
            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">{title}</h3>
            <div className="space-y-1.5">
                {items.map(s => (
                    <div key={s.key} className="flex items-center justify-between">
                        <span className="text-sm text-slate-700 dark:text-slate-300">{s.description}</span>
                        <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs font-mono text-slate-600 dark:text-slate-400 min-w-[24px] text-center">
                            {s.key}
                        </kbd>
                    </div>
                ))}
            </div>
        </div>
    )
}
