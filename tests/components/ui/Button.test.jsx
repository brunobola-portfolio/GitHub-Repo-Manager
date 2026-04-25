import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '../../../src/components/ui/Button'

describe('Button', () => {
    it('renders children', () => {
        render(<Button>Save</Button>)
        expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })

    it('uses md size by default', () => {
        render(<Button>x</Button>)
        const cls = screen.getByRole('button').className
        expect(cls).toContain('px-4 py-2 text-sm')
    })

    it('applies the requested variant', () => {
        render(<Button variant="danger">x</Button>)
        expect(screen.getByRole('button').className).toContain('bg-red-600')
    })

    it('falls back to primary for an unknown variant', () => {
        render(<Button variant="bogus">x</Button>)
        expect(screen.getByRole('button').className).toContain('bg-indigo-600')
    })

    it('enforces the WCAG 44px tap target by default (sm/md/lg)', () => {
        const { rerender } = render(<Button size="sm">x</Button>)
        expect(screen.getByRole('button').className).toContain('min-h-[44px]')
        rerender(<Button size="md">x</Button>)
        expect(screen.getByRole('button').className).toContain('min-h-[44px]')
        rerender(<Button size="lg">x</Button>)
        expect(screen.getByRole('button').className).toContain('min-h-[44px]')
    })

    it('opts out of the 44px tap target when size="xs"', () => {
        render(<Button size="xs">x</Button>)
        const cls = screen.getByRole('button').className
        expect(cls).not.toContain('min-h-[44px]')
        expect(cls).not.toContain('min-w-[44px]')
        expect(cls).toContain('px-2 py-1')
    })

    it('forwards arbitrary props to the underlying button', () => {
        render(<Button data-testid="cta" disabled>x</Button>)
        const btn = screen.getByTestId('cta')
        expect(btn).toBeDisabled()
    })

    it('merges className overrides via tailwind-merge', () => {
        render(<Button className="bg-purple-500">x</Button>)
        const cls = screen.getByRole('button').className
        // tailwind-merge should drop the variant's bg-indigo-600 when overridden.
        expect(cls).toContain('bg-purple-500')
        expect(cls).not.toContain('bg-indigo-600')
    })
})
