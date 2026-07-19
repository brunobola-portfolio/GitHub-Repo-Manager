import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PricingCard } from '@/components/Pricing/PricingCard.jsx'

const LONG_FEATURES = Array.from({ length: 12 }, (_, i) => ({
    label: `Feature ${i + 1}`,
    included: true,
}))

const SHORT_FEATURES = [
    { label: 'Everything in Free, unlimited', included: true },
    { label: 'AI queries / month', included: '10,000' },
    { label: 'Email support', included: true },
]

describe('PricingCard — feature-list balance (Show all N features toggle)', () => {
    it('collapses a long feature list to the threshold and offers a "Show all N features" toggle', () => {
        render(<PricingCard tier="Free" price={0} period="month" features={LONG_FEATURES} ctaAction={() => {}} />)

        // Only the first 9 (COLLAPSE_THRESHOLD) render initially.
        expect(screen.getByText('Feature 1')).toBeInTheDocument()
        expect(screen.getByText('Feature 9')).toBeInTheDocument()
        expect(screen.queryByText('Feature 10')).not.toBeInTheDocument()
        expect(screen.queryByText('Feature 12')).not.toBeInTheDocument()

        const toggle = screen.getByRole('button', { name: /show all 12 features/i })
        expect(toggle.tagName).toBe('BUTTON')
        expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })

    it('expands to reveal every remaining feature and flips aria-expanded when the toggle is activated', () => {
        render(<PricingCard tier="Free" price={0} period="month" features={LONG_FEATURES} ctaAction={() => {}} />)

        const toggle = screen.getByRole('button', { name: /show all 12 features/i })
        fireEvent.click(toggle)

        expect(screen.getByText('Feature 10')).toBeInTheDocument()
        expect(screen.getByText('Feature 12')).toBeInTheDocument()
        expect(toggle).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('button', { name: /show fewer features/i })).toBeInTheDocument()

        // Toggling back collapses again.
        fireEvent.click(toggle)
        expect(screen.queryByText('Feature 12')).not.toBeInTheDocument()
        expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })

    it('does not render a toggle for a short feature list (Pro/Enterprise stay as-is)', () => {
        render(<PricingCard tier="Pro" price={19} period="month" features={SHORT_FEATURES} ctaAction={() => {}} />)

        for (const { label } of SHORT_FEATURES) {
            expect(screen.getByText(label, { exact: false })).toBeInTheDocument()
        }
        expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument()
    })
})
