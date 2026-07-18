import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useBlockingDialogPresence } from '../../src/hooks/useBlockingDialogPresence'

function mountDialog(attrs = { role: 'dialog', 'aria-modal': 'true' }) {
    const el = document.createElement('div')
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v))
    document.body.appendChild(el)
    return el
}

afterEach(() => {
    document.body.querySelectorAll('[role="dialog"], [aria-modal]').forEach((el) => el.remove())
})

describe('useBlockingDialogPresence', () => {
    it('is false when no dialog is mounted', () => {
        const { result } = renderHook(() => useBlockingDialogPresence())
        expect(result.current).toBe(false)
    })

    it('becomes true when a blocking dialog mounts and false when it unmounts', async () => {
        const { result } = renderHook(() => useBlockingDialogPresence())
        let dialog
        act(() => { dialog = mountDialog() })
        await waitFor(() => expect(result.current).toBe(true))
        act(() => { dialog.remove() })
        await waitFor(() => expect(result.current).toBe(false))
    })

    it('ignores an explicitly non-modal dialog (aria-modal="false")', async () => {
        const { result } = renderHook(() => useBlockingDialogPresence())
        act(() => { mountDialog({ role: 'dialog', 'aria-modal': 'false' }) })
        // give the observer a tick; it should stay false
        await new Promise((r) => setTimeout(r, 30))
        expect(result.current).toBe(false)
    })

    it('detects an aria-modal="true" element without role=dialog', async () => {
        const { result } = renderHook(() => useBlockingDialogPresence())
        act(() => { mountDialog({ 'aria-modal': 'true' }) })
        await waitFor(() => expect(result.current).toBe(true))
    })
})
