import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { HeroTimeRangeChip } = await import('../../../src/components/Dashboard/HeroTimeRangeChip')

describe('HeroTimeRangeChip', () => {
    let langSpy
    afterEach(() => {
        if (langSpy) langSpy.mockRestore()
    })

    describe('English locale', () => {
        beforeEach(() => {
            langSpy = vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
        })

        it('renders the current range label in English', () => {
            render(<HeroTimeRangeChip value="30d" onChange={() => {}} />)
            expect(screen.getByText('Last 30 days')).toBeInTheDocument()
        })

        it('calls onChange when a different range is picked', () => {
            const onChange = vi.fn()
            render(<HeroTimeRangeChip value="7d" onChange={onChange} />)
            fireEvent.click(screen.getByRole('button', { name: /time range/i }))
            fireEvent.click(screen.getByRole('button', { name: /last 30 days/i }))
            expect(onChange).toHaveBeenCalledWith('30d')
        })
    })

    describe('Portuguese locale', () => {
        beforeEach(() => {
            langSpy = vi.spyOn(navigator, 'language', 'get').mockReturnValue('pt-PT')
        })

        it('renders the current range label in Portuguese', () => {
            render(<HeroTimeRangeChip value="30d" onChange={() => {}} />)
            expect(screen.getByText('Últimos 30 dias')).toBeInTheDocument()
        })
    })
})
