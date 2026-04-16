import { X } from 'lucide-react'
import { useFocusTrap } from '../../../../hooks/useFocusTrap'

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
  const panelRef = useFocusTrap(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-overlay-title"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 id="shortcuts-overlay-title" className="text-sm font-semibold text-slate-800 dark:text-slate-200">Keyboard shortcuts</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Close shortcuts">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <ul className="space-y-2">
          {SHORTCUTS.map((s, i) => (
            <li key={i} className="flex items-center justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-400">{s.label}</span>
              <span className="flex gap-1" aria-label={s.keys.join(' plus ')}>
                {s.keys.map((k) => (
                  <kbd key={k} className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-slate-700 dark:text-slate-300">{k}</kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
