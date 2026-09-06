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
        expect(screen.queryByRole('button', { name: /reload the page/i })).toBeNull()
    })

    it('retries on click', () => {
        const onRetry = vi.fn()
        render(<ServerUnreachable onRetry={onRetry} />)
        fireEvent.click(screen.getByRole('button', { name: /retry now/i }))
        expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('backs off between automatic retries and stops when unmounted', () => {
        vi.useFakeTimers()
        const onRetry = vi.fn()
        const schedule = [100, 200, 400]
        const { unmount } = render(<ServerUnreachable onRetry={onRetry} backoffMs={schedule} />)
        act(() => { vi.advanceTimersByTime(100) })
        expect(onRetry).toHaveBeenCalledTimes(1)
        act(() => { vi.advanceTimersByTime(150) })
        expect(onRetry).toHaveBeenCalledTimes(1)
        act(() => { vi.advanceTimersByTime(50) })
        expect(onRetry).toHaveBeenCalledTimes(2)
        act(() => { vi.advanceTimersByTime(400) })
        expect(onRetry).toHaveBeenCalledTimes(3)
        expect(screen.getByRole('status')).toHaveTextContent(/3 so far/)
        unmount()
        act(() => { vi.advanceTimersByTime(5000) })
        expect(onRetry).toHaveBeenCalledTimes(3)
    })

    it('offers a full reload once the failures stop looking like a blip', () => {
        vi.useFakeTimers()
        render(<ServerUnreachable onRetry={() => {}} backoffMs={[10]} />)
        act(() => { vi.advanceTimersByTime(65) })
        expect(screen.getByRole('status')).toHaveTextContent(/6 attempts/)
        expect(screen.getByRole('button', { name: /reload the page/i })).toBeInTheDocument()
    })
})
