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
})
