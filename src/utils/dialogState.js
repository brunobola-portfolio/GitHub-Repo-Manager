/**
 * Is a BLOCKING dialog currently open?
 *
 * Shared guard for global single-key shortcuts (useFocusedRow's j/k row
 * navigation, InboxPanel's e/s actions): while a modal dialog covers the
 * page, those keys must not act on the hidden surface underneath.
 *
 * "Blocking" means:
 *   - any `[aria-modal="true"]` element, or
 *   - any `[role="dialog"]` element that is NOT explicitly `aria-modal="false"`
 *     (dialogs that omit the attribute stay blocking — ConfirmModal-style
 *     modals may not set it).
 *
 * Explicitly non-modal dialogs (`role="dialog"` + `aria-modal="false"`, e.g.
 * the Header system-health popover) leave the page interactive, so they must
 * NOT suppress shortcuts.
 *
 * @returns {boolean}
 */
export function isBlockingDialogOpen() {
    return Boolean(
        document.querySelector('[aria-modal="true"], [role="dialog"]:not([aria-modal="false"])'),
    )
}
