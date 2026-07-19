import { Keyboard } from 'lucide-react'
import { Modal } from '../ui/Modal'

const ROWS = [
    { group: 'Navigate', items: [
        ['j  /  ↓', 'next row'],
        ['k  /  ↑', 'previous row'],
        ['Click a tab', 'switch section (or use ⌘K / Ctrl+K command palette)'],
    ]},
    { group: 'Actions', items: [
        ['Enter', 'open the active row on GitHub'],
        ['.', 'approve (PR rows)'],
        ['x', 'request changes (PR rows — opens prompt)'],
        ['s', 'snooze 24 h'],
        ['Shift+S', 'snooze 7 d'],
        ['u', 'unsnooze'],
        ['r', 're-request review'],
    ]},
    { group: 'Global', items: [
        ['/', 'focus filter search (when available)'],
        ['?', 'this help'],
        ['⌘K / Ctrl+K', 'command palette'],
    ]},
]

export function KeyboardHelpModal({ open, onClose }) {
    return (
        <Modal
            isOpen={open}
            onClose={onClose}
            title="Keyboard shortcuts"
            subtitle="Work Board"
            icon={Keyboard}
            size="lg"
            closeOnBackdrop={false}
        >
            <div className="grid gap-5">
                {ROWS.map(section => (
                    <section key={section.group}>
                        <h3 className="ds-text-meta font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">{section.group}</h3>
                        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                            {section.items.map(([k, d]) => (
                                <div key={k} className="contents">
                                    <kbd className="font-mono ds-text-meta px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 justify-self-start">{k}</kbd>
                                    <span className="text-slate-600 dark:text-slate-300">{d}</span>
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </Modal>
    )
}
