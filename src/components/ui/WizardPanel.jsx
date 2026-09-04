import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion, useDragControls, useMotionValue } from 'framer-motion'
import { Maximize2, Minimize2, GripHorizontal } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { useMobileKeyboardFix } from '../../hooks/useMobileKeyboardFix'
import { CloseButton } from './CloseButton'
import { VARIANT_ICON_STYLES, WIZARD_BACKDROP_CLASS } from './_variants'
import { clampPanelSize } from './wizardPanelGeometry'
import { SPRING } from './motion'

const PANEL_SIZES = {
  sm: 'w-[min(92vw,520px)]',
  md: 'w-[min(92vw,680px)]',
  lg: 'w-[min(92vw,900px)]',
  xl: 'w-[min(92vw,1140px)]',
}

// headerGradient prop kept for backward-compat; default header is now solid indigo
export function WizardPanel({
  isOpen,
  onClose,
  title,
  icon: Icon,
  stepInfo,
  sidebar,
  footer,
  children,
  disableEscape = false,
  isMaximized = true,
  isMobile = false,
  onToggleMaximize,

  headerGradient: _headerGradient = '',
  size = 'xl',
  variant = 'default',
}) {
  const panelRef = useFocusTrap(isOpen, onClose, { disableEscape })
  useMobileKeyboardFix(isOpen, panelRef)
  useBodyScrollLock(isOpen)
  const reduced = useReducedMotion()

  const effectiveMaximized = isMobile || isMaximized
  const iconTileClass = VARIANT_ICON_STYLES[variant] || VARIANT_ICON_STYLES.default

  // Drag + resize are desktop-floating affordances only. When maximized (or on
  // mobile, which is always maximized) the panel is edge-to-edge and neither
  // gesture makes sense, so they're fully disabled there. `active` is the one
  // state where they live — floating AND open.
  const floating = !effectiveMaximized
  const active = floating && isOpen

  // Position is owned by framer's drag (x/y motion values); size is local state
  // that overrides the Tailwind width/height once the user resizes. Both reset
  // whenever the panel maximizes or closes so every open starts centered.
  const dragControls = useDragControls()
  const constraintsRef = useRef(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const resizeState = useRef(null)
  const [dimensions, setDimensions] = useState(null)

  // Reset the resized size when leaving the floating/open state — done during
  // render via the "store previous prop" pattern rather than an effect, so it
  // doesn't trigger a cascading setState-in-effect render.
  const [prevActive, setPrevActive] = useState(active)
  if (active !== prevActive) {
    setPrevActive(active)
    if (!active && dimensions !== null) setDimensions(null)
  }

  // Zero the drag offset (framer motion values — an external store, the
  // legitimate use of an effect) whenever drag/resize isn't live.
  useEffect(() => {
    if (!active) {
      x.set(0)
      y.set(0)
    }
  }, [active, x, y])

  // Drag starts from the title bar only (so body clicks/selection still work),
  // and never from the header's control buttons.
  const startDrag = useCallback((event) => {
    if (!floating) return
    if (event.target.closest('button')) return
    dragControls.start(event)
  }, [floating, dragControls])

  // Corner resize. Pointer capture keeps move/up events flowing to the grip
  // even when the cursor outruns it. Horizontal growth is compensated against
  // the panel's centering (mx-auto) so the left edge stays put and the corner
  // tracks the cursor — a top-left-anchored resize.
  const onResizePointerDown = useCallback((event) => {
    if (!floating) return
    event.preventDefault()
    event.stopPropagation()
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    resizeState.current = {
      startX: event.clientX,
      startY: event.clientY,
      startW: rect.width,
      startH: rect.height,
      startXOffset: x.get(),
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [floating, panelRef, x])

  const onResizePointerMove = useCallback((event) => {
    const s = resizeState.current
    if (!s) return
    const next = clampPanelSize(
      s.startW + (event.clientX - s.startX),
      s.startH + (event.clientY - s.startY),
      window.innerWidth,
      window.innerHeight,
    )
    setDimensions(next)
    x.set(s.startXOffset + (next.width - s.startW) / 2)
  }, [x])

  const onResizePointerUp = useCallback((event) => {
    resizeState.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }, [])

  // Match Modal.jsx's spring timing exactly so the two shells animate in
  // sync when a flow opens a wizard from inside a modal (or vice-versa) —
  // both now share the vocabulary's SPRING.panel entry.
  // Reduced-motion users get a short fade so the entrance is calm but the
  // dialog still telegraphs the state change.
  const panelTransition = reduced
    ? { duration: 0.15 }
    : SPRING.panel
  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.18 }

  // Floating mode drives x/y via drag, so its entrance must not also animate y
  // (the two would fight over the same motion value). Maximized mode keeps the
  // original lift-in. Both respect reduced-motion.
  const panelInitial = reduced
    ? { opacity: 0 }
    : floating ? { opacity: 0, scale: 0.98 } : { opacity: 0, y: 24, scale: 0.98 }
  const panelAnimate = reduced
    ? { opacity: 1 }
    : floating ? { opacity: 1, scale: 1 } : { opacity: 1, y: 0, scale: 1 }
  const panelExit = reduced
    ? { opacity: 0 }
    : floating ? { opacity: 0, scale: 0.98 } : { opacity: 0, y: 24, scale: 0.98 }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="wizard-backdrop"
            data-testid="wizard-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: effectiveMaximized ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={backdropTransition}
            className={WIZARD_BACKDROP_CLASS}
            style={{ pointerEvents: effectiveMaximized ? 'none' : 'auto' }}
            aria-hidden="true"
          />

          {/* Drag boundary — keeps the floating panel from being dragged off
              screen. Always mounted while the wizard is open (NOT gated on
              `floating`) so framer's ref-constraint measurement never reads a
              null element: on a float→maximize toggle or a window/element resize,
              framer's ResizeObserver fires scalePositionWithinConstraints →
              resolveRefConstraints, and a null ref there throws "Cannot read
              properties of null (reading 'getBoundingClientRect')". It's
              pointer-events-none + invisible, so it stays inert when not floating. */}
          <div ref={constraintsRef} data-testid="wizard-drag-boundary" className="fixed inset-0 pointer-events-none z-[var(--ds-z-modal)]" aria-hidden="true" />

          {/* Panel */}
          <motion.div
            key="wizard-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wizard-panel-title"
            initial={panelInitial}
            animate={panelAnimate}
            exit={panelExit}
            transition={panelTransition}
            drag={floating}
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={constraintsRef}
            dragMomentum={false}
            dragElastic={0}
            style={floating
              ? { x, y, ...(dimensions ? { width: dimensions.width, height: dimensions.height } : null) }
              : undefined}
            className={`
              fixed z-[var(--ds-z-modal)] flex flex-col overflow-hidden
              ${effectiveMaximized
                ? 'inset-0 bg-white dark:bg-[color:var(--ds-surface-dark)]'
                : `inset-x-0 mx-auto top-[clamp(1.5rem,5vh,4rem)] ${dimensions ? '' : 'max-h-[min(90vh,calc(100vh-3rem))]'} ${PANEL_SIZES[size] || PANEL_SIZES.xl} rounded-2xl bg-white dark:bg-[color:var(--ds-surface-dark)] shadow-[var(--ds-shadow-lg)] ring-1 ring-slate-200/50 dark:ring-[color:var(--ds-border-dark)]`
              }
            `}
          >
            {/* Title Bar — neutral GitHub-utilitarian header; variant tone lives in the icon tile only.
                In floating mode it doubles as the drag handle. */}
            <div
              onPointerDown={startDrag}
              data-testid="wizard-titlebar"
              className={`flex-shrink-0 text-slate-900 dark:text-slate-100 flex items-center h-12 md:h-[52px] px-4 md:px-5 gap-3 border-b border-slate-200 dark:border-[color:var(--ds-border-dark)] ${floating ? 'cursor-grab active:cursor-grabbing select-none touch-none' : ''}`}
            >
              {/* Left: Icon + Title */}
              <div className="flex items-center gap-2.5 min-w-0">
                {Icon && (
                  <div className={`${iconTileClass} p-1.5 rounded-lg flex-shrink-0 transition-all`}>
                    <Icon className="w-4 h-4" strokeWidth={2.5} />
                  </div>
                )}
                <h2 id="wizard-panel-title" className="text-sm font-semibold tracking-tight ds-font-display truncate">
                  {title}
                </h2>
              </div>

              {/* Center: Step Info */}
              {stepInfo && (
                <div className="hidden md:flex flex-1 justify-center min-w-0">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={stepInfo.title}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2 }}
                      className="text-center"
                    >
                      <p className="text-[13px] font-medium text-slate-700 dark:text-slate-300 truncate">{stepInfo.title}</p>
                      {stepInfo.subtitle && (
                        <p className="ds-text-meta text-slate-500 dark:text-slate-400 truncate">{stepInfo.subtitle}</p>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              )}

              {/* Right: Controls */}
              <div className="flex items-center gap-0.5 ml-auto flex-shrink-0">
                {!isMobile && onToggleMaximize && (
                  <button
                    type="button"
                    onClick={onToggleMaximize}
                    className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    aria-label={isMaximized ? 'Restore wizard size' : 'Maximize wizard'}
                  >
                    {isMaximized
                      ? <Minimize2 className="w-3.5 h-3.5" strokeWidth={2} />
                      : <Maximize2 className="w-3.5 h-3.5" strokeWidth={2} />
                    }
                  </button>
                )}
                <CloseButton onClick={onClose} size="sm" aria-label="Close wizard" />
              </div>
            </div>

            {/* Body: Sidebar + Content */}
            <div className="flex flex-1 min-h-0 overflow-hidden bg-slate-50/50 dark:bg-[color:var(--ds-surface-dark)]">
              {/* Sidebar — desktop fullscreen only */}
              {sidebar && effectiveMaximized && !isMobile && (
                <motion.aside
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.08 }}
                  className="flex-shrink-0 w-60 bg-white dark:bg-[color:var(--ds-surface-subtle-dark)] border-r border-slate-200 dark:border-[color:var(--ds-border-dark)] overflow-hidden"
                >
                  <div className="h-full overflow-y-auto ds-scrollbar">
                    {sidebar}
                  </div>
                </motion.aside>
              )}

              {/* Main content area */}
              <div className="flex flex-1 flex-col min-w-0 min-h-0">
                {/* Content scrollable area */}
                <div className="flex-1 overflow-y-auto ds-scrollbar">
                  {children}
                </div>

                {/* Footer — height + horizontal padding intentionally match the
                    shared Modal primitive (min-h-[64px] md:min-h-[68px], px-4
                    md:px-5) so every popup family has the same footer rhythm. */}
                {footer && (
                  <div className="flex-shrink-0 flex items-center min-h-[64px] md:min-h-[68px] px-4 md:px-5 bg-white dark:bg-[color:var(--ds-surface-dark)] border-t border-slate-200 dark:border-[color:var(--ds-border-dark)] shadow-[var(--ds-shadow-overlay)] safe-area-bottom">
                    <div className="w-full">
                      {footer}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Resize grip — floating desktop mode only. Sits over the rounded
                corner; touch-none so it owns the pointer gesture outright. */}
            {floating && (
              <div
                role="button"
                tabIndex={-1}
                aria-label="Resize wizard"
                data-testid="wizard-resize-handle"
                onPointerDown={onResizePointerDown}
                onPointerMove={onResizePointerMove}
                onPointerUp={onResizePointerUp}
                className="absolute bottom-0 right-0 z-20 flex items-end justify-end w-6 h-6 p-0.5 cursor-nwse-resize touch-none text-slate-400/70 dark:text-slate-500/70 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <GripHorizontal className="w-3.5 h-3.5 rotate-45" strokeWidth={2.25} aria-hidden="true" />
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
