import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Skeleton } from '../../../src/components/ui/Skeleton'

describe('Skeleton', () => {
  it('applies ds-skeleton class', () => {
    render(<Skeleton data-testid="sk" />)
    const el = screen.getByTestId('sk')
    expect(el.className).toContain('ds-skeleton')
  })

  it('supports text variant with a default height', () => {
    render(<Skeleton variant="text" data-testid="sk" />)
    expect(screen.getByTestId('sk').className).toMatch(/h-4|h-3/)
  })

  it('has role="status" and aria-busy="true"', () => {
    render(<Skeleton data-testid="sk" />)
    expect(screen.getByTestId('sk').getAttribute('role')).toBe('status')
    expect(screen.getByTestId('sk').getAttribute('aria-busy')).toBe('true')
  })
})
