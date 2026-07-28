/**
 * Approve / Comment / Request changes each post a real review to GitHub, and
 * none of them had a disabled state, a pending state or a spinner —
 * ReviewStatusBar did not even accept a `submitting` prop. Two taps posted two
 * reviews, and on mobile these are `max-md:flex-1` full-width, i.e. the primary
 * submission affordance on the smallest, tappiest surface.
 *
 * ReviewToolbar already gets this right with the same handler, so the fix is
 * parity rather than invention.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReviewStatusBar } from '../../../src/components/PRReview/ReviewToolbar/ReviewStatusBar.jsx'

const ACTIONS = [
    ['Approve', 'APPROVE'],
    ['Comment', 'COMMENT'],
    ['Request changes', 'REQUEST_CHANGES'],
]

const setup = (props = {}) => {
    const onSubmitReview = vi.fn()
    render(
        <ReviewStatusBar
            totalFiles={3}
            reviewedCount={3}
            pendingCommentCount={0}
            onSubmitReview={onSubmitReview}
            {...props}
        />
    )
    return onSubmitReview
}

describe('ReviewStatusBar — submitting a review', () => {
    it.each(ACTIONS)('%s still submits once', (label, event) => {
        const onSubmitReview = setup()
        fireEvent.click(screen.getByRole('button', { name: label }))
        expect(onSubmitReview).toHaveBeenCalledWith({ event })
    })

    it.each(ACTIONS)('%s cannot be double-submitted while in flight', (label) => {
        const onSubmitReview = setup({ submitting: true })
        fireEvent.click(screen.getByRole('button', { name: label }))
        expect(onSubmitReview).not.toHaveBeenCalled()
    })

    it.each(ACTIONS)('%s is visibly disabled while in flight', (label) => {
        setup({ submitting: true })
        expect(screen.getByRole('button', { name: label })).toBeDisabled()
    })

    it('a rapid double click posts one review, not two', () => {
        // The actual reported shape: the button is not disabled until the
        // parent re-renders, so both clicks land in the same tick.
        const onSubmitReview = setup()
        const button = screen.getByRole('button', { name: 'Approve' })
        fireEvent.click(button)
        fireEvent.click(button)
        expect(onSubmitReview).toHaveBeenCalledTimes(1)
    })

    it('re-enables once the submission settles', () => {
        const onSubmitReview = vi.fn()
        const { rerender } = render(
            <ReviewStatusBar totalFiles={3} reviewedCount={3} onSubmitReview={onSubmitReview} submitting />
        )
        expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()

        rerender(
            <ReviewStatusBar totalFiles={3} reviewedCount={3} onSubmitReview={onSubmitReview} submitting={false} />
        )
        fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
        expect(onSubmitReview).toHaveBeenCalledTimes(1)
    })

    it('tells assistive tech the action is running, not just greys it out', () => {
        setup({ submitting: true })
        expect(screen.getByRole('button', { name: 'Approve' })).toHaveAttribute('aria-busy', 'true')
    })
})
