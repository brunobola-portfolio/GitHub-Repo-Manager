import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { ModelDropdown } = await import('../../../../src/components/Settings/AIConfig/ModelDropdown')

const OPTS = [
    { id: 'flash', label: 'Flash', tier: 'fast', description: 'a fast one', context: '1M', capabilities: ['vision'], pricing: { input: 0.30, output: 2.50 }, legacy: false, recommended: false },
    { id: 'sonnet', label: 'Sonnet', tier: 'balanced', description: 'a balanced one', context: '1M', capabilities: ['tools'], pricing: { input: 3, output: 15 }, legacy: false, recommended: true },
    { id: 'opus', label: 'Opus', tier: 'smart', description: 'a smart one', context: '1M', capabilities: ['reasoning'], pricing: { input: 5, output: 25 }, legacy: false, recommended: false },
    { id: 'legacy-a', label: 'Legacy A', tier: 'legacy', description: 'old', context: '200K', capabilities: [], pricing: { input: 3, output: 15 }, legacy: true, recommended: false },
]

function baseProps(overrides = {}) {
    return {
        options: OPTS,
        value: '',
        onPick: { select: vi.fn(), hover: vi.fn() },
        listboxId: 'lb-test',
        listRef: { current: null },
        query: '',
        highlight: -1,
        catalogueHref: null,
        catalogueLabel: null,
        ...overrides,
    }
}

describe('ModelDropdown', () => {
    it('renders one section header per non-empty tier in TIER_ORDER', () => {
        render(<ModelDropdown {...baseProps()} />)
        expect(screen.getByText('Fast')).toBeInTheDocument()
        expect(screen.getByText('Balanced')).toBeInTheDocument()
        expect(screen.getByText('Smart')).toBeInTheDocument()
        expect(screen.queryByText(/Legacy A/)).toBeNull()
    })

    it('shows the legacy toggle when legacy options exist', () => {
        render(<ModelDropdown {...baseProps()} />)
        expect(screen.getByRole('button', { name: /show .* legacy/i })).toBeInTheDocument()
    })

    it('expands the legacy section when the toggle is clicked', () => {
        render(<ModelDropdown {...baseProps()} />)
        fireEvent.click(screen.getByRole('button', { name: /show .* legacy/i }))
        expect(screen.getByText('Legacy A')).toBeInTheDocument()
    })

    it('filters by the active chip', () => {
        render(<ModelDropdown {...baseProps()} />)
        fireEvent.click(screen.getByRole('button', { name: /^smart$/i }))
        expect(screen.getByText('Opus')).toBeInTheDocument()
        expect(screen.queryByText('Flash')).toBeNull()
        expect(screen.queryByText('Sonnet')).toBeNull()
    })

    it('shows an empty state with a clear-filter affordance when no items match the chip', () => {
        render(<ModelDropdown {...baseProps({ options: [OPTS[0]] })} />)
        fireEvent.click(screen.getByRole('button', { name: /^smart$/i }))
        expect(screen.getByText(/no models in this tier/i)).toBeInTheDocument()
    })

    it('shows the catalogue link when catalogueHref is provided', () => {
        render(<ModelDropdown {...baseProps({ catalogueHref: 'https://openrouter.ai/models', catalogueLabel: 'Browse' })} />)
        const link = screen.getByRole('link', { name: /browse/i })
        expect(link).toHaveAttribute('href', 'https://openrouter.ai/models')
    })

    it('forwards a click on a row to onPick.select with the option id', () => {
        const onPick = { select: vi.fn(), hover: vi.fn() }
        render(<ModelDropdown {...baseProps({ onPick })} />)
        fireEvent.click(screen.getByText('Sonnet'))
        expect(onPick.select).toHaveBeenCalledWith('sonnet')
    })
})
