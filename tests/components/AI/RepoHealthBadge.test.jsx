import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RepoHealthBadge } from '../../../src/components/AI/RepoHealthBadge'

describe('RepoHealthBadge', () => {
    it('renders nothing when score is null', () => {
        const { container } = render(<RepoHealthBadge score={null} />)
        expect(container.firstChild).toBeNull()
    })

    it('renders nothing when score is undefined', () => {
        const { container } = render(<RepoHealthBadge />)
        expect(container.firstChild).toBeNull()
    })

    it('renders nothing when score is NaN', () => {
        const { container } = render(<RepoHealthBadge score={Number.NaN} />)
        expect(container.firstChild).toBeNull()
    })

    it('uses emerald tone for scores ≥ 80', () => {
        render(<RepoHealthBadge score={92} />)
        const span = screen.getByText('92')
        expect(span.className).toContain('emerald')
    })

    it('uses amber tone for scores in [60, 79]', () => {
        render(<RepoHealthBadge score={68} />)
        const span = screen.getByText('68')
        expect(span.className).toContain('amber')
    })

    it('uses rose tone for scores < 60', () => {
        render(<RepoHealthBadge score={42} />)
        const span = screen.getByText('42')
        expect(span.className).toContain('rose')
    })

    it('rounds the displayed score', () => {
        render(<RepoHealthBadge score={84.6} />)
        expect(screen.getByText('85')).toBeInTheDocument()
    })

    it('exposes an a11y label including the out-of-100 score', () => {
        render(<RepoHealthBadge score={70} />)
        expect(screen.getByLabelText(/AI health score 70 out of 100/)).toBeInTheDocument()
    })
})
