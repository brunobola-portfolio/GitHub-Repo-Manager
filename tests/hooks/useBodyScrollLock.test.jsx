import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'

describe('useBodyScrollLock', () => {
  afterEach(() => {
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
})
