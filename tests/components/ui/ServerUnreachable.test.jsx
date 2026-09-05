import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ServerUnreachable } from '@/components/ui/ServerUnreachable'

afterEach(() => {
    vi.useRealTimers()
})

describe('ServerUnreachable', () => {
    it('explains the situation without ever mentioning setup', () => {
        render(<ServerUnreachable onRetry={() => {}} />)
        expect(screen.getByRole('status')).toHaveTextContent(/can.t reach the server/i)
        expect(screen.getByRole('status')).toHaveTextContent(/restarting after an update/i)
        expect(screen.queryByText(/setup|initiali[sz]e|SQLite/i)).toBeNull()
    })

    it('retries on click', () => {
        const onRetry = vi.fn()
        render(<ServerUnreachable onRetry={onRetry} />)
        fireEvent.click(screen.getByRole('button', { name: /retry now/i }))
        expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('retries on its own on an interval and stops when unmounted', () => {
        vi.useFakeTimers()
        const onRetry = vi.fn()
        const { unmount } = render(<ServerUnreachable onRetry={onRetry} retryEveryMs={1000} />)
        act(() => { vi.advanceTimersByTime(2500) })
        expect(onRetry).toHaveBeenCalledTimes(2)
        expect(screen.getByRole('status')).toHaveTextContent(/2 so far/)
        unmount()
        act(() => { vi.advanceTimersByTime(5000) })
        expect(onRetry).toHaveBeenCalledTimes(2)
    })
})
