/**
 * Delayed tooltip primitive (300ms hover delay) that plays well with
 * Radix asChild triggers (Popover.Trigger / DropdownMenu.Trigger / …).
 *
 * Behaviour
 *  - Wraps a single React element child
 *  - Forwards ref onto the *inner* child (not the wrapping span) so
 *    asChild trigger props (ref + click handlers) reach the real
 *    button instead of being trapped on our wrapper
 *  - Merges our hover/focus handlers with any handlers the child OR
 *    the parent (e.g. Popover.Trigger) already has — neither side
 *    loses its event
 *  - Injects aria-describedby for screen-reader support
 *
 *   <Tooltip label="Sync repositories">
 *     <button>Sync</button>
 *   </Tooltip>
 *
 *   // Works inside a Radix trigger:
 *   <Popover.Trigger asChild>
 *     <Tooltip label="More actions">
 *       <button><MoreHorizontal /></button>
 *     </Tooltip>
 *   </Popover.Trigger>
 */
import { cloneElement, Children, useId, useRef, useState, useCallback, forwardRef } from 'react'
import { useComposedRefs } from '@radix-ui/react-compose-refs'

function chain(...fns) {
  return (event) => {
    for (const fn of fns) fn?.(event)
  }
}

export const Tooltip = forwardRef(function Tooltip(
  { label, children, delay = 300, ...triggerProps },
  forwardedRef,
) {
  const [visible, setVisible] = useState(false)
  const timer = useRef(null)
  const id = useId()

  const child = Children.only(children)
  // Compose: any forwarded ref (e.g. Popover.Trigger asChild) +
  // the child's own ref. The merged ref lands on the inner element
  // (button/anchor), not on our wrapping span.
  const composedRef = useComposedRefs(forwardedRef, child.ref)

  const show = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setVisible(true), delay)
  }, [delay])

  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setVisible(false)
  }, [])

  return (
    <span className="relative inline-flex">
      {cloneElement(child, {
        // Forward all other trigger props first (data-state, aria-expanded,
        // anything else Radix sends), THEN our own props so ours win on the
        // attributes we care about (aria-describedby, ref).
        ...triggerProps,
        ref: composedRef,
        'aria-describedby': visible && label ? id : (triggerProps['aria-describedby'] ?? child.props['aria-describedby']),
        // Mirror the label into aria-label when the trigger has no name of its own,
        // so icon-only buttons stay labelled for screen readers (and on touch,
        // where there's no hover) — never override an explicit label.
        'aria-label': child.props['aria-label'] ?? triggerProps['aria-label'] ??
          (!child.props['aria-labelledby'] && typeof label === 'string' ? label : undefined),
        onMouseEnter: chain(show, child.props.onMouseEnter, triggerProps.onMouseEnter),
        onMouseLeave: chain(hide, child.props.onMouseLeave, triggerProps.onMouseLeave),
        onFocus:      chain(show, child.props.onFocus,      triggerProps.onFocus),
        onBlur:       chain(hide, child.props.onBlur,       triggerProps.onBlur),
        // Touch has no hover — reveal the tooltip on touch-start so the label is
        // discoverable; it hides again on the trigger's blur / next interaction.
        onTouchStart:   chain(show, child.props.onTouchStart, triggerProps.onTouchStart),
        onClick:        chain(child.props.onClick,        triggerProps.onClick),
        onPointerDown:  chain(child.props.onPointerDown,  triggerProps.onPointerDown),
      })}
      {label && visible && (
        <span
          id={id}
          role="tooltip"
          className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[12px] text-white bg-[color:var(--ds-surface-dark)] rounded-[var(--ds-radius-sm)] whitespace-nowrap pointer-events-none z-[var(--ds-z-popover)]"
        >
          {label}
          <span
            aria-hidden="true"
            className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-l-transparent border-r-4 border-r-transparent border-t-4 border-t-[color:var(--ds-surface-dark)]"
          />
        </span>
      )}
    </span>
  )
})
