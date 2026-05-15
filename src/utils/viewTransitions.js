export async function startTransition(cb) {
  if (typeof document === 'undefined') return cb()
  if (typeof document.startViewTransition === 'function') {
    const t = document.startViewTransition(() => cb())
    await t.finished
    return
  }
  return cb()
}
