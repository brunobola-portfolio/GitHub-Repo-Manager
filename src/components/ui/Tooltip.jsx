/**
 * Delayed tooltip primitive (300ms hover delay) that plays well with
 * Radix asChild triggers (Popover.Trigger / DropdownMenu.Trigger / …).
 *
 * CONVENTION: interactive controls (buttons, toggles, icon buttons,
 * actionable links) use this <Tooltip>; only static / truncated text may
 * keep a native `title`. Native title= is unstyled, ignores dark mode, has
 * an OS-dependent delay and never fires on touch — so anything the user
 * clicks or focuses should be wrapped here instead.
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
 *  - Renders the label through a React **portal** to <body> and computes
 *    its position from the trigger's getBoundingClientRect with a
 *    top→bottom **flip** when there isn't room above (and horizontal
 *    clamping to the viewport), so it never clips at the viewport edge —
 *    e.g. the Header theme toggle in the sticky top bar.
 *  - On **touch** the label reveals on tap and auto-dismisses (timeout +
 *    outside-pointer), so it can't stick on screen.
 *  - Animates in with Framer Motion, honouring prefers-reduced-motion.
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
import {
  cloneElement,
  Children,
  useId,
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  forwardRef,
} from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useComposedRefs } from '@radix-ui/react-compose-refs'

// Local prefers-reduced-motion detection. Kept independent of framer-motion's
// useReducedMotion so this widely-used primitive doesn't break in the many
// test suites that partially mock framer-motion (motion only, no hooks).
function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)'
  const read = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  const [reduce, setReduce] = useState(read)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(query)
    const onChange = () => setReduce(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduce
}

const GAP = 6 // distance between trigger and tooltip
const PAD = 8 // min distance from the viewport edge
const ARROW = 5 // half the arrow width, for clamping it inside the bubble
const TOUCH_AUTO_HIDE = 1600 // ms before a tap-revealed tooltip dismisses itself

// Flip-aware placement: prefer above the trigger, drop below when there
// isn't room, and clamp horizontally so the bubble never leaves the
// viewport. All coordinates are viewport-relative (the bubble is
// position:fixed), matching how ContextMenu positions its portal.
function computePosition(triggerEl, tipEl) {
  const t = triggerEl.getBoundingClientRect()
  const tip = tipEl.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  let placement = 'top'
  let top = t.top - tip.height - GAP
  if (top < PAD) {
    const below = t.bottom + GAP
    // Flip below only if there's genuinely more room there; otherwise keep
    // it above but clamped into view.
    if (below + tip.height <= vh - PAD || t.top - tip.height < below) {
      placement = 'bottom'
      top = below
    } else {
      top = Math.max(PAD, top)
    }
  }

  const centerX = t.left + t.width / 2
  let left = centerX - tip.width / 2
  left = Math.max(PAD, Math.min(left, vw - tip.width - PAD))
  const arrowLeft = Math.max(ARROW + 2, Math.min(centerX - left, tip.width - ARROW - 2))

  return { top, left, placement, arrowLeft }
}

export const Tooltip = forwardRef(function Tooltip(
  { label, children, delay = 300, ...triggerProps },
  forwardedRef,
) {
  const [visible, setVisible] = useState(false)
  const [pendingShow, setPendingShow] = useState(false) // hover/focus intent
  const [coords, setCoords] = useState(null)
  const triggerRef = useRef(null)
  const tipRef = useRef(null)
  const id = useId()
  const reduceMotion = usePrefersReducedMotion()

  const child = Children.only(children)
  // Compose: any forwarded ref (e.g. Popover.Trigger asChild) + the child's
  // own ref + our triggerRef (used to measure the trigger for positioning).
  // The merged ref lands on the inner element (button/anchor), not our wrapper.
  const composedRef = useComposedRefs(forwardedRef, child.ref, triggerRef)

  // Hover/focus intent → reveal after the delay; cleared instantly on leave.
  // The timer lives in the effect (not a ref) so render-path code never reads
  // a ref's value.
  useEffect(() => {
    if (!pendingShow) return undefined
    const t = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(t)
  }, [pendingShow, delay])

  // A non-hover reveal (touch) auto-dismisses so a tap-revealed label can't
  // stick; hover keeps it open (pendingShow stays true) and is unaffected.
  useEffect(() => {
    if (!visible || pendingShow) return undefined
    const t = setTimeout(() => setVisible(false), TOUCH_AUTO_HIDE)
    return () => clearTimeout(t)
  }, [visible, pendingShow])

  // Measure + place once the bubble is in the DOM, before paint (no flash).
  useLayoutEffect(() => {
    if (!visible || !label) return
    if (triggerRef.current && tipRef.current) {
      setCoords(computePosition(triggerRef.current, tipRef.current))
    }
  }, [visible, label])

  // While visible: keep position correct on scroll/resize, and dismiss on an
  // outside pointer (covers the touch "stuck label" case).
  useEffect(() => {
    if (!visible) return undefined
    const reposition = () => {
      if (triggerRef.current && tipRef.current) {
        setCoords(computePosition(triggerRef.current, tipRef.current))
      }
    }
    const onOutsidePointer = (e) => {
      if (!triggerRef.current?.contains(e.target)) {
        setPendingShow(false)
        setVisible(false)
      }
    }
    // WCAG 1.4.13 (Content on Hover or Focus): a visible tooltip must be
    // dismissable without moving the pointer or focus. Escape hides it while
    // the trigger keeps focus — we clear pendingShow too so the still-active
    // hover/focus intent can't immediately re-reveal it. We don't
    // preventDefault/stopPropagation so a parent (e.g. a modal) can still act
    // on the same Escape.
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setPendingShow(false)
        setVisible(false)
      }
    }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    document.addEventListener('pointerdown', onOutsidePointer, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      document.removeEventListener('pointerdown', onOutsidePointer, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [visible])

  const placeBelow = coords?.placement === 'bottom'

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
        // Handlers only flip state (no ref reads), so nothing touches a ref's
        // value during render.
        onMouseEnter: (e) => { setPendingShow(true); child.props.onMouseEnter?.(e); triggerProps.onMouseEnter?.(e) },
        onMouseLeave: (e) => { setPendingShow(false); setVisible(false); child.props.onMouseLeave?.(e); triggerProps.onMouseLeave?.(e) },
        onFocus:      (e) => { setPendingShow(true); child.props.onFocus?.(e); triggerProps.onFocus?.(e) },
        onBlur:       (e) => { setPendingShow(false); setVisible(false); child.props.onBlur?.(e); triggerProps.onBlur?.(e) },
        // Touch has no hover — reveal immediately on tap; the auto-hide effect
        // and outside-pointer dismissal keep it from sticking.
        onTouchStart: (e) => { setVisible(true); child.props.onTouchStart?.(e); triggerProps.onTouchStart?.(e) },
        onClick:      (e) => { child.props.onClick?.(e); triggerProps.onClick?.(e) },
        onPointerDown:(e) => { child.props.onPointerDown?.(e); triggerProps.onPointerDown?.(e) },
      })}
      {label && visible && createPortal(
        <motion.span
          ref={tipRef}
          id={id}
          role="tooltip"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: placeBelow ? -2 : 2 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          style={{
            position: 'fixed',
            top: coords ? coords.top : 0,
            left: coords ? coords.left : -9999,
            visibility: coords ? 'visible' : 'hidden',
          }}
          className="px-2 py-0.5 text-[12px] text-white bg-[color:var(--ds-surface-dark)] rounded-[var(--ds-radius-sm)] whitespace-nowrap pointer-events-none shadow-[var(--ds-shadow-overlay)] z-[var(--ds-z-ceiling)]"
        >
          {label}
          <span
            aria-hidden="true"
            style={{ left: coords ? coords.arrowLeft : '50%' }}
            className={`absolute -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-l-transparent border-r-transparent ${
              placeBelow
                ? 'bottom-full border-b-4 border-b-[color:var(--ds-surface-dark)]'
                : 'top-full border-t-4 border-t-[color:var(--ds-surface-dark)]'
            }`}
          />
        </motion.span>,
        document.body,
      )}
    </span>
  )
})
