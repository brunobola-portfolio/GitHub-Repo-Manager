import { useEffect, useState } from 'react'

// Reactively tracks whether a BLOCKING modal dialog is currently mounted
// anywhere in the document — the same "blocking" definition as
// `src/utils/dialogState.js#isBlockingDialogOpen` (any `[aria-modal="true"]`,
// or a `[role="dialog"]` that isn't explicitly `aria-modal="false"`).
//
// Used to hide the mobile bottom navigation while a modal is open: the nav is a
// `position: fixed` bar pinned to the bottom edge, and a bottom-sheet modal's
// action bar lands in the same region — leaving the modal's primary button
// physically overlapped by (and unreliably tappable under) the nav on phones.
// A DOM observer is used rather than threading modal state through every
// call site because modals mount from many places (ModalContext, local state,
// portals) and the DOM is the single source of truth for "is one open".
const SELECTOR = '[aria-modal="true"], [role="dialog"]:not([aria-modal="false"])'

export function useBlockingDialogPresence() {
    const [present, setPresent] = useState(false)

    useEffect(() => {
        if (typeof MutationObserver === 'undefined') return undefined
        const check = () => setPresent(!!document.querySelector(SELECTOR))
        check()
        const observer = new MutationObserver(check)
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['role', 'aria-modal'],
        })
        return () => observer.disconnect()
    }, [])

    return present
}
