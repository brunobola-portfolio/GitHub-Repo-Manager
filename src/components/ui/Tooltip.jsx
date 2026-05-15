import { useRef, useState } from 'react'

export function Tooltip({ label, children, delay = 300 }) {
  const [visible, setVisible] = useState(false)
  const timer = useRef(null)

  const show = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setVisible(true), delay)
  }
  const hide = () => {
    clearTimeout(timer.current)
    setVisible(false)
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {visible && (
        <span
          role="tooltip"
          className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[12px] text-white bg-[color:var(--ds-surface-dark)] rounded-[var(--ds-radius-sm)] whitespace-nowrap pointer-events-none"
        >
          {label}
        </span>
      )}
    </span>
  )
}
