import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorState } from '../../../src/components/WorkBoard/shared/shared-ui'

describe('WorkBoard ErrorState — honest 401 vs generic', () => {
    it('renders an honest "session expired" state for a 401, with no generic Retry', () => {
        render(<ErrorState error={{ status: 401 }} what="reviews" onRetry={vi.fn()} />)
        expect(screen.getByText(/session has expired/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /refresh to sign in/i })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument()
    })

    it('renders a generic load failure with a working Retry for non-401 errors', () => {
        const onRetry = vi.fn()
        render(<ErrorState error={{ status: 500 }} what="reviews" onRetry={onRetry} />)
        expect(screen.getByText(/failed to load reviews/i)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /retry/i }))
        expect(onRetry).toHaveBeenCalledOnce()
    })

    it('omits the Retry button when no onRetry is provided', () => {
        render(<ErrorState error={{ status: 500 }} what="data" />)
        expect(screen.getByText(/failed to load data/i)).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    })
})
