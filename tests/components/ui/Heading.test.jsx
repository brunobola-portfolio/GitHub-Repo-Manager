import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Heading } from '../../../src/components/ui/Heading'

describe('Heading', () => {
  it('renders an h2 by default with the display face + canonical classes', () => {
    render(<Heading>Title</Heading>)
    const h = screen.getByRole('heading', { level: 2 })
    expect(h).toHaveTextContent('Title')
    expect(h.className).toContain('ds-font-display')
    expect(h.className).toContain('font-semibold')
    expect(h.className).toContain('tracking-tight')
  })

  it('renders the element given by `as`', () => {
    render(<Heading as="h1">T</Heading>)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('lets className override the default weight via tailwind-merge', () => {
    render(<Heading as="h3" className="font-bold text-xl">T</Heading>)
    const h = screen.getByRole('heading', { level: 3 })
    expect(h.className).toContain('font-bold')
    expect(h.className).not.toContain('font-semibold') // merged away
    expect(h.className).toContain('text-xl')
    expect(h.className).toContain('ds-font-display')   // base preserved
  })

  it('forwards arbitrary props (id, data-*) to the element', () => {
    render(<Heading id="hx" data-testid="hd">T</Heading>)
    expect(screen.getByTestId('hd')).toHaveAttribute('id', 'hx')
  })
})
