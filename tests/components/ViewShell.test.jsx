/*
 * Unit tests for ViewShell — the shared route-view boundary extracted from
 * App.jsx's <main> switch. It wraps each lazy view in the same fade-in div +
 * per-view ErrorBoundary (ViewErrorFallback) + Suspense, so the 9 near-identical
 * wrappers in App collapse to one. These lock the behaviour that wrapper carries:
 * it renders children, applies the fade class, and on a child render error shows
 * the named ViewErrorFallback wired to onGoHome.
 *
 * ErrorBoundary + ViewErrorFallback are the REAL components (the boundary catch
 * is the behaviour under test); only the noisy React error log is silenced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const { ViewShell } = await import('@/components/ui/ViewShell')

function Boom() {
    throw new Error('kaboom')
}

let errorSpy
beforeEach(() => {
    vi.clearAllMocks()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
    errorSpy?.mockRestore()
    cleanup()
})

describe('ViewShell', () => {
    it('renders its children when there is no error', () => {
        render(<ViewShell name="Dashboard"><div>view body</div></ViewShell>)
        expect(screen.getByText('view body')).toBeInTheDocument()
        expect(screen.queryByText(/something went wrong/i)).toBeNull()
    })

    it('applies the default fade class to the wrapper', () => {
        const { container } = render(<ViewShell name="Dashboard"><div>x</div></ViewShell>)
        expect(container.firstChild).toHaveClass('animate-in', 'fade-in', 'duration-500')
    })

    it('applies a custom fade class when provided', () => {
        const { container } = render(
            <ViewShell name="PR Review" fadeClass="animate-in fade-in duration-300"><div>x</div></ViewShell>
        )
        expect(container.firstChild).toHaveClass('duration-300')
        expect(container.firstChild).not.toHaveClass('duration-500')
    })

    it('catches a child render error and shows the named ViewErrorFallback', () => {
        render(<ViewShell name="Repository Detail"><Boom /></ViewShell>)
        expect(screen.getByText(/something went wrong in repository detail/i)).toBeInTheDocument()
    })

    it('wires onGoHome to the fallback Go-to-Dashboard action', () => {
        const onGoHome = vi.fn()
        render(<ViewShell name="Teams" onGoHome={onGoHome}><Boom /></ViewShell>)
        fireEvent.click(screen.getByRole('button', { name: /go to dashboard/i }))
        expect(onGoHome).toHaveBeenCalledTimes(1)
    })
})
