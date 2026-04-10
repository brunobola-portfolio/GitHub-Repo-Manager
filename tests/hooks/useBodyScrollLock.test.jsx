import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  useBodyScrollLock,
  __resetBodyScrollLockForTests,
} from '@/hooks/useBodyScrollLock'

describe('useBodyScrollLock', () => {
  beforeEach(() => {
    __resetBodyScrollLockForTests()
    document.body.style.overflow = ''
  })

  afterEach(() => {
    __resetBodyScrollLockForTests()
    document.body.style.overflow = ''
  })

  it('does nothing when isLocked=false', () => {
    document.body.style.overflow = 'scroll'
    renderHook(() => useBodyScrollLock(false))
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('locks body overflow when isLocked=true', () => {
    renderHook(() => useBodyScrollLock(true))
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('restores previous overflow on unmount', () => {
    document.body.style.overflow = 'scroll'
    const { unmount } = renderHook(() => useBodyScrollLock(true))
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('restores when isLocked flips to false', () => {
    document.body.style.overflow = 'auto'
    const { rerender } = renderHook(
      ({ locked }) => useBodyScrollLock(locked),
      { initialProps: { locked: true } }
    )
    expect(document.body.style.overflow).toBe('hidden')
    rerender({ locked: false })
    expect(document.body.style.overflow).toBe('auto')
  })

  it('restores to "hidden" when the body was already "hidden" before locking', () => {
    // Regression guard: cleanup must restore the PREVIOUS value, not blindly
    // reset to empty string. This is the bug the inline WizardPanel code has.
    document.body.style.overflow = 'hidden'
    const { unmount } = renderHook(() => useBodyScrollLock(true))
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('handles stacked locks: inner unmount does not release outer', () => {
    document.body.style.overflow = 'auto'
    const outer = renderHook(() => useBodyScrollLock(true))
    expect(document.body.style.overflow).toBe('hidden')

    const inner = renderHook(() => useBodyScrollLock(true))
    expect(document.body.style.overflow).toBe('hidden')

    inner.unmount()
    // Outer is still locked — body must stay hidden
    expect(document.body.style.overflow).toBe('hidden')

    outer.unmount()
    // Now all locks released — restore original
    expect(document.body.style.overflow).toBe('auto')
  })

  it('handles stacked locks: outer unmount leaves inner in charge', () => {
    // Unusual order — outer unmounts while inner still mounted.
    // Acceptable behavior: body stays hidden until the final unmount.
    document.body.style.overflow = 'scroll'
    const outer = renderHook(() => useBodyScrollLock(true))
    const inner = renderHook(() => useBodyScrollLock(true))
    expect(document.body.style.overflow).toBe('hidden')

    outer.unmount()
    expect(document.body.style.overflow).toBe('hidden')

    inner.unmount()
    expect(document.body.style.overflow).toBe('scroll')
  })
})
