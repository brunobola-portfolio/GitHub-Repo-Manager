import { useEffect } from 'react'

export function useMobileKeyboardFix(isOpen, containerRef) {
    useEffect(() => {
        if (!isOpen) return

        const handleFocus = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                setTimeout(() => {
                    e.target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }, 300)
            }
        }

        const el = containerRef.current
        el?.addEventListener('focusin', handleFocus)
        return () => el?.removeEventListener('focusin', handleFocus)
    }, [isOpen, containerRef])
}
