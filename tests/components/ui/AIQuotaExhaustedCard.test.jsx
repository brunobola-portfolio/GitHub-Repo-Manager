import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AIQuotaExhaustedCard } from '../../../src/components/ui/AIQuotaExhaustedCard'

describe('AIQuotaExhaustedCard', () => {
    it('renders the headline, used/limit and reset countdown', () => {
        const future = new Date(Date.now() + 18 * 86_400_000).toISOString()
        render(
            <AIQuotaExhaustedCard
                feature="ai_queries"
                used={200}
                limit={200}
                resetAt={future}
                upgradeTo="pro"
                currentTier="free"
            />,
        )
        expect(screen.getByText(/ai insights paused/i)).toBeInTheDocument()
        expect(screen.getByText(/200 \/ 200/)).toBeInTheDocument()
        expect(screen.getByText(/resets in 18 days/i)).toBeInTheDocument()
    })

    it('renders Upgrade CTA for free tier and dispatches navigate-pricing', () => {
        const fn = vi.fn()
        window.addEventListener('app:navigate-pricing', fn)
        render(
            <AIQuotaExhaustedCard
                feature="ai_queries"
                used={200}
                limit={200}
                resetAt={null}
                upgradeTo="pro"
                currentTier="free"
            />,
        )
        const cta = screen.getByRole('button', { name: /upgrade to pro/i })
        fireEvent.click(cta)
        expect(fn).toHaveBeenCalledTimes(1)
        expect(fn.mock.calls[0][0].detail).toEqual({ focus: 'pro' })
        window.removeEventListener('app:navigate-pricing', fn)
    })

    it('omits Upgrade CTA when upgradeTo is null (pro/enterprise)', () => {
        render(
            <AIQuotaExhaustedCard
                feature="ai_queries"
                used={5000}
                limit={5000}
                resetAt={null}
                upgradeTo={null}
                currentTier="pro"
            />,
        )
        expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument()
    })

    it('exposes data-testid for e2e selectors', () => {
        render(<AIQuotaExhaustedCard feature="ai_queries" upgradeTo={null} />)
        expect(screen.getByTestId('ai-quota-exhausted')).toBeInTheDocument()
    })

    it('renders Manage usage link that opens Settings on the usage tab', () => {
        const fn = vi.fn()
        window.addEventListener('app:open-settings', fn)
        render(<AIQuotaExhaustedCard feature="ai_queries" upgradeTo="pro" currentTier="free" />)
        fireEvent.click(screen.getByRole('button', { name: /manage usage/i }))
        expect(fn).toHaveBeenCalled()
        expect(fn.mock.calls[0][0].detail).toEqual({ tab: 'usage' })
        window.removeEventListener('app:open-settings', fn)
    })

    it('shows Upgrade CTA for enterprise but omits the Pro-only benefits list', () => {
        render(
            <AIQuotaExhaustedCard
                feature="ai_queries"
                used={200}
                limit={200}
                resetAt={null}
                upgradeTo="enterprise"
                currentTier="free"
            />,
        )
        expect(screen.getByRole('button', { name: /upgrade to enterprise/i })).toBeInTheDocument()
        expect(screen.queryByText(/5,000 queries/i)).not.toBeInTheDocument()
    })
})
