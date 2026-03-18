import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(isOpen, onClose) {
    const ref = useRef(null)
    const previouslyFocusedRef = useRef(null)

    useEffect(() => {
        if (!isOpen) return

        previouslyFocusedRef.current = document.activeElement

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                onClose()
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
            if (previouslyFocusedRef.current?.focus) {
                previouslyFocusedRef.current.focus()
            }
        }
    }, [isOpen, onClose])

    return ref
}
