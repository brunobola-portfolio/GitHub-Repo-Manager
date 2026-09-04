import { getAllShortcuts } from '../../config/keyboardShortcuts'
import { KeyboardShortcutsHelp } from '../KeyboardShortcutsHelp'

/**
 * Work-Board-scoped wrapper around the shared shortcuts dialog
 * (`KeyboardShortcutsHelp`). Used to be its own modal shell with its own
 * `<kbd>` recipe (see F15 / U32 in docs/reports/2026-09-04-*); it now just
 * narrows the shared catalog to `scope: 'workBoard'`, so the Work Board's
 * shortcuts can never drift out of sync with what the global `?` dialog
 * documents for it.
 */
export function KeyboardHelpModal({ open, onClose }) {
    return (
        <KeyboardShortcutsHelp
            isOpen={open}
            onClose={onClose}
            shortcuts={getAllShortcuts()}
            scope="workBoard"
            title="Keyboard shortcuts"
            subtitle="Work Board"
            size="lg"
            closeOnBackdrop={false}
        />
    )
}
