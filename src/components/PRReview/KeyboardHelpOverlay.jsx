import { Modal } from '../ui/Modal'
import { Keyboard } from 'lucide-react'

const GROUPS = [
    {
        label: 'Navigate',
        shortcuts: [
            { key: 'j', action: 'Next file' },
            { key: 'k', action: 'Previous file' },
            { key: 'Esc', action: 'Close review / cancel composer' },
        ],
    },
    {
        label: 'Review',
        shortcuts: [
            { key: 'x', action: 'Mark current file as reviewed' },
            { key: 'Ctrl Shift Enter', action: 'Submit review (Approve / Comment / Request changes via UI)' },
        ],
    },
    {
        label: 'Diff',
        shortcuts: [
            { key: 'Ctrl Enter', action: 'Submit inline comment' },
            { key: 'Esc', action: 'Cancel inline comment composer' },
        ],
    },
    {
        label: 'Help',
        shortcuts: [
            { key: '?', action: 'Show this overlay' },
        ],
    },
]

function KeyChip({ label }) {
    // Splits multi-key combos like "Ctrl Shift Enter" into individual chips.
    const parts = label.split(' ')
    return (
        <span className="inline-flex items-center gap-1">
            {parts.map((p, i) => (
                <kbd
                    key={i}
                    className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-200 shadow-sm"
                >
                    {p}
                </kbd>
            ))}
        </span>
    )
}

/**
 * Modal showing the canonical PR-review keyboard shortcuts grouped by
 * section. Mounted by PRReviewView; toggled by the `?` shortcut.
 */
export function KeyboardHelpOverlay({ isOpen, onClose }) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Keyboard shortcuts"
            subtitle="Power through reviews"
            icon={Keyboard}
            iconGradient="primary"
            size="lg"
            mobileVariant="sheet"
        >
            <div className="grid gap-6 sm:grid-cols-2 p-2">
                {GROUPS.map(group => (
                    <section key={group.label}>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                            {group.label}
                        </h3>
                        <dl className="space-y-2">
                            {group.shortcuts.map((s, i) => (
                                <div key={i} className="flex items-center justify-between gap-3">
                                    <dt className="flex-shrink-0">
                                        <KeyChip label={s.key} />
                                    </dt>
                                    <dd className="text-xs text-slate-600 dark:text-slate-300 text-right">
                                        {s.action}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </section>
                ))}
            </div>
        </Modal>
    )
}
