import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { useToast } from '@/hooks/useToast'
import { ToastProvider } from '@/contexts/ToastProvider'

const wrapper = ({ children }) => React.createElement(ToastProvider, null, children)

describe('useToast', () => {
  let dateSpy

  beforeEach(() => {
    // Mock Date.now() to control toast IDs
    dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1000000)
  })

  afterEach(() => {
    dateSpy.mockRestore()
  })

  it('initializes with empty toasts array', () => {
    const { result } = renderHook(() => useToast(), { wrapper })

    expect(result.current.toasts).toEqual([])
  })

  it('adds success toast', () => {
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast.success('Operation successful')
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0]).toMatchObject({
      type: 'success',
      message: 'Operation successful',
      duration: 5000
    })
    expect(result.current.toasts[0].id).toBeDefined()
  })

  it('adds error toast', () => {
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast.error('Something went wrong')
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0]).toMatchObject({
      type: 'error',
      message: 'Something went wrong',
      duration: 5000
    })
  })

  it('adds info toast', () => {
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast.info('Information message')
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0]).toMatchObject({
      type: 'info',
      message: 'Information message',
      duration: 5000
    })
  })

  it('adds warning toast', () => {
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast.warning('Warning message')
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0]).toMatchObject({
      type: 'warning',
      message: 'Warning message',
      duration: 5000
    })
  })

  it('adds toast with custom duration', () => {
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast.success('Quick message', 2000)
    })

    expect(result.current.toasts[0].duration).toBe(2000)
  })

  it('adds multiple toasts', () => {
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast.success('First toast')
    })

    act(() => {
      result.current.toast.error('Second toast')
    })

    act(() => {
      result.current.toast.info('Third toast')
    })

    expect(result.current.toasts).toHaveLength(3)
    expect(result.current.toasts[0].type).toBe('success')
    expect(result.current.toasts[1].type).toBe('error')
    expect(result.current.toasts[2].type).toBe('info')
  })

  it('dismisses toast by ID', () => {
    const { result } = renderHook(() => useToast(), { wrapper })

    let toastId

    act(() => {
      toastId = result.current.toast.success('Toast to dismiss')
    })

    expect(result.current.toasts).toHaveLength(1)

    act(() => {
      result.current.dismissToast(toastId)
    })

    expect(result.current.toasts).toHaveLength(0)
  })

  it('dismisses specific toast among multiple', () => {
    const { result } = renderHook(() => useToast(), { wrapper })

    let firstId, secondId, thirdId

    act(() => {
      firstId = result.current.toast.success('First')
      secondId = result.current.toast.error('Second')
      thirdId = result.current.toast.info('Third')
    })

    expect(result.current.toasts).toHaveLength(3)

    act(() => {
      result.current.dismissToast(secondId)
    })

    expect(result.current.toasts).toHaveLength(2)
    expect(result.current.toasts.find(t => t.id === firstId)).toBeDefined()
    expect(result.current.toasts.find(t => t.id === thirdId)).toBeDefined()
    expect(result.current.toasts.find(t => t.id === secondId)).toBeUndefined()
  })

  it('generates unique IDs for each toast', () => {
    const { result } = renderHook(() => useToast(), { wrapper })

    const ids = []

    act(() => {
      ids.push(result.current.toast.success('Toast 1'))
      ids.push(result.current.toast.success('Toast 2'))
      ids.push(result.current.toast.success('Toast 3'))
    })

    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(3)
  })

  it('handles dismissing non-existent toast gracefully', () => {
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast.success('Test toast')
    })

    expect(result.current.toasts).toHaveLength(1)

    act(() => {
      result.current.dismissToast('non-existent-id')
    })

    expect(result.current.toasts).toHaveLength(1)
  })

  it('returns toast ID when adding toast', () => {
    const { result } = renderHook(() => useToast(), { wrapper })

    let toastId

    act(() => {
      toastId = result.current.toast.success('Test')
    })

    expect(typeof toastId).toBe('number')
    expect(result.current.toasts[0].id).toBe(toastId)
  })
})

describe('useToast — dedupe', () => {
    it('skips duplicate string-message toasts of the same type', () => {
        const { result } = renderHook(() => useToast(), { wrapper })

        act(() => { result.current.toast.warning('Session expired') })
        act(() => { result.current.toast.warning('Session expired') })
        act(() => { result.current.toast.warning('Session expired') })

        expect(result.current.toasts).toHaveLength(1)
    })

    it('does not dedupe across types', () => {
        const { result } = renderHook(() => useToast(), { wrapper })

        act(() => { result.current.toast.warning('Same text') })
        act(() => { result.current.toast.error('Same text') })

        expect(result.current.toasts).toHaveLength(2)
    })

    it('dedupe returns null for the rejected toast', () => {
        const { result } = renderHook(() => useToast(), { wrapper })
        let firstId, secondId
        act(() => { firstId = result.current.toast.success('Hello') })
        act(() => { secondId = result.current.toast.success('Hello') })

        expect(typeof firstId).toBe('number')
        expect(secondId).toBeNull()
    })
})

describe('useToast — custom content', () => {
    it('toast.custom stores a ReactNode content and skips message', () => {
        const { result } = renderHook(() => useToast(), { wrapper })
        const node = { type: 'div', props: { children: 'hi' } } // shape-only stand-in
        act(() => {
            result.current.toast.custom({ type: 'warning', content: node, duration: 0 })
        })
        expect(result.current.toasts).toHaveLength(1)
        expect(result.current.toasts[0]).toMatchObject({
            type: 'warning',
            content: node,
            duration: 0,
        })
        // No message key from the custom path
        expect(result.current.toasts[0].message).toBeUndefined()
    })

    it('toast.custom with duration 0 does not auto-dismiss', () => {
        vi.useFakeTimers()
        const { result } = renderHook(() => useToast(), { wrapper })
        act(() => {
            result.current.toast.custom({ type: 'warning', content: 'x', duration: 0 })
        })
        act(() => { vi.advanceTimersByTime(60_000) })
        expect(result.current.toasts).toHaveLength(1)
        vi.useRealTimers()
    })
})
