import { describe, it, expect } from 'vitest'
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
})
