import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Spinner, PageSpinner } from '../../../src/components/ui/Spinner'

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
        expect(el.className).toContain('text-indigo-500')  // primary default
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
