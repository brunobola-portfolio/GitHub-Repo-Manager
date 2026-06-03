/**
 * Shared Framer Motion vocabulary — the single source of truth for durations,
 * easing curves, springs, press feedback and entrance variants.
 *
 * Values mirror the CSS motion tokens in `design-system.css` (--ds-duration-*,
 * --ds-ease*) so JS-driven Framer motion and CSS transitions stay in lockstep.
 *
 * Reduced motion: Framer ignores the CSS `prefers-reduced-motion` override, but
 * the app root wraps everything in `<MotionConfig reducedMotion="user">`
 * (src/main.jsx). That disables transform/layout animations (while keeping
 * opacity) for users who ask for reduced motion — so the presets below are
 * reduced-motion-safe WITHOUT a per-call `useReducedMotion()` guard. Only reach
 * for `useReducedMotion()` when an animation does more than fade/move (e.g. a
 * long looping decorative gradient, or conditionally rendering an extra layer).
 *
 * Character: restrained & precise. No bounce/overshoot outside overlay surfaces
 * (modal/drawer/sheet) and toggle knobs — flat controls move via ease curves
 * only, matching the design-system's "no hover scale/translate" premium contract.
 */

// Durations in SECONDS (Framer's unit) — equal to design-system --ds-duration-*.
export const DURATION = {
  instant: 0.08, // --ds-duration-instant
  fast: 0.12, //    --ds-duration-fast
  standard: 0.2, //  --ds-duration (default for most micro-interactions)
  slow: 0.32, //    --ds-duration-slow
}

// Easing curves — the two the codebase already standardized on, named once.
export const EASE = {
  standard: [0.2, 0, 0, 1], //      --ds-ease — state changes / micro moves
  emphasized: [0.16, 1, 0.3, 1], // decelerated — entrances & reveals
}

// Springs — RESERVED for overlay surfaces (modal/drawer/sheet) and toggle knobs
// per the design-system contract; never for hover/press of flat controls.
// Consolidates the scattered stiffness/damping pairs (380/32, 280/28, 500/30).
export const SPRING = {
  panel: { type: 'spring', stiffness: 380, damping: 32 }, // modal / wizard panel
  drawer: { type: 'spring', stiffness: 280, damping: 28 }, // drawer slide-in
  knob: { type: 'spring', stiffness: 500, damping: 30 }, //   switch / toggle knob
}

// Ready-made transition objects (duration + ease).
export const TRANSITION = {
  instant: { duration: DURATION.instant, ease: EASE.standard },
  fast: { duration: DURATION.fast, ease: EASE.standard },
  standard: { duration: DURATION.standard, ease: EASE.standard },
  slow: { duration: DURATION.slow, ease: EASE.standard },
  entrance: { duration: DURATION.standard, ease: EASE.emphasized },
}

// Press feedback — ONE subtle value app-wide (3% shrink). MotionConfig disables
// the scale transform under reduced motion, so no guard is needed at call sites.
export const TAP = { scale: 0.97 }

// Stagger timings for lists/grids.
export const STAGGER = {
  fast: 0.03, //   dense rows (>50 items)
  normal: 0.05, // cards / small lists
}

// Canonical single-element entrance: fade + a short rise. Spread onto a
// `motion.*` element, or wrap in <AnimatePresence> to also get the exit.
export const fadeRise = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: TRANSITION.entrance },
  exit: { opacity: 0, y: 6, transition: TRANSITION.fast },
}

// List orchestration — a parent with `variants={listContainer}` staggers any
// children that use `variants={listItem}` (children inherit the run state, so
// they need no initial/animate of their own).
export const listContainer = {
  hidden: {},
  show: { transition: { staggerChildren: STAGGER.normal } },
}
export const listItem = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: TRANSITION.entrance },
}
