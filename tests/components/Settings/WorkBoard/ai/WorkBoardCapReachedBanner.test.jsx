import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WorkBoardCapReachedBanner } from '../../../../../src/components/Settings/WorkBoard/ai/WorkBoardCapReachedBanner'

describe('WorkBoardCapReachedBanner', () => {
    it('renders the headline and Blocked badge', () => {
        render(<WorkBoardCapReachedBanner />)
        expect(screen.getByText(/AI monthly cap reached/i)).toBeInTheDocument()
        expect(screen.getByText(/Blocked/i)).toBeInTheDocument()
    })

    it('formats spent and cap as USD when both are provided', () => {
        render(<WorkBoardCapReachedBanner spentCents={250} capCents={1000} />)
        // 250 cents → $2.50, 1000 cents → $10.00
        expect(screen.getByText(/\$2\.50/)).toBeInTheDocument()
        expect(screen.getByText(/\$10\.00/)).toBeInTheDocument()
        expect(screen.getByText(/Spent this month/i)).toBeInTheDocument()
    })

    it('omits the spend bar when spend or cap is missing', () => {
        render(<WorkBoardCapReachedBanner />)
        expect(screen.queryByText(/Spent this month/i)).not.toBeInTheDocument()
    })

    it('exposes role="alert"', () => {
        render(<WorkBoardCapReachedBanner />)
        expect(screen.getByRole('alert')).toBeInTheDocument()
    })
})
