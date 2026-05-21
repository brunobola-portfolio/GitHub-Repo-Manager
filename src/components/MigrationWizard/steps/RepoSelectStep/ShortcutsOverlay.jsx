import { Keyboard } from 'lucide-react'
import { Modal } from '../../../ui/Modal'

const SHORTCUTS = [
    { keys: ['/'],                label: 'Focus search' },
    { keys: ['↑', '↓'],           label: 'Navigate rows' },
    { keys: ['Space'],            label: 'Toggle selection' },
    { keys: ['Enter'],            label: 'Open detail panel' },
    { keys: ['Esc'],              label: 'Close detail panel' },
    { keys: ['J', 'K'],           label: 'Prev/next in panel' },
    { keys: ['I'],                label: 'Invert selection' },
    { keys: ['Ctrl', 'A'],        label: 'Select all visible' },
    { keys: ['Ctrl', 'Shift', 'A'], label: 'Deselect all' },
    { keys: ['?'],                label: 'Show this help' },
]

export function ShortcutsOverlay({ open, onClose }) {
    return (
        <Modal
            isOpen={open}
            onClose={onClose}
            title="Keyboard shortcuts"
            subtitle="Repo Select"
            icon={Keyboard}
            size="sm"
        >
            <ul className="space-y-2">
                {SHORTCUTS.map((s) => (
                    <li key={s.keys.join('+')} className="flex items-center justify-between text-xs">
                        <span className="text-slate-600 dark:text-slate-400">{s.label}</span>
                        <span className="flex gap-1" aria-label={s.keys.join(' plus ')}>
                            {s.keys.map((k) => (
                                <kbd key={k} className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-700 dark:text-slate-300">{k}</kbd>
                            ))}
                        </span>
                    </li>
                ))}
            </ul>
        </Modal>
    )
}
