/**
 * Wraps a state-mutation callback in the View Transitions API for a
 * cross-fade between renders. Gracefully no-ops in browsers without
 * support (Firefox, Safari pre-18).
 *
 * NOTE: name collision with React's own `startTransition`. Import as
 * `import { startTransition as startViewTransition } from '.../viewTransitions'`
 * if you need both in the same file.
 *
 * Example:
 *   await startTransition(() => setActiveView('repos'))
 */
export async function startTransition(cb) {
  if (typeof document === 'undefined') return cb()
  if (typeof document.startViewTransition === 'function') {
    const t = document.startViewTransition(() => cb())
    // `ready` rejects with AbortError "Transition was skipped" when a newer
    // transition interrupts this one (rapid navigation / the double nav on
    // initial load). That's expected, not a failure — handle it so it never
    // surfaces as an "Uncaught (in promise)" rejection.
    t.ready?.catch(() => {})
    try {
      await t.finished
    } catch (err) {
      // `finished` only rejects if the update callback throws; let genuine
      // errors propagate, but swallow the abort noise from a skipped transition.
      if (err?.name !== 'AbortError') throw err
    }
    return
  }
  return cb()
}
