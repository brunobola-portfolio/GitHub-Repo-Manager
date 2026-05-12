import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { ModelRow } = await import('../../../../src/components/Settings/AIConfig/ModelRow')

const BASE_OPTION = {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    tier: 'balanced',
    description: 'Best balance of speed and intelligence',
    context: '1M',
    capabilities: ['vision', 'tools', 'reasoning'],
    pricing: { input: 3.00, output: 15.00, currency: 'USD', per: '1M tokens' },
    recommended: true,
    releasedAt: '2026-04-20',
}

const noopHandlers = { select: () => {}, hover: () => {} }

describe('ModelRow', () => {
    it('renders label, model id, description, and tier badge', () => {
        render(<ModelRow option={BASE_OPTION} selected={false} highlighted={false} onPick={noopHandlers} />)
        expect(screen.getByText('Claude Sonnet 4.6')).toBeInTheDocument()
        expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument()
        expect(screen.getByText(/Best balance/)).toBeInTheDocument()
        expect(screen.getByText('Balanced')).toBeInTheDocument()
    })

    it('renders the context badge when context is provided', () => {
        render(<ModelRow option={BASE_OPTION} selected={false} highlighted={false} onPick={noopHandlers} />)
        expect(screen.getByText('1M')).toBeInTheDocument()
    })

    it('renders a RECOMMENDED pill when option.recommended is true', () => {
        render(<ModelRow option={BASE_OPTION} selected={false} highlighted={false} onPick={noopHandlers} />)
        expect(screen.getByText(/recommended/i)).toBeInTheDocument()
    })

    it('renders a NEW pill when releasedAt is within 60 days', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-05-12T00:00:00Z'))
        render(<ModelRow option={BASE_OPTION} selected={false} highlighted={false} onPick={noopHandlers} />)
        expect(screen.getByText('NEW')).toBeInTheDocument()
        vi.useRealTimers()
    })

    it('renders one capability icon per declared capability with an accessible label', () => {
        render(<ModelRow option={BASE_OPTION} selected={false} highlighted={false} onPick={noopHandlers} />)
        expect(screen.getByLabelText(/vision/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/tool/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/reasoning/i)).toBeInTheDocument()
        expect(screen.queryByLabelText(/json/i)).toBeNull()
    })

    it('renders the pricing block with input and output formatted', () => {
        render(<ModelRow option={BASE_OPTION} selected={false} highlighted={false} onPick={noopHandlers} />)
        expect(screen.getByText(/\$3(\.00)? in/i)).toBeInTheDocument()
        expect(screen.getByText(/\$15(\.00)? out/i)).toBeInTheDocument()
    })

    it('omits the pricing block when option.pricing is missing', () => {
        const noPrice = { ...BASE_OPTION, pricing: undefined }
        render(<ModelRow option={noPrice} selected={false} highlighted={false} onPick={noopHandlers} />)
        expect(screen.queryByText(/in$/i)).toBeNull()
    })

    it('calls onPick.select when the row is clicked', () => {
        const select = vi.fn()
        render(<ModelRow option={BASE_OPTION} selected={false} highlighted={false} onPick={{ select, hover: () => {} }} />)
        fireEvent.click(screen.getByRole('option'))
        expect(select).toHaveBeenCalledTimes(1)
    })

    it('marks the row as aria-selected when selected is true', () => {
        render(<ModelRow option={BASE_OPTION} selected={true} highlighted={false} onPick={noopHandlers} />)
        expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true')
    })
})
