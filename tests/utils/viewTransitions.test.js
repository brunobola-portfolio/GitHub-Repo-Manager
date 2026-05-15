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
})
