import { useFocusTrap } from '../../../hooks/useFocusTrap';

function in1Hour() { return new Date(Date.now() + 60 * 60_000).toISOString(); }
function tomorrow9am() {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    return d.toISOString();
}
function nextMonday9am() {
    const d = new Date();
    const daysUntilMon = (1 + 7 - d.getDay()) % 7 || 7;
    d.setDate(d.getDate() + daysUntilMon); d.setHours(9, 0, 0, 0);
    return d.toISOString();
}
function in1Week() { return new Date(Date.now() + 7 * 86400_000).toISOString(); }

const PRESETS = [
    { label: '1 hour', iso: in1Hour },
    { label: 'Tomorrow 9am', iso: tomorrow9am },
    { label: 'Next Monday', iso: nextMonday9am },
    { label: '1 week', iso: in1Week },
];

export function SnoozeModal({ open, onConfirm, onClose }) {
    // useFocusTrap handles Escape → onClose, Tab cycling, focus restore.
    // The returned ref is attached to the inner card (the trap root), not the backdrop.
    const trapRef = useFocusTrap(open, onClose);

    if (!open) return null;

    return (
        /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="snooze-modal-title"
            className="fixed inset-0 z-[var(--ds-z-modal)] flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={onClose}
        >
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
            <div
                ref={trapRef}
                className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl"
                onClick={e => e.stopPropagation()}
            >
                <h3 id="snooze-modal-title" className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-4 ds-font-display">
                    Snooze until…
                </h3>
                <div className="grid grid-cols-2 gap-2">
                    {PRESETS.map(p => (
                        <button
                            key={p.label}
                            type="button"
                            onClick={() => { onConfirm(p.iso()); onClose?.(); }}
                            className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm text-zinc-800 dark:text-zinc-200"
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="mt-4 w-full text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
