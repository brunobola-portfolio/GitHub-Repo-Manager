import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { TierFilterChips } = await import('../../../../src/components/Settings/AIConfig/TierFilterChips')

describe('TierFilterChips', () => {
    it('renders All plus one chip per available tier', () => {
        render(
            <TierFilterChips
                availableTiers={['fast', 'smart', 'reasoning']}
                activeTier={null}
                onChange={() => {}}
                totalCount={7}
            />,
        )
        expect(screen.getByRole('button', { name: /all/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /fast/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /smart/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /reasoning/i })).toBeInTheDocument()
    })

    it('marks All as aria-pressed when activeTier is null', () => {
        render(<TierFilterChips availableTiers={['fast']} activeTier={null} onChange={() => {}} totalCount={3} />)
        expect(screen.getByRole('button', { name: /all/i })).toHaveAttribute('aria-pressed', 'true')
    })

    it('marks the matching chip as aria-pressed when activeTier is set', () => {
        render(<TierFilterChips availableTiers={['fast', 'smart']} activeTier="fast" onChange={() => {}} totalCount={3} />)
        expect(screen.getByRole('button', { name: /^fast$/i })).toHaveAttribute('aria-pressed', 'true')
        expect(screen.getByRole('button', { name: /all/i })).toHaveAttribute('aria-pressed', 'false')
    })

    it('calls onChange with the tier when a chip is clicked', () => {
        const onChange = vi.fn()
        render(<TierFilterChips availableTiers={['fast', 'smart']} activeTier={null} onChange={onChange} totalCount={3} />)
        fireEvent.click(screen.getByRole('button', { name: /smart/i }))
        expect(onChange).toHaveBeenCalledWith('smart')
    })

    it('calls onChange with null when All is clicked', () => {
        const onChange = vi.fn()
        render(<TierFilterChips availableTiers={['fast']} activeTier="fast" onChange={onChange} totalCount={3} />)
        fireEvent.click(screen.getByRole('button', { name: /all/i }))
        expect(onChange).toHaveBeenCalledWith(null)
    })

    it('shows the total count on the right', () => {
        render(<TierFilterChips availableTiers={['fast']} activeTier={null} onChange={() => {}} totalCount={42} />)
        expect(screen.getByText(/42 models?/i)).toBeInTheDocument()
    })

    it('excludes legacy tier from rendered chips', () => {
        render(
            <TierFilterChips
                availableTiers={['fast', 'legacy']}
                activeTier={null}
                onChange={() => {}}
                totalCount={5}
            />,
        )
        expect(screen.queryByRole('button', { name: /legacy/i })).not.toBeInTheDocument()
    })
})
