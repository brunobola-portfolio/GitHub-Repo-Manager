import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Spinner, PageSpinner, SectionSpinner } from '../../../src/components/ui/Spinner'

describe('Spinner', () => {
    it('renders with role="status" and the default loading label', () => {
        render(<Spinner />)
        const el = screen.getByRole('status')
        expect(el).toHaveAttribute('aria-label', 'Loading')
        expect(el).toHaveClass('animate-spin')
    })

    it('applies the requested size class', () => {
        const { rerender } = render(<Spinner size="xs" />)
        expect(screen.getByRole('status').className).toContain('w-3 h-3')
        rerender(<Spinner size="xl" />)
        expect(screen.getByRole('status').className).toContain('w-8 h-8')
    })

    it('applies the requested tone', () => {
        render(<Spinner tone="danger" />)
        expect(screen.getByRole('status').className).toContain('text-red-500')
    })

    it('falls back to defaults for unknown tone/size', () => {
        render(<Spinner size="bogus" tone="bogus" label="test" />)
        const el = screen.getByRole('status')
        expect(el).toHaveAttribute('aria-label', 'test')
        expect(el.className).toContain('w-4 h-4')          // md default
        expect(el.className).toContain('--ds-accent-brand')  // primary default (branded indigo)
    })

    it('honours an explicit label', () => {
        render(<Spinner label="Saving" />)
        expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Saving')
    })
})

describe('PageSpinner', () => {
    it('renders the label as visible text alongside the spinner', () => {
        render(<PageSpinner label="Booting up…" />)
        expect(screen.getByText('Booting up…')).toBeInTheDocument()
        expect(screen.getByRole('status')).toBeInTheDocument()
    })
})

describe('SectionSpinner', () => {
    it('renders label + spinner with the default padding', () => {
        const { container } = render(<SectionSpinner label="Loading items..." />)
        expect(screen.getByText('Loading items...')).toBeInTheDocument()
        expect(screen.getByRole('status')).toBeInTheDocument()
        expect(container.firstChild.className).toContain('py-12')
    })

    it('honours a custom padding override', () => {
        const { container } = render(<SectionSpinner padding="p-16" />)
        expect(container.firstChild.className).toContain('p-16')
    })
})
