import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Focus trap with configurable initial + restore targets.
 *
 * @param {boolean} isOpen
 * @param {() => void} onClose
 * @param {object}  [options]
 * @param {boolean} [options.disableEscape=false]   - Block Escape closing
 * @param {React.RefObject<HTMLElement>} [options.initialFocusRef]
 *        - When set, focus this element on open instead of the first
 *          focusable inside the trap. If the ref is null at mount, the
 *          hook falls back to first-focusable.
 * @param {React.RefObject<HTMLElement>} [options.restoreFocusRef]
 *        - When set, return focus to this element on close instead of
 *          whatever was focused before opening. Same null-fallback.
 * @returns {React.RefObject<HTMLElement>} - Ref to attach to the trap root
 */
export function useFocusTrap(isOpen, onClose, options = {}) {
    const { disableEscape = false, initialFocusRef, restoreFocusRef } = options
    const ref = useRef(null)
    const previouslyFocusedRef = useRef(null)

    useEffect(() => {
        if (!isOpen) return

        previouslyFocusedRef.current = document.activeElement
        // Snapshot the caller-provided restore target NOW so the cleanup
        // closure sees the value present at open-time (the React eslint
        // rule reasonably warns that ref.current may have changed by
        // cleanup; for restore-on-close we want the open-time value).
        const restoreTargetAtOpen = restoreFocusRef?.current ?? null

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (!disableEscape) onClose()
                return
            }
            if (e.key !== 'Tab') return

            const modal = ref.current
            if (!modal) return

            const focusable = Array.from(modal.querySelectorAll(FOCUSABLE))
            if (!focusable.length) return

            const first = focusable[0]
            const last = focusable[focusable.length - 1]

            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault()
                    last.focus()
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault()
                    first.focus()
                }
            }
        }

        document.addEventListener('keydown', handleKeyDown)

        const timer = setTimeout(() => {
            // Caller-provided initialFocusRef takes precedence — used by
            // sheets to land focus on the active row instead of the close-X.
            const initial = initialFocusRef?.current
            if (initial && typeof initial.focus === 'function') {
                initial.focus()
                return
            }
            const firstFocusable = ref.current?.querySelector(FOCUSABLE)
            if (firstFocusable) {
                firstFocusable.focus()
            } else if (ref.current) {
                ref.current.setAttribute('tabindex', '-1')
                ref.current.focus()
            }
        }, 50)

        return () => {
            document.removeEventListener('keydown', handleKeyDown)
            clearTimeout(timer)
            // Caller-provided restoreFocusRef takes precedence — used by
            // FAB-driven sheets to return focus to the FAB rather than to
            // <body>. Falls back to whatever was focused before opening.
            const restore = restoreTargetAtOpen ?? previouslyFocusedRef.current
            if (restore?.focus) {
                restore.focus()
            }
        }
    }, [isOpen, onClose, disableEscape, initialFocusRef, restoreFocusRef])

    return ref
}
