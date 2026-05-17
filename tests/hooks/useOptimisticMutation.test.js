import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOptimisticMutation } from '../../src/hooks/useOptimisticMutation'

describe('useOptimisticMutation', () => {
  it('applies optimistic update immediately and commits on success', async () => {
    const apply = vi.fn()
    const revert = vi.fn()
    const fn = vi.fn().mockResolvedValue('ok')
    const onToast = vi.fn()

    const { result } = renderHook(() => useOptimisticMutation({ apply, revert, fn, onToast }))
    await act(async () => { await result.current.run() })

    expect(apply).toHaveBeenCalledOnce()
    expect(fn).toHaveBeenCalledOnce()
    expect(revert).not.toHaveBeenCalled()
    expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
  })

  it('passes payload to apply, fn, revert, and inverse', async () => {
    const payload = { itemId: 42, snapshot: [1, 2, 3] }
    const apply = vi.fn()
    const revert = vi.fn()
    const fn = vi.fn().mockResolvedValue('ok')
    const inverse = vi.fn().mockResolvedValue('ok')
    let toastArg
    const onToast = (t) => { toastArg = t }

    const { result } = renderHook(() => useOptimisticMutation({ apply, revert, fn, inverse, onToast }))
    await act(async () => { await result.current.run(payload) })

    expect(apply).toHaveBeenCalledWith(payload)
    expect(fn).toHaveBeenCalledWith(payload)

    // trigger undo — should call revert and inverse with same payload
    await act(async () => { await toastArg.undo() })
    expect(revert).toHaveBeenCalledWith(payload)
    expect(inverse).toHaveBeenCalledWith(payload)
  })

  it('rolls back when fn rejects', async () => {
    const apply = vi.fn()
    const revert = vi.fn()
    const fn = vi.fn().mockRejectedValue(new Error('boom'))
    const onToast = vi.fn()

    const { result } = renderHook(() => useOptimisticMutation({ apply, revert, fn, onToast }))
    await act(async () => { await result.current.run() })

    expect(revert).toHaveBeenCalledOnce()
    expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  })

  it('undo() calls the inverse mutation', async () => {
    const apply = vi.fn()
    const revert = vi.fn()
    const fn = vi.fn().mockResolvedValue('ok')
    const inverse = vi.fn().mockResolvedValue('ok')
    let toastArg
    const onToast = (t) => { toastArg = t }

    const { result } = renderHook(() => useOptimisticMutation({ apply, revert, fn, inverse, onToast }))
    await act(async () => { await result.current.run() })
    await act(async () => { await toastArg.undo() })

    expect(inverse).toHaveBeenCalledOnce()
    expect(revert).toHaveBeenCalledOnce()
  })

  it('uses custom successMessage when provided', async () => {
    const apply = vi.fn()
    const revert = vi.fn()
    const fn = vi.fn().mockResolvedValue('ok')
    const onToast = vi.fn()

    const { result } = renderHook(() =>
      useOptimisticMutation({ apply, revert, fn, onToast, successMessage: 'Archived' })
    )
    await act(async () => { await result.current.run() })

    expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', message: 'Archived' }))
  })

  it('surfaces apply() errors via onToast without calling fn', async () => {
    const apply = vi.fn().mockImplementation(() => { throw new Error('apply failed') })
    const revert = vi.fn()
    const fn = vi.fn()
    const onToast = vi.fn()

    const { result } = renderHook(() => useOptimisticMutation({ apply, revert, fn, onToast }))
    await act(async () => { await result.current.run() })

    expect(fn).not.toHaveBeenCalled()
    expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'apply failed' }))
  })
})
