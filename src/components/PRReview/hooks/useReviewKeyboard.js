import { useEffect, useRef } from 'react'

const DEBOUNCE_MS = 80

/**
 * Keyboard shortcuts for the PR Review experience.
 *
 * Shortcuts:
 *   j            → onNextFile
 *   k            → onPrevFile
 *   x            → onToggleReviewed(activeFile)
 *   Escape       → onEscape (no debounce)
 *   Ctrl+Shift+Enter → onSubmitReview
 *
 * Note: hunk navigation, comment opening, and toggle-expand were removed —
 * the underlying surfaces (DiffPanel) don't expose those handlers, so the
 * keymap was wired to no-ops. Only ship shortcuts the call site can wire.
 *
 * @param {object} handlers
 * @param {string} activeFile
 * @param {boolean} [enabled=true]
 */
export function useReviewKeyboard({
    onNextFile,
    onPrevFile,
    onToggleReviewed,
    onEscape,
    onSubmitReview,
    onShowHelp,
    activeFile,
    enabled = true,
}) {
    const lastExecutionRef = useRef(0)

    useEffect(() => {
        if (!enabled) return

        function handleKeyDown(e) {
            const target = e.target
            const isCtrlCombo = e.ctrlKey

            // For non-ctrl combos, skip when typing in inputs
            if (!isCtrlCombo) {
                if (
                    target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.tagName === 'SELECT' ||
                    target.isContentEditable ||
                    target.closest?.('[role="combobox"], [role="textbox"], [role="listbox"]')
                ) {
                    return
                }
                // Skip modifier keys (non-ctrl combos)
                if (e.metaKey || e.altKey) return
            }

            // Handle Ctrl+Shift+Enter (no debounce needed for ctrl combos)
            if (e.ctrlKey && e.shiftKey && e.key === 'Enter') {
                e.preventDefault()
                onSubmitReview?.()
                return
            }

            // Escape: no debounce
            if (e.key === 'Escape') {
                e.preventDefault()
                onEscape?.()
                return
            }

            // Debounce all other shortcuts
            const now = Date.now()
            if (now - lastExecutionRef.current < DEBOUNCE_MS) return
            lastExecutionRef.current = now

            switch (e.key) {
                case 'j':
                    e.preventDefault()
                    onNextFile?.()
                    break
                case 'k':
                    e.preventDefault()
                    onPrevFile?.()
                    break
                case 'x':
                    e.preventDefault()
                    onToggleReviewed?.(activeFile)
                    break
                case '?':
                    e.preventDefault()
                    onShowHelp?.()
                    break
                default:
                    break
            }
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [
        enabled,
        activeFile,
        onNextFile,
        onPrevFile,
        onToggleReviewed,
        onEscape,
        onSubmitReview,
        onShowHelp,
    ])
}
