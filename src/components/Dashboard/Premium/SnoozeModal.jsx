import { Clock } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';

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

/**
 * Snooze an inbox item until one of four moments. Built on the shared Modal
 * so it gets the same backdrop, entrance, focus trap and close control as
 * every other dialog instead of its own hand-rolled shell.
 */
export function SnoozeModal({ open, onConfirm, onClose }) {
    return (
        <Modal
            isOpen={!!open}
            onClose={onClose}
            size="sm"
            icon={Clock}
            title="Snooze until…"
            footer={
                <Button variant="ghost" size="sm" onClick={onClose}>
                    Cancel
                </Button>
            }
        >
            <div className="grid grid-cols-2 gap-2">
                {PRESETS.map(p => (
                    <Button
                        key={p.label}
                        variant="outline"
                        size="md"
                        onClick={() => { onConfirm(p.iso()); onClose?.(); }}
                    >
                        {p.label}
                    </Button>
                ))}
            </div>
        </Modal>
    );
}
