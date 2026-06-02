import { describe, it, expect, vi, afterEach } from 'vitest'
import { startTransition } from '../../src/utils/viewTransitions'

afterEach(() => {
  delete globalThis.document.startViewTransition
})

describe('startTransition', () => {
  it('uses document.startViewTransition when supported', async () => {
    const cb = vi.fn()
    const finished = Promise.resolve()
    globalThis.document.startViewTransition = vi.fn(() => ({ finished, ready: finished, updateCallbackDone: finished }))
    await startTransition(cb)
    expect(globalThis.document.startViewTransition).toHaveBeenCalledOnce()
  })

  it('falls back to running the callback synchronously when unsupported', async () => {
    const cb = vi.fn()
    await startTransition(cb)
    expect(cb).toHaveBeenCalledOnce()
  })

  it('swallows the AbortError when a transition is skipped', async () => {
    const cb = vi.fn()
    const abort = Object.assign(new Error('Transition was skipped'), { name: 'AbortError' })
    const skipped = Promise.reject(abort)
    globalThis.document.startViewTransition = vi.fn(() => ({ finished: skipped, ready: skipped, updateCallbackDone: skipped }))
    await expect(startTransition(cb)).resolves.toBeUndefined()
  })

  it('re-throws genuine update-callback errors', async () => {
    const boom = new Error('boom')
    const failed = Promise.reject(boom)
    globalThis.document.startViewTransition = vi.fn(() => ({ finished: failed, ready: Promise.resolve(), updateCallbackDone: failed }))
    await expect(startTransition(() => {})).rejects.toThrow('boom')
  })
})
