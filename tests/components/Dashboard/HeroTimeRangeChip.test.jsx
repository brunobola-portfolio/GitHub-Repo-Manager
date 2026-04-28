import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { HeroTimeRangeChip } = await import('../../../src/components/Dashboard/HeroTimeRangeChip')

describe('HeroTimeRangeChip', () => {
    it('renders the current range label', () => {
        render(<HeroTimeRangeChip value="30d" onChange={() => {}} />)
        expect(screen.getByText('Últimos 30 dias')).toBeInTheDocument()
    })

    it('calls onChange when a different range is picked', () => {
        const onChange = vi.fn()
        render(<HeroTimeRangeChip value="7d" onChange={onChange} />)
        fireEvent.click(screen.getByRole('button', { name: /time range/i }))
        fireEvent.click(screen.getByRole('button', { name: /últimos 30 dias/i }))
        expect(onChange).toHaveBeenCalledWith('30d')
    })
})
