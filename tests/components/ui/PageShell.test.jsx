import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PageShell } from '../../../src/components/ui/PageShell'

describe('PageShell', () => {
    it('applies sensible defaults (max-w-6xl, mx-auto, responsive padding)', () => {
        const { container } = render(<PageShell>content</PageShell>)
        const root = container.firstChild
        expect(root.className).toContain('max-w-6xl')
        expect(root.className).toContain('mx-auto')
        expect(root.className).toContain('px-4 sm:px-6 lg:px-8')
        expect(root.className).toContain('py-6 sm:py-8')
    })

    it('honours maxWidth prop', () => {
        const { container } = render(<PageShell maxWidth="md">x</PageShell>)
        expect(container.firstChild.className).toContain('max-w-3xl')
    })

    it('falls back to default when maxWidth is unknown', () => {
        const { container } = render(<PageShell maxWidth="bogus">x</PageShell>)
        expect(container.firstChild.className).toContain('max-w-6xl')
    })

    it('supports landing variant for marketing pages', () => {
        const { container } = render(<PageShell verticalPadding="landing">x</PageShell>)
        expect(container.firstChild.className).toContain('py-16 sm:py-24')
    })

    it('renders as a custom tag when `as` is supplied', () => {
        const { container } = render(<PageShell as="main">x</PageShell>)
        expect(container.firstChild.tagName).toBe('MAIN')
    })

    it('merges user-supplied className without overriding defaults', () => {
        const { container } = render(<PageShell className="custom-bg">x</PageShell>)
        const cls = container.firstChild.className
        expect(cls).toContain('custom-bg')
        expect(cls).toContain('mx-auto')
    })

    it('forwards arbitrary props (e.g. id, role)', () => {
        const { container } = render(<PageShell id="page" role="main">x</PageShell>)
        expect(container.firstChild.id).toBe('page')
        expect(container.firstChild.getAttribute('role')).toBe('main')
    })

    it('maxWidth="full" renders without any max-w cap, for primary-nav pages that span the app shell', () => {
        const { container } = render(<PageShell maxWidth="full">x</PageShell>)
        const cls = container.firstChild.className
        expect(cls).toContain('max-w-none')
        expect(cls).not.toMatch(/max-w-(3xl|4xl|5xl|6xl|7xl)\b/)
    })
})
