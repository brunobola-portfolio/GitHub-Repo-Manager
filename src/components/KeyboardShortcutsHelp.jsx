import { Keyboard } from 'lucide-react'
import { useFocusTrap } from '../hooks/useFocusTrap'

export function KeyboardShortcutsHelp({ isOpen, onClose, shortcuts }) {
    const modalRef = useFocusTrap(isOpen, onClose)

    if (!isOpen) return null

    const grouped = {
        global: shortcuts.filter(s => s.scope === 'global'),
        navigation: shortcuts.filter(s => s.scope === 'navigation')
    }

    return (
        <div role="presentation" className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="keyboard-shortcuts-title"
                className="bg-white dark:bg-slate-950 rounded-2xl shadow-[0_25px_60px_-12px_rgba(0,0,0,0.35)] dark:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.7)] ring-1 ring-slate-200/50 dark:ring-slate-700/50 overflow-hidden w-full max-w-sm p-5"
                onClick={e => e.stopPropagation()}
            >
                    <div className="flex items-center justify-between mb-4">
                        <h2 id="keyboard-shortcuts-title" className="text-lg font-bold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                            <Keyboard className="w-5 h-5 text-indigo-500" />
                            Keyboard Shortcuts
                        </h2>
                        <button onClick={onClose} className="p-2 hover:bg-slate-200/50 dark:hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 text-xl leading-none" aria-label="Close keyboard shortcuts">&times;</button>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">General</h3>
                            <div className="space-y-1.5">
                                {grouped.global.map(s => (
                                    <div key={s.key} className="flex items-center justify-between">
                                        <span className="text-sm text-slate-700 dark:text-slate-300">{s.description}</span>
                                        <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs font-mono text-slate-600 dark:text-slate-400 min-w-[24px] text-center">
                                            {s.key}
                                        </kbd>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div>
                            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Navigation</h3>
                            <div className="space-y-1.5">
                                {grouped.navigation.map(s => (
                                    <div key={s.key} className="flex items-center justify-between">
                                        <span className="text-sm text-slate-700 dark:text-slate-300">{s.description}</span>
                                        <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs font-mono text-slate-600 dark:text-slate-400 min-w-[24px] text-center">
                                            {s.key}
                                        </kbd>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-4 text-center">
                        Press <kbd className="px-1 bg-slate-100 dark:bg-slate-800 rounded text-xs font-mono">Esc</kbd> to close
                    </p>
            </div>
        </div>
    )
}
