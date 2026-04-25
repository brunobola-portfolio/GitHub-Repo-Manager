import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card } from '../../../src/components/ui/Card'

describe('Card', () => {
  it('applies ds-hover-lift when hover=true', () => {
    render(<Card hover data-testid="c">x</Card>)
    expect(screen.getByTestId('c').className).toContain('ds-hover-lift')
  })

  it('does not apply ds-hover-lift by default', () => {
    render(<Card data-testid="c">x</Card>)
    expect(screen.getByTestId('c').className).not.toContain('ds-hover-lift')
  })

  it('uses shadow-lg by default', () => {
    render(<Card data-testid="c">x</Card>)
    expect(screen.getByTestId('c').className).toContain('shadow-lg')
  })

  it('applies the shadow="sm" variant', () => {
    render(<Card data-testid="c" shadow="sm">x</Card>)
    expect(screen.getByTestId('c').className).toContain('shadow-sm')
    expect(screen.getByTestId('c').className).not.toContain('shadow-lg')
  })

  it('omits any shadow class when shadow="none"', () => {
    render(<Card data-testid="c" shadow="none">x</Card>)
    const cls = screen.getByTestId('c').className
    expect(cls).not.toContain('shadow-lg')
    expect(cls).not.toContain('shadow-sm')
  })

  it('switches to opaque background when glass=false', () => {
    render(<Card data-testid="c" glass={false}>x</Card>)
    const cls = screen.getByTestId('c').className
    expect(cls).toContain('bg-white')
    expect(cls).not.toContain('backdrop-blur-xl')
  })
})
