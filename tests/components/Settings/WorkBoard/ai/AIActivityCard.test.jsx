import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AIActivityCard } from '../../../../../src/components/Settings/WorkBoard/ai/AIActivityCard'

describe('AIActivityCard', () => {
    it('renders nothing when activity is null (disabled)', () => {
        const { container } = render(<AIActivityCard activity={null} />)
        expect(container.firstChild).toBeNull()
    })

    it('shows month, spent, cap', () => {
        render(<AIActivityCard activity={{ month: '2026-04', spent_cents: 125, cap_cents: 500 }} />)
        expect(screen.getByText(/2026-04/)).toBeInTheDocument()
        expect(screen.getByText(/\$1\.25/)).toBeInTheDocument()
        expect(screen.getByText(/\$5\.00/)).toBeInTheDocument()
    })

    it('shows "unlimited" when cap is 0', () => {
        render(<AIActivityCard activity={{ month: '2026-04', spent_cents: 125, cap_cents: 0 }} />)
        expect(screen.getByText(/unlimited/i)).toBeInTheDocument()
    })

    it('shows progress bar percent', () => {
        const { container } = render(<AIActivityCard activity={{ month: '2026-04', spent_cents: 300, cap_cents: 500 }} />)
        const bar = container.querySelector('[data-testid="ai-progress-bar"]')
        expect(bar).toBeTruthy()
        expect(bar.style.width).toBe('60%')
    })
})
