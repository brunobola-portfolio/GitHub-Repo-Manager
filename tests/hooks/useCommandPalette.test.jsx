import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCommandPalette } from '@/hooks/useCommandPalette'

describe('useCommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('isOpen defaults to false', () => {
    const { result } = renderHook(() => useCommandPalette())
    expect(result.current.isOpen).toBe(false)
  })

  it('open() sets isOpen to true', () => {
    const { result } = renderHook(() => useCommandPalette())
    act(() => {
      result.current.open()
    })
    expect(result.current.isOpen).toBe(true)
  })

  it('close() sets isOpen to false after open()', () => {
    const { result } = renderHook(() => useCommandPalette())
    act(() => {
      result.current.open()
    })
    act(() => {
      result.current.close()
    })
    expect(result.current.isOpen).toBe(false)
  })

  it('toggle() flips isOpen from false to true', () => {
    const { result } = renderHook(() => useCommandPalette())
    act(() => {
      result.current.toggle()
    })
    expect(result.current.isOpen).toBe(true)
  })

  it('toggle() flips isOpen from true to false', () => {
    const { result } = renderHook(() => useCommandPalette())
    act(() => {
      result.current.open()
    })
    act(() => {
      result.current.toggle()
    })
    expect(result.current.isOpen).toBe(false)
  })

  it('Cmd+K (metaKey) keydown on window triggers toggle', () => {
    const { result } = renderHook(() => useCommandPalette())
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })
      )
    })
    expect(result.current.isOpen).toBe(true)
  })

  it('Ctrl+K keydown on window triggers toggle', () => {
    const { result } = renderHook(() => useCommandPalette())
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })
      )
    })
    expect(result.current.isOpen).toBe(true)
  })

  it('plain k keydown does NOT trigger toggle', () => {
    const { result } = renderHook(() => useCommandPalette())
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', bubbles: true })
      )
    })
    expect(result.current.isOpen).toBe(false)
  })

  it('Cmd+Shift+K does NOT trigger toggle (shift disqualifies)', () => {
    const { result } = renderHook(() => useCommandPalette())
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, shiftKey: true, bubbles: true })
      )
    })
    expect(result.current.isOpen).toBe(false)
  })

  it('listener removed on unmount (no further toggles)', () => {
    const { result, unmount } = renderHook(() => useCommandPalette())
    unmount()
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })
      )
    })
    // After unmount, isOpen should still be false (listener removed)
    expect(result.current.isOpen).toBe(false)
  })
})
