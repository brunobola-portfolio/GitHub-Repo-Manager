import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHeader } from '../../../src/components/ui/PageHeader'

describe('PageHeader', () => {
    it('renders the title as an h1', () => {
        render(<PageHeader title="Tracked repositories" />)
        const h1 = screen.getByRole('heading', { level: 1 })
        expect(h1.textContent).toBe('Tracked repositories')
    })

    it('applies the standard responsive size + display font', () => {
        render(<PageHeader title="Page" />)
        const h1 = screen.getByRole('heading', { level: 1 })
        expect(h1.className).toContain('text-2xl')
        expect(h1.className).toContain('sm:text-3xl')
        expect(h1.className).toContain('lg:text-4xl')
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
})
