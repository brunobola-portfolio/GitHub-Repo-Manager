import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeroHalo } from '../../../src/components/ui/HeroHalo'

describe('HeroHalo', () => {
    it('renders with default indigo palette + top position', () => {
        render(<HeroHalo />)
        const halo = screen.getByTestId('hero-halo')
        expect(halo).toBeInTheDocument()
        expect(halo.dataset.palette).toBe('indigo')
        expect(halo.dataset.position).toBe('top')
    })

    it('is aria-hidden so it stays out of the a11y tree', () => {
        render(<HeroHalo />)
        const halo = screen.getByTestId('hero-halo')
        expect(halo).toHaveAttribute('aria-hidden', 'true')
    })

    it('applies emerald palette classes when palette="emerald"', () => {
        render(<HeroHalo palette="emerald" />)
        const halo = screen.getByTestId('hero-halo')
        expect(halo.className).toMatch(/from-emerald/)
    })

    it('applies the topRight position when requested', () => {
        render(<HeroHalo position="topRight" />)
        const halo = screen.getByTestId('hero-halo')
        expect(halo.dataset.position).toBe('topRight')
        expect(halo.className).toMatch(/right-0/)
    })

    it('falls back to default classes for unknown palette/position', () => {
        render(<HeroHalo palette="unknown" position="bogus" />)
        const halo = screen.getByTestId('hero-halo')
        expect(halo.className).toMatch(/from-indigo/)
        expect(halo.className).toMatch(/-top-24/)
    })

    it('honours intensity class', () => {
        render(<HeroHalo intensity="strong" />)
        const halo = screen.getByTestId('hero-halo')
        expect(halo.className).toMatch(/opacity-100/)
    })
})
