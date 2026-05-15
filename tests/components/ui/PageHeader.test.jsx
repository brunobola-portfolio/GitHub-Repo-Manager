import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHeader } from '../../../src/components/ui/PageHeader'

describe('PageHeader', () => {
    it('renders the title as an h1', () => {
        render(<PageHeader title="Tracked repositories" />)
        const h1 = screen.getByRole('heading', { level: 1 })
        expect(h1.textContent).toBe('Tracked repositories')
    })

    it('applies the standard size + display font', () => {
        render(<PageHeader title="Page" />)
        const h1 = screen.getByRole('heading', { level: 1 })
        expect(h1.className).toContain('text-xl')
        expect(h1.className).toContain('font-semibold')
        expect(h1.className).toContain('ds-font-display')
    })

    it('renders the eyebrow above the title when supplied', () => {
        render(<PageHeader eyebrow="Workspace" title="Page" />)
        expect(screen.getByText('Workspace')).toBeInTheDocument()
    })

    it('renders the description below the title when supplied', () => {
        render(<PageHeader title="Page" description="Manage everything." />)
        expect(screen.getByText('Manage everything.')).toBeInTheDocument()
    })

    it('renders the actions slot on the right', () => {
        render(<PageHeader title="Page" actions={<button>Refresh</button>} />)
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    })

    it('omits eyebrow + description gracefully when not supplied', () => {
        render(<PageHeader title="Page" />)
        // No paragraph element below the H1.
        expect(document.querySelectorAll('p').length).toBe(0)
    })

    it('ignores the gradient prop (deprecated) — title is always solid', () => {
        render(<PageHeader title="Page" gradient />)
        const h1 = screen.getByRole('heading', { level: 1 })
        expect(h1.className).toContain('text-slate-900')
        expect(h1.className).not.toContain('ds-gradient-text')
    })

    it('renders titleAccessory inline next to the H1 when supplied', () => {
        render(
            <PageHeader
                title="owner/repo"
                titleAccessory={<span data-testid="chip">Private</span>}
            />,
        )
        const chip = screen.getByTestId('chip')
        const h1 = screen.getByRole('heading', { level: 1 })
        // Chip and H1 share the same parent (the inline accessory wrapper).
        expect(chip.parentElement).toBe(h1.parentElement)
        expect(h1.className).toContain('truncate')
    })
})
