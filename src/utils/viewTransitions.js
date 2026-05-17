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
    await t.finished
    return
  }
  return cb()
}
