import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InsightCard } from '@/components/ui/InsightCard'

describe('InsightCard', () => {
  it('renders children', () => {
    render(<InsightCard>Hello</InsightCard>)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('applies default tone classes', () => {
    render(<InsightCard data-testid="card">x</InsightCard>)
    const card = screen.getByTestId('card')
    expect(card.className).toMatch(/ring-slate-200\/60/)
  })

  it('applies info tone classes', () => {
    render(<InsightCard tone="info" data-testid="card">x</InsightCard>)
    const card = screen.getByTestId('card')
    expect(card.className).toMatch(/ring-blue-500\/20/)
  })

  it('applies success tone classes', () => {
    render(<InsightCard tone="success" data-testid="card">x</InsightCard>)
    expect(screen.getByTestId('card').className).toMatch(/ring-emerald-500\/20/)
  })

  it('applies warning tone classes', () => {
    render(<InsightCard tone="warning" data-testid="card">x</InsightCard>)
    expect(screen.getByTestId('card').className).toMatch(/ring-amber-500\/20/)
  })

  it('applies danger tone classes', () => {
    render(<InsightCard tone="danger" data-testid="card">x</InsightCard>)
    expect(screen.getByTestId('card').className).toMatch(/ring-red-500\/20/)
  })

  it('applies ai tone classes', () => {
    render(<InsightCard tone="ai" data-testid="card">x</InsightCard>)
    expect(screen.getByTestId('card').className).toMatch(/ring-purple-500\/25/)
  })

  it('adds hover classes by default', () => {
    render(<InsightCard data-testid="card">x</InsightCard>)
    expect(screen.getByTestId('card').className).toMatch(/ds-hover-lift/)
    expect(screen.getByTestId('card').className).toMatch(/ds-card-shimmer/)
  })

  it('omits hover classes when hover=false', () => {
    render(<InsightCard hover={false} data-testid="card">x</InsightCard>)
    expect(screen.getByTestId('card').className).not.toMatch(/ds-hover-lift/)
  })

  it('merges custom className', () => {
    render(<InsightCard className="lg:col-span-2" data-testid="card">x</InsightCard>)
    expect(screen.getByTestId('card').className).toMatch(/lg:col-span-2/)
  })

  it('falls back to default tone for invalid tone values', () => {
    render(<InsightCard tone="bogus" data-testid="card">x</InsightCard>)
    expect(screen.getByTestId('card').className).toMatch(/ring-slate-200\/60/)
  })

  it('forwards arbitrary props via ...rest spread', () => {
    render(<InsightCard data-testid="card" aria-label="metric">x</InsightCard>)
    const card = screen.getByTestId('card')
    expect(card.getAttribute('aria-label')).toBe('metric')
  })
})

describe('InsightCard — reduced motion', () => {
  it('renders without error when reduced motion is preferred', async () => {
    vi.resetModules()
    vi.doMock('framer-motion', async () => {
      const actual = await vi.importActual('framer-motion')
      return { ...actual, useReducedMotion: () => true }
    })
    const { InsightCard: Card } = await import('@/components/ui/InsightCard')
    const { render, screen } = await import('@testing-library/react')
    render(<Card data-testid="reduced">content</Card>)
    expect(screen.getByTestId('reduced')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
    vi.doUnmock('framer-motion')
  })
})
