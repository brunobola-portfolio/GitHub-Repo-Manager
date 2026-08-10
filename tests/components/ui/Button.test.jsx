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
        expect(screen.getByRole('button').className).toContain('bg-[color:var(--ds-accent-brand)]')
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
        render(<Button className="bg-brand-500">x</Button>)
        const cls = screen.getByRole('button').className
        // tailwind-merge should drop the variant's token bg when overridden.
        expect(cls).toContain('bg-brand-500')
        expect(cls).not.toContain('var(--ds-accent-brand)')
    })

    it('renders outline variant with transparent bg + slate border', () => {
        render(<Button variant="outline">x</Button>)
        const cls = screen.getByRole('button').className
        expect(cls).toContain('bg-transparent')
        expect(cls).toContain('border-slate-300')
    })

    it('renders outline-danger with red border + red text', () => {
        render(<Button variant="outline-danger">x</Button>)
        const cls = screen.getByRole('button').className
        expect(cls).toContain('border-red-300')
        expect(cls).toContain('text-red-600')
    })

    it('renders outline-primary with indigo border + brand-token text', () => {
        render(<Button variant="outline-primary">x</Button>)
        const cls = screen.getByRole('button').className
        expect(cls).toContain('border-brand-300')
        expect(cls).toContain('text-[color:var(--ds-accent-brand)]')
    })

    it('renders soft-danger with red-50 bg + red text and no border', () => {
        render(<Button variant="soft-danger">x</Button>)
        const cls = screen.getByRole('button').className
        expect(cls).toContain('bg-red-50')
        expect(cls).toContain('text-red-700')
    })

    it('renders soft-primary with brand-50 bg + indigo text + indigo border', () => {
        render(<Button variant="soft-primary">x</Button>)
        const cls = screen.getByRole('button').className
        expect(cls).toContain('bg-brand-50')
        expect(cls).toContain('text-brand-700')
        expect(cls).toContain('border-brand-200')
    })
})
