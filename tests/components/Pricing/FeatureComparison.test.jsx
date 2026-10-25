import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { FeatureComparison } from '@/components/Pricing/FeatureComparison.jsx'

const panel = () => screen.getByRole('tabpanel')

describe('FeatureComparison — plans compared by what changes, not a table', () => {
    it('lists what every plan has once, outside the plan view, with no table', () => {
        render(<FeatureComparison />)
        expect(screen.queryByRole('table')).not.toBeInTheDocument()
        const every = screen.getByRole('heading', { name: /on every plan/i }).closest('section')
        expect(within(every).getByText(/Community Health Dashboard/)).toBeInTheDocument()
        // A row identical on every plan never appears in the per-plan view.
        expect(within(panel()).queryByText(/Community Health Dashboard/)).not.toBeInTheDocument()
    })

    it('opens on Pro: real differences as rows, lifted caps grouped with the Free limit', () => {
        render(<FeatureComparison />)
        expect(screen.getByRole('tab', { name: /pro/i })).toHaveAttribute('aria-selected', 'true')
        const p = panel()
        expect(within(p).getByText('10,000')).toBeInTheDocument()
        expect(within(p).getByText('Free: 1,000')).toBeInTheDocument()
        const lifted = within(p).getByRole('heading', { name: 'Unlimited on Pro' }).parentElement
        expect(within(lifted).getByText('Semantic Search')).toBeInTheDocument()
        expect(within(lifted).getByText('Free: 375 / month')).toBeInTheDocument()
    })

    it('names what Pro lacks in one line and offers the plan that has it', () => {
        render(<FeatureComparison />)
        expect(within(panel()).getByText(/Not on Pro: .*Audit Logs/)).toBeInTheDocument()
        fireEvent.click(within(panel()).getByRole('button', { name: 'See Enterprise' }))
        expect(screen.getByRole('tab', { name: /enterprise/i })).toHaveAttribute('aria-selected', 'true')
        expect(within(panel()).getByRole('heading', { name: 'What Enterprise adds' })).toBeInTheDocument()
    })

    it('on Free, the caps say once that each is unlimited on Pro', () => {
        render(<FeatureComparison />)
        fireEvent.click(screen.getByRole('tab', { name: /free/i }))
        const p = panel()
        expect(within(p).getByRole('heading', { name: 'Limits on Free' })).toBeInTheDocument()
        expect(within(p).getByText('Each one is unlimited on Pro.')).toBeInTheDocument()
        expect(within(p).getByText('375 / month')).toBeInTheDocument()
    })

    it('search narrows both lists, and an empty result offers to clear it', () => {
        render(<FeatureComparison />)
        const search = screen.getByRole('searchbox', { name: /find a feature/i })
        fireEvent.change(search, { target: { value: 'semantic' } })
        expect(within(panel()).getByText('Semantic Search')).toBeInTheDocument()
        expect(screen.queryByRole('heading', { name: /on every plan/i })).not.toBeInTheDocument()

        fireEvent.change(search, { target: { value: 'nothing like this' } })
        expect(screen.getByText(/No feature matches/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Clear the search' }))
        expect(screen.getByRole('heading', { name: /on every plan/i })).toBeInTheDocument()
    })
})
