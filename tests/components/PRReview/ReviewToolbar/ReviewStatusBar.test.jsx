import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ReviewStatusBar } from '@/components/PRReview/ReviewToolbar/ReviewStatusBar'

afterEach(() => {
    cleanup()
    localStorage.clear()
})

describe('ReviewStatusBar', () => {
    it('renders the reviewed/total count', () => {
        render(<ReviewStatusBar totalFiles={10} reviewedCount={3} pendingCommentCount={0} />)
        expect(screen.getByText(/3\/10 reviewed/i)).toBeInTheDocument()
    })

    it('exposes a progress ring with valuenow / valuemax matching the counts', () => {
        const { container } = render(
            <ReviewStatusBar totalFiles={10} reviewedCount={3} pendingCommentCount={0} />,
        )
        const ring = container.querySelector('[data-testid="review-progress-ring"]')
        expect(ring).not.toBeNull()
        expect(ring.getAttribute('aria-valuenow')).toBe('3')
        expect(ring.getAttribute('aria-valuemax')).toBe('10')
    })

    it('shows pending comment count when > 0', () => {
        render(<ReviewStatusBar totalFiles={5} reviewedCount={1} pendingCommentCount={2} />)
        expect(screen.getByText(/2 pending/i)).toBeInTheDocument()
    })

    it('does not render submit buttons when onSubmitReview is not provided', () => {
        render(<ReviewStatusBar totalFiles={5} reviewedCount={5} pendingCommentCount={0} />)
        expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /request changes/i })).not.toBeInTheDocument()
    })

    it('renders Approve / Comment / Request changes when onSubmitReview is provided', () => {
        const onSubmit = vi.fn()
        render(
            <ReviewStatusBar totalFiles={5} reviewedCount={5} pendingCommentCount={0} onSubmitReview={onSubmit} />,
        )
        expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /^comment$/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /request changes/i })).toBeInTheDocument()
    })

    it('forwards Approve clicks to onSubmitReview with event=APPROVE', () => {
        const onSubmit = vi.fn()
        render(
            <ReviewStatusBar totalFiles={5} reviewedCount={5} pendingCommentCount={0} onSubmitReview={onSubmit} />,
        )
        fireEvent.click(screen.getByRole('button', { name: /approve/i }))
        expect(onSubmit).toHaveBeenCalledWith({ event: 'APPROVE' })
    })

    it('forwards Request changes clicks with event=REQUEST_CHANGES', () => {
        const onSubmit = vi.fn()
        render(
            <ReviewStatusBar totalFiles={5} reviewedCount={5} pendingCommentCount={0} onSubmitReview={onSubmit} />,
        )
        fireEvent.click(screen.getByRole('button', { name: /request changes/i }))
        expect(onSubmit).toHaveBeenCalledWith({ event: 'REQUEST_CHANGES' })
    })
})
