import { useCallback, useEffect, useState } from 'react'

export function useRowNavigation({ rows, onOpen, onKey }) {
    const [activeIndex, setActiveIndex] = useState(0)

    useEffect(() => {
        if (activeIndex >= rows.length) {
            setActiveIndex(Math.max(0, rows.length - 1))
        }
    }, [rows.length, activeIndex])

    const move = useCallback((delta) => {
        setActiveIndex(i => {
            if (rows.length === 0) return 0
            return (i + delta + rows.length) % rows.length
        })
    }, [rows.length])

    useEffect(() => {
        function handler(e) {
            const tag = (e.target?.tagName || '').toLowerCase()
            if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return
            if (e.metaKey || e.ctrlKey || e.altKey) return

            if (e.key === 'j' || e.key === 'ArrowDown') {
                e.preventDefault()
                move(1)
            } else if (e.key === 'k' || e.key === 'ArrowUp') {
                e.preventDefault()
                move(-1)
            } else if (e.key === 'Enter' && rows[activeIndex] !== undefined) {
                onOpen?.(rows[activeIndex], activeIndex)
            } else {
                onKey?.(e, rows[activeIndex], activeIndex)
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [rows, activeIndex, move, onOpen, onKey])

    return { activeIndex, setActiveIndex, move }
}
