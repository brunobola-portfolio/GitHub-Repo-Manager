import { cloneElement, Children, useId, useRef, useState, useCallback } from 'react'

export function Tooltip({ label, children, delay = 300 }) {
  const [visible, setVisible] = useState(false)
  const timer = useRef(null)
  const id = useId()

  const show = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setVisible(true), delay)
  }, [delay])

  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setVisible(false)
  }, [])

  const child = Children.only(children)
  const { onMouseEnter, onMouseLeave, onFocus, onBlur } = child.props

  return (
    <span className="relative inline-flex">
      {/* eslint-disable-next-line react-hooks/refs -- cloneElement is the standard pattern for aria injection; no ref is passed */}
      {cloneElement(child, {
        'aria-describedby': visible ? id : undefined,
        onMouseEnter: (e) => { show(); onMouseEnter?.(e) },
        onMouseLeave: (e) => { hide(); onMouseLeave?.(e) },
        onFocus: (e) => { show(); onFocus?.(e) },
        onBlur: (e) => { hide(); onBlur?.(e) },
      })}
      {visible && (
        <span
          id={id}
          role="tooltip"
          className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[12px] text-white bg-[color:var(--ds-surface-dark)] rounded-[var(--ds-radius-sm)] whitespace-nowrap pointer-events-none"
        >
          {label}
        </span>
      )}
    </span>
  )
}
