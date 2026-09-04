import { getAllShortcuts } from '../../../../config/keyboardShortcuts'
import { KeyboardShortcutsHelp } from '../../../KeyboardShortcutsHelp'

/**
 * Repo-Select-scoped wrapper around the shared shortcuts dialog
 * (`KeyboardShortcutsHelp`). Used to be its own modal shell with its own
 * `<kbd>` recipe — see F15 / U32 in docs/reports/2026-09-04-*; it now
 * narrows the shared catalog to `scope: 'wizard'` instead.
 */
export function ShortcutsOverlay({ open, onClose }) {
    return (
        <KeyboardShortcutsHelp
            isOpen={open}
            onClose={onClose}
            shortcuts={getAllShortcuts()}
            scope="wizard"
            title="Keyboard shortcuts"
            subtitle="Repo Select"
            size="sm"
        />
    )
}
