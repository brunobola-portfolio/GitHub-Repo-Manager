import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Filter } from 'lucide-react'

const { HeroChip } = await import('../../../src/components/Dashboard/HeroChip')

describe('HeroChip', () => {
    it('renders icon and label', () => {
        render(<HeroChip icon={Filter} label="All organizations" />)
        expect(screen.getByText('All organizations')).toBeInTheDocument()
    })

    it('renders ChevronDown when hasMenu is true', () => {
        const { container } = render(<HeroChip icon={Filter} label="All organizations" hasMenu />)
        expect(container.querySelector('[data-chevron]')).toBeTruthy()
    })

    it('does not render ChevronDown when hasMenu is false', () => {
        const { container } = render(<HeroChip icon={Filter} label="Sync" />)
        expect(container.querySelector('[data-chevron]')).toBeNull()
    })

    it('triggers onClick when clicked', () => {
        const onClick = vi.fn()
        render(<HeroChip icon={Filter} label="Sync" onClick={onClick} />)
        fireEvent.click(screen.getByRole('button'))
        expect(onClick).toHaveBeenCalled()
    })

    it('forwards aria-label', () => {
        render(<HeroChip icon={Filter} label="Filter" aria-label="Filter by organization, currently All" />)
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Filter by organization, currently All')
    })

    it('disables when disabled prop is true', () => {
        const onClick = vi.fn()
        render(<HeroChip icon={Filter} label="Sync" onClick={onClick} disabled />)
        const button = screen.getByRole('button')
        expect(button).toBeDisabled()
        fireEvent.click(button)
        expect(onClick).not.toHaveBeenCalled()
    })
})
