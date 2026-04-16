import { X } from 'lucide-react'

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
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-200">Keyboard shortcuts</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200" aria-label="Close shortcuts">
            <X className="w-4 h-4" />
          </button>
        </div>
        <ul className="space-y-2">
          {SHORTCUTS.map((s, i) => (
            <li key={i} className="flex items-center justify-between text-xs">
              <span className="text-slate-400">{s.label}</span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-800 border border-slate-700 rounded text-slate-300">{k}</kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
