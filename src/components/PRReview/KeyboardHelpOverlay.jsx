import { getAllShortcuts } from '../../config/keyboardShortcuts'
import { KeyboardShortcutsHelp } from '../KeyboardShortcutsHelp'

/**
 * PR-Review-scoped wrapper around the shared shortcuts dialog
 * (`KeyboardShortcutsHelp`). Mounted by PRReviewView; toggled by the `?`
 * shortcut. Used to be its own modal shell with its own `<kbd>` recipe —
 * see F15 / U32 in docs/reports/2026-09-04-*; it now narrows the shared
 * catalog to `scope: 'prReview'` instead.
 */
export function KeyboardHelpOverlay({ isOpen, onClose }) {
    return (
        <KeyboardShortcutsHelp
            isOpen={isOpen}
            onClose={onClose}
            shortcuts={getAllShortcuts()}
            scope="prReview"
            title="Keyboard shortcuts"
            subtitle="Power through reviews"
            size="lg"
            mobileVariant="sheet"
        />
    )
}
