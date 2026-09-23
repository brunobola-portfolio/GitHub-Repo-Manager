import { useEffect, useRef } from 'react'

/**
 * Close a popover on a press outside it or on Escape, while it is open.
 *
 * Ten components wrote this by hand and had drifted: some listened on
 * mousedown, one on pointerdown, one on window; half ignored Escape; several
 * kept their listener attached while closed. This is the one version.
 *
 * `refs` is one ref or a list (e.g. the trigger button and the panel), and a
 * press inside any of them is not "outside". Touch devices send mousedown on a
 * tap, so mousedown covers both.
 *
 * @param {import('react').RefObject<Element>|Array<import('react').RefObject<Element>>} refs
 * @param {{ open: boolean, onClose: (e: Event) => void, escape?: boolean }} options
 */
export function useDismiss(refs, { open, onClose, escape = true }) {
    const latest = useRef({ refs, onClose })
    useEffect(() => { latest.current = { refs, onClose } })

    useEffect(() => {
        if (!open) return undefined
        const inside = (target) => {
            const list = Array.isArray(latest.current.refs) ? latest.current.refs : [latest.current.refs]
            return list.some((r) => r?.current && r.current.contains(target))
        }
        const onPress = (e) => { if (!inside(e.target)) latest.current.onClose(e) }
        const onKey = (e) => { if (e.key === 'Escape') latest.current.onClose(e) }
        document.addEventListener('mousedown', onPress)
        if (escape) document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onPress)
            if (escape) document.removeEventListener('keydown', onKey)
        }
    }, [open, escape])
}
